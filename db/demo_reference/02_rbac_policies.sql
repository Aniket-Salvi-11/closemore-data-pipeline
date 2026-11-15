-- 02_rbac_policies.sql  (run on the PRIVATE demo copy only)
-- All access rules live in the functions below. Policies only call them.
-- Identity = TWO session settings set by the backend for each request:
--   app.current_user_id   the user id
--   app.current_user_sig  HMAC-SHA256(user_id, secret) as hex
-- The secret lives in rbac.app_secret, which only the function owner can read, so SQL
-- run by the LLM cannot forge another user's identity even if it changes the user id.
-- Role, status, organization and regions are looked up from the users table.

create schema if not exists rbac;

create or replace function rbac.region_list(p text) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct lower(btrim(x))) filter (where btrim(x) <> ''), '{}'::text[])
  from unnest(string_to_array(coalesce(p, ''), ',')) as x
$$;

create table if not exists rbac.app_secret (secret text not null);
revoke all on rbac.app_secret from public;
insert into rbac.app_secret (secret)
select encode(public.gen_random_bytes(32), 'hex')
 where not exists (select 1 from rbac.app_secret);

-- Signature for a user id (used by admin tools and tests; NOT executable by copilot roles)
create or replace function rbac.sign_user(p_user_id text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select encode(public.hmac(p_user_id, s.secret, 'sha256'), 'hex')
    from rbac.app_secret s limit 1
$$;

-- Current user = the id, but only if its signature is valid
create or replace function rbac.cur_user() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select x.u
    from (select nullif(current_setting('app.current_user_id', true), '') as u) x
   where x.u is not null
     and current_setting('app.current_user_sig', true) = rbac.sign_user(x.u)
$$;

-- Only ACTIVE users get any access
create or replace function rbac.cur_role() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select u."Role" from public.users u
   where u."User_ID" = rbac.cur_user() and u."Status" = 'Active'
$$;

create or replace function rbac.cur_org() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select u."Organization_ID" from public.users u
   where u."User_ID" = rbac.cur_user() and u."Status" = 'Active'
$$;

create or replace function rbac.cur_regions() returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select rbac.region_list(u."Region") from public.users u
   where u."User_ID" = rbac.cur_user() and u."Status" = 'Active'
$$;

-- THE deal rule (single place)
--   System admin ........ every deal in the organization
--   Sales admin/Exec .... deals in own regions; all deals if no region in profile
--   Sales rep ........... deal region must be in own regions AND (owner OR deal team member)
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
                  or lower(btrim(coalesce(d."Region", ''))) = any (rbac.cur_regions())))
         or (rbac.cur_role() = 'Sales_Rep'
             and lower(btrim(coalesce(d."Region", ''))) = any (rbac.cur_regions())
             and (d."Owner_ID" = rbac.cur_user()
                  or exists (select 1 from public.deal_team_members t
                              where t."Deal_ID" = d."Deal_ID"
                                and t."User_ID" = rbac.cur_user())))
       )
  )
$$;

-- Contacts follow deals: visible if linked to a visible deal (or unrestricted admin)
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

-- Team rule: a member must have the deal's region (full-view admins are exempt)
create or replace function rbac.enforce_team_region() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d_region text; u_role text; u_region text;
begin
  select d."Region" into d_region from public.deals d where d."Deal_ID" = new."Deal_ID";
  select u."Role", u."Region" into u_role, u_region from public.users u where u."User_ID" = new."User_ID";
  if u_role is null then
    raise exception 'Deal team: unknown user %', new."User_ID";
  end if;
  if u_role in ('System_Admin', 'Admin')
     or (u_role in ('Sales_Admin', 'Executive') and cardinality(rbac.region_list(u_region)) = 0) then
    return new;
  end if;
  if btrim(coalesce(d_region, '')) <> '' and lower(btrim(d_region)) = any (rbac.region_list(u_region)) then
    return new;
  end if;
  raise exception 'Deal team rule: user % does not have the region of deal % (%)',
    new."User_ID", new."Deal_ID", coalesce(d_region, 'no region') using errcode = 'check_violation';
end
$$;

drop trigger if exists enforce_team_region on public.deal_team_members;
create trigger enforce_team_region before insert or update on public.deal_team_members
  for each row execute function rbac.enforce_team_region();

-- Drop every old policy on the demo tables (old bypass_rls and tenant policies go away)
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
            where schemaname = 'public'
              and tablename in ('organizations','users','pipelines','deal_types','products',
                                'contacts','deals','deal_contacts','deal_team_members',
                                'line_items','organization_regions')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['organizations','users','pipelines','deal_types','products',
                           'contacts','deals','deal_contacts','deal_team_members',
                           'line_items','organization_regions']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- Deal-based tables
create policy rbac_deals_select on public.deals
  for select using (rbac.can_see_deal("Deal_ID"));
create policy rbac_team_select on public.deal_team_members
  for select using (rbac.can_see_deal("Deal_ID"));
create policy rbac_deal_contacts_select on public.deal_contacts
  for select using (rbac.can_see_deal("Deal_ID"));
create policy rbac_line_items_select on public.line_items
  for select using (rbac.can_see_deal("Deal_ID"));
create policy rbac_contacts_select on public.contacts
  for select using (rbac.can_see_contact("Contact_ID", "Organization_ID"));

-- Organization-level tables (any active user of the same organization)
create policy rbac_org_users on public.users
  for select using (rbac.cur_role() is not null and "Organization_ID" = rbac.cur_org());
create policy rbac_org_pipelines on public.pipelines
  for select using (rbac.cur_role() is not null and "Organization_ID" = rbac.cur_org());
create policy rbac_org_deal_types on public.deal_types
  for select using (rbac.cur_role() is not null and "Organization_ID" = rbac.cur_org());
create policy rbac_org_products on public.products
  for select using (rbac.cur_role() is not null and "Organization_ID" = rbac.cur_org());
create policy rbac_org_regions on public.organization_regions
  for select using (rbac.cur_role() is not null and "Organization_ID" = rbac.cur_org());
create policy rbac_org_organizations on public.organizations
  for select using (rbac.cur_role() is not null and "Organization_ID" = rbac.cur_org());

-- Only the restricted role may use the helpers
revoke all on schema rbac from public;
grant usage on schema rbac to copilot_ro;
revoke execute on all functions in schema rbac from public;
grant execute on all functions in schema rbac to copilot_ro;
revoke execute on function rbac.sign_user(text) from public, copilot_ro;