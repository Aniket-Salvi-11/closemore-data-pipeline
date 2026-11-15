-- =====================================================================================================
-- prod_migration.sql  -  CloseMore AI Copilot: database changes for the SHARED database (closemore_next)
-- =====================================================================================================
-- What it does (everything is ADDED; nothing of the main app is changed or removed):
--   1. roles   copilot_rules_owner  (no login; owns the rule functions; may read the few tables the rules need)
--              copilot_ro           (no login; read-only grants the Copilot's queries use)
--              copilot_app          (login used by the AI service; member of copilot_ro; read-only sessions)
--   2. schema  rbac: the signing secret, the signed-identity functions and the "who sees what" rules
--   3. policies only FOR copilot_ro (the main app's existing policies are left exactly as they are)
--   4. table   copilot_documents (documents indexed for the Copilot) and its functions
--
-- What it does NOT do: change any CRM row, add triggers to CRM tables, drop or edit any existing policy,
-- revoke anything from the main app, or touch set_config().
--
-- Run: as a SUPERUSER (needed to create a role with BYPASSRLS for the rule functions), on a copy first:
--   psql -h <host> -p <port> -U <superuser> -d closemore_next -v ON_ERROR_STOP=1 -f prod_migration.sql
-- Safe to run again (every step checks or replaces). Undo everything: prod_rollback.sql
-- After the first run: set a password for copilot_app and read the signing secret (see the handoff).
-- =====================================================================================================

\set ON_ERROR_STOP on
begin;

do $$
begin
  if not (select rolsuper from pg_roles where rolname = current_user) then
    raise exception 'Run prod_migration.sql as a superuser (current user: %)', current_user;
  end if;
end $$;

-- Every table the Copilot reads must already have row level security switched on. We do not switch it on
-- ourselves, because that would change what the main app sees.
do $$
declare t text;
begin
  foreach t in array array['deals','deal_team_members','deal_contacts','line_items','contacts','users',
                           'pipelines','deal_types','products','organization_regions','organizations']
  loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = t and c.relrowsecurity) then
      raise exception 'public.% is missing or has row level security off; stop and contact the AI team', t;
    end if;
  end loop;
end $$;

create extension if not exists pgcrypto with schema public;

-- ------------------------------------------------------------------------------------------- 1. roles
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'copilot_rules_owner') then
    create role copilot_rules_owner nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'copilot_ro') then
    create role copilot_ro nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'copilot_app') then
    create role copilot_app login;
  end if;
end $$;

-- The rule functions run as this role. BYPASSRLS lets them read users/deals to decide access without
-- being filtered by the main app's policies; it has no login and only SELECT on the tables below.
alter role copilot_rules_owner nologin nosuperuser bypassrls nocreatedb nocreaterole;
alter role copilot_ro          nologin nosuperuser nobypassrls nocreatedb nocreaterole;
alter role copilot_app         login   nosuperuser nobypassrls nocreatedb nocreaterole inherit;
grant copilot_ro to copilot_app;
alter role copilot_app set default_transaction_read_only = on;
alter role copilot_app set statement_timeout = '30s';
alter role copilot_app set idle_in_transaction_session_timeout = '60s';

grant usage on schema public to copilot_rules_owner, copilot_ro;
grant select on public.users, public.deals, public.deal_team_members, public.deal_contacts,
                public.organization_regions to copilot_rules_owner;

-- ------------------------------------------------------------------------------- 2. rbac schema
create schema if not exists rbac;
alter schema rbac owner to copilot_rules_owner;
revoke all on schema rbac from public;

create table if not exists rbac.app_secret (secret text not null);
alter table rbac.app_secret owner to copilot_rules_owner;
revoke all on rbac.app_secret from public;
insert into rbac.app_secret (secret)
select encode(public.gen_random_bytes(32), 'hex') where not exists (select 1 from rbac.app_secret);

-- Region helpers: comparisons ignore case and spaces ('east ', 'EAST', 'East' are the same region).
create or replace function rbac.region_list(p text) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct lower(btrim(x))) filter (where btrim(x) <> ''), '{}'::text[])
  from unnest(string_to_array(coalesce(p, ''), ',')) as x
$$;

create or replace function rbac.canon_region_one(p text) returns text
language sql immutable as $$
  select case when btrim(coalesce(p, '')) = '' then null
              when lower(btrim(p)) = 'latam' then 'LATAM'
              else initcap(lower(btrim(p))) end
$$;

-- Signature for a user id: HMAC-SHA256(user_id, secret) as hex. Not executable by the Copilot roles.
create or replace function rbac.sign_user(p_user_id text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select encode(public.hmac(p_user_id, s.secret, 'sha256'), 'hex') from rbac.app_secret s limit 1
$$;

-- The asking user, only if the signature set by the AI service is valid.
create or replace function rbac.cur_user() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select x.u
    from (select nullif(current_setting('app.current_user_id', true), '') as u) x
   where x.u is not null
     and current_setting('app.current_user_sig', true) = rbac.sign_user(x.u)
$$;

create or replace function rbac.cur_role() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select u."Role" from public.users u where u."User_ID" = rbac.cur_user() and u."Status" = 'Active'
$$;

create or replace function rbac.cur_org() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select u."Organization_ID" from public.users u where u."User_ID" = rbac.cur_user() and u."Status" = 'Active'
$$;

create or replace function rbac.cur_regions() returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select rbac.region_list(u."Region") from public.users u
   where u."User_ID" = rbac.cur_user() and u."Status" = 'Active'
$$;

-- A deal's region for access purposes: its own region; if it has none, its owner's first region.
-- (On the demo copy the empty regions were filled the same way; here no row is changed.)
create or replace function rbac.deal_region(p_region text, p_owner text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(lower(btrim(coalesce(p_region, ''))), ''),
                  (select nullif(lower(btrim(split_part(coalesce(u."Region", ''), ',', 1))), '')
                     from public.users u where u."User_ID" = p_owner))
$$;

-- THE deal rule (single place)
--   System admin ........ every deal in the organization
--   Sales admin/Exec .... deals in own regions; all deals if no region in profile
--   Sales rep ........... deal region in own regions AND (owner OR deal team member)
create or replace function rbac.can_see_deal(p_deal_id text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.deals d
     where d."Deal_ID" = p_deal_id
       and rbac.cur_role() is not null
       and d."Organization_ID" = rbac.cur_org()
       and (
         rbac.cur_role() in ('System_Admin', 'Admin')
         or (rbac.cur_role() in ('Sales_Admin', 'Executive')
             and (cardinality(rbac.cur_regions()) = 0
                  or rbac.deal_region(d."Region", d."Owner_ID") = any (rbac.cur_regions())))
         or (rbac.cur_role() = 'Sales_Rep'
             and rbac.deal_region(d."Region", d."Owner_ID") = any (rbac.cur_regions())
             and (d."Owner_ID" = rbac.cur_user()
                  or exists (select 1 from public.deal_team_members t
                              where t."Deal_ID" = d."Deal_ID" and t."User_ID" = rbac.cur_user())))
       )
  )
$$;

-- Contacts follow deals: visible if linked to a visible deal (or for unrestricted admins)
create or replace function rbac.can_see_contact(p_contact_id text, p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select rbac.cur_role() is not null
     and p_org = rbac.cur_org()
     and (
       rbac.cur_role() in ('System_Admin', 'Admin')
       or (rbac.cur_role() in ('Sales_Admin', 'Executive') and cardinality(rbac.cur_regions()) = 0)
       or exists (select 1 from public.deal_contacts dc
                   where dc."Contact_ID" = p_contact_id and rbac.can_see_deal(dc."Deal_ID"))
       or exists (select 1 from public.deals d
                   where d."Associated_Contact_ID" = p_contact_id and rbac.can_see_deal(d."Deal_ID"))
     )
$$;

create or replace function rbac.same_org(p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select rbac.cur_role() is not null and p_org = rbac.cur_org()
$$;

-- ------------------------------------------------------------- 3. Copilot-only grants and policies
-- Read grants (columns the Copilot never needs are left out: passwords, avatars, billing).
revoke all on public.deals, public.deal_team_members, public.deal_contacts, public.line_items, public.contacts,
              public.users, public.pipelines, public.deal_types, public.products, public.organization_regions,
              public.organizations from copilot_ro;
grant select on public.deals, public.deal_team_members, public.deal_contacts, public.line_items,
                public.pipelines, public.deal_types, public.products, public.organization_regions to copilot_ro;
grant select ("User_ID", "First_Name", "Last_Name", "Email", "Role", "Status", "Phone_Number", "Mobile_Number",
              "Organization_Name", "Office_Address", "Residential_Address", "Region", "Region_Name",
              "Territory_Name", "Organization_ID", "Created_At", "Updated_At") on public.users to copilot_ro;
grant select ("Contact_ID", "First_Name", "Last_Name", "Email", "Phone_Primary", "Organization_Name",
              "Contact_Type", "Source", "Created_Date", "Owner_ID", "Created_At", "Updated_At",
              "Organization_ID") on public.contacts to copilot_ro;
grant select ("Organization_ID", "Name", "Slug", "Status") on public.organizations to copilot_ro;

-- For each table: one PERMISSIVE policy (so the Copilot is not limited by the main app's settings-based
-- policies) and one RESTRICTIVE policy with our rule. Postgres requires every restrictive policy to pass,
-- so the Copilot sees exactly our rules whatever the other policies allow (including app.bypass_rls).
-- Both apply only to copilot_ro (and so to copilot_app); the main app is not affected.
do $$
declare
  r record;
begin
  for r in select * from (values
      ('deals',                'rbac.can_see_deal("Deal_ID")'),
      ('deal_team_members',    'rbac.can_see_deal("Deal_ID")'),
      ('deal_contacts',        'rbac.can_see_deal("Deal_ID")'),
      ('line_items',           'rbac.can_see_deal("Deal_ID")'),
      ('contacts',             'rbac.can_see_contact("Contact_ID", "Organization_ID")'),
      ('users',                'rbac.same_org("Organization_ID")'),
      ('pipelines',            'rbac.same_org("Organization_ID")'),
      ('deal_types',           'rbac.same_org("Organization_ID")'),
      ('products',             'rbac.same_org("Organization_ID")'),
      ('organization_regions', 'rbac.same_org("Organization_ID")'),
      ('organizations',        'rbac.same_org("Organization_ID")')
    ) as v(tbl, rule)
  loop
    execute format('drop policy if exists copilot_allow on public.%I', r.tbl);
    execute format('drop policy if exists copilot_rules on public.%I', r.tbl);
    execute format('create policy copilot_allow on public.%I as permissive for select to copilot_ro using (true)', r.tbl);
    execute format('create policy copilot_rules on public.%I as restrictive for select to copilot_ro using (%s)', r.tbl, r.rule);
  end loop;
end $$;

-- ------------------------------------------------------------------------------- 4. documents
create table if not exists public.copilot_documents (
  "Doc_ID"          text primary key,
  "Filename"        text not null,
  "Region"          text,
  "Owner_ID"        text not null references public.users ("User_ID"),
  "Organization_ID" uuid not null,
  "Size_Bytes"      bigint not null default 0,
  "Status"          text not null default 'processing' check ("Status" in ('processing', 'ready', 'failed')),
  "Status_Detail"   text,
  "S3_Key"          text,
  "Chunk_Count"     integer not null default 0,
  "Uploaded_At"     timestamptz not null default now(),
  "Updated_At"      timestamptz not null default now()
);
create index if not exists copilot_documents_org_idx on public.copilot_documents ("Organization_ID");
alter table public.copilot_documents enable row level security;
alter table public.copilot_documents force row level security;
revoke all on public.copilot_documents from public;
grant select, insert, update, delete on public.copilot_documents to copilot_rules_owner;
grant select on public.copilot_documents to copilot_app;

create or replace function rbac.cur_is_full_view() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(rbac.cur_role() in ('System_Admin', 'Admin')
         or (rbac.cur_role() in ('Sales_Admin', 'Executive') and cardinality(rbac.cur_regions()) = 0), false)
$$;

create or replace function rbac.can_see_document(p_region text, p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select rbac.cur_role() is not null
     and p_org = rbac.cur_org()
     and (rbac.cur_is_full_view()
          or (rbac.cur_role() in ('Sales_Admin', 'Executive', 'Sales_Rep')
              and btrim(coalesce(p_region, '')) <> ''
              and lower(btrim(p_region)) = any (rbac.cur_regions())))
$$;

create or replace function rbac.org_regions() returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct r order by r), '{}'::text[])
  from (
    select rbac.canon_region_one(x) as r
      from public.users u, unnest(string_to_array(coalesce(u."Region", ''), ',')) as x
     where u."Organization_ID" = rbac.cur_org()
    union
    select rbac.canon_region_one(d."Region") from public.deals d where d."Organization_ID" = rbac.cur_org()
    union
    select rbac.canon_region_one(o."Name") from public.organization_regions o where o."Organization_ID" = rbac.cur_org()
  ) z
  where r is not null and rbac.cur_role() is not null
$$;

create or replace function rbac.can_upload_region(p_region text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select rbac.cur_role() is not null
     and btrim(coalesce(p_region, '')) <> ''
     and ((rbac.cur_is_full_view() and rbac.canon_region_one(p_region) = any (rbac.org_regions()))
          or lower(btrim(p_region)) = any (rbac.cur_regions()))
$$;

drop policy if exists copilot_documents_select on public.copilot_documents;
create policy copilot_documents_select on public.copilot_documents
  for select using (rbac.can_see_document("Region", "Organization_ID"));

create or replace function rbac.doc_create(p_doc_id text, p_filename text, p_region text,
                                           p_size bigint, p_s3_key text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if rbac.cur_user() is null then
    raise exception 'not identified' using errcode = '28000';
  end if;
  if not rbac.can_upload_region(p_region) then
    raise exception 'region not allowed for this user' using errcode = '42501';
  end if;
  insert into public.copilot_documents
    ("Doc_ID", "Filename", "Region", "Owner_ID", "Organization_ID", "Size_Bytes", "S3_Key")
  values (p_doc_id, p_filename, rbac.canon_region_one(p_region), rbac.cur_user(), rbac.cur_org(), p_size, p_s3_key);
end
$$;

create or replace function rbac.doc_set_status(p_doc_id text, p_status text, p_detail text,
                                               p_chunk_count integer) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.copilot_documents
     set "Status" = p_status, "Status_Detail" = p_detail, "Chunk_Count" = coalesce(p_chunk_count, 0),
         "Updated_At" = now()
   where "Doc_ID" = p_doc_id and "Owner_ID" = rbac.cur_user();
  return found;
end
$$;

create or replace function rbac.doc_delete(p_doc_id text)
returns table (s3_key text, chunk_count integer, status text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.copilot_documents;
begin
  select * into d from public.copilot_documents where "Doc_ID" = p_doc_id;
  if not found or not rbac.can_see_document(d."Region", d."Organization_ID") then
    raise exception 'document not found' using errcode = 'P0002';
  end if;
  if d."Owner_ID" is distinct from rbac.cur_user() and rbac.cur_role() not in ('System_Admin', 'Admin') then
    raise exception 'only the uploader or a system admin may delete' using errcode = '42501';
  end if;
  delete from public.copilot_documents where "Doc_ID" = p_doc_id;
  return query select d."S3_Key", d."Chunk_Count", d."Status";
end
$$;

-- ------------------------------------------------------------------- ownership and execute rights
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'rbac'
  loop
    execute format('alter function %s owner to copilot_rules_owner', f.sig);
  end loop;
end $$;

revoke execute on all functions in schema rbac from public;
grant usage on schema rbac to copilot_ro;
grant execute on function rbac.region_list(text), rbac.canon_region_one(text), rbac.cur_user(), rbac.cur_role(),
  rbac.cur_org(), rbac.cur_regions(), rbac.deal_region(text, text), rbac.can_see_deal(text),
  rbac.can_see_contact(text, uuid), rbac.same_org(uuid) to copilot_ro;
grant execute on function rbac.cur_is_full_view(), rbac.can_see_document(text, uuid), rbac.org_regions(),
  rbac.can_upload_region(text), rbac.doc_create(text, text, text, bigint, text),
  rbac.doc_set_status(text, text, text, integer), rbac.doc_delete(text) to copilot_app;
-- rbac.sign_user and rbac.app_secret stay private to copilot_rules_owner.

commit;

\echo 'CloseMore Copilot migration applied. Next: set the copilot_app password and copy the signing secret (see handoff).'
