-- 05_documents.sql  (run on the PRIVATE demo copy only, after Phase 1 and Phase 2)
-- Documents uploaded through the Copilot. Same identity as deals (signed user id).
--
-- Who sees a document:
--   System admin ............... every document in the organization
--   Sales admin / Executive .... documents in own regions; every document if no region in profile
--   Sales rep .................. documents whose region is in own regions (any uploader)
--   A document with no region is visible only to the full-view users above.
-- Who may upload: into one of own regions; full-view users into any region of the organization.
-- Who may delete: the uploader or a system admin.

create table if not exists public.copilot_documents (
  "Doc_ID"          text primary key,
  "Filename"        text not null,
  "Region"          text,
  "Owner_ID"        text not null references public.users ("User_ID"),
  "Organization_ID" uuid not null,
  "Size_Bytes"      bigint not null default 0,
  "Status"          text not null default 'processing'
                    check ("Status" in ('processing', 'ready', 'failed')),
  "Status_Detail"   text,
  "S3_Key"          text,
  "Chunk_Count"     integer not null default 0,
  "Uploaded_At"     timestamptz not null default now(),
  "Updated_At"      timestamptz not null default now()
);
alter table public.copilot_documents enable row level security;
alter table public.copilot_documents force row level security;

-- Full view: system admin, or sales admin / executive with no region
create or replace function rbac.cur_is_full_view() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(rbac.cur_role() in ('System_Admin', 'Admin')
         or (rbac.cur_role() in ('Sales_Admin', 'Executive') and cardinality(rbac.cur_regions()) = 0), false)
$$;

create or replace function rbac.can_see_document(p_region text, p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select rbac.cur_role() is not null
     and p_org = rbac.cur_org()
     and (
       rbac.cur_is_full_view()
       or (rbac.cur_role() in ('Sales_Admin', 'Executive', 'Sales_Rep')
           and btrim(coalesce(p_region, '')) <> ''
           and lower(btrim(p_region)) = any (rbac.cur_regions()))
     )
$$;

-- Every region known in the organization (users, deals, organization_regions), canonical spelling
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
     and (
       (rbac.cur_is_full_view() and rbac.canon_region_one(p_region) = any (rbac.org_regions()))
       or lower(btrim(p_region)) = any (rbac.cur_regions())
     )
$$;

drop policy if exists copilot_documents_select on public.copilot_documents;
create policy copilot_documents_select on public.copilot_documents
  for select using (rbac.can_see_document("Region", "Organization_ID"));

-- Writes go only through these functions; each checks the signed identity itself.
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

-- Only the uploader's own background job updates status. Returns false if the document is gone.
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

-- Uploader or system admin. Returns what the backend must clean up in S3.
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

-- Only the backend role (copilot_app) gets the table and these functions; the LLM's SQL guard
-- does not allow this table or any rbac.* function, and its transactions are read-only anyway.
revoke all on public.copilot_documents from public;
grant select on public.copilot_documents to copilot_app;
revoke execute on function rbac.cur_is_full_view(), rbac.can_see_document(text, uuid), rbac.org_regions(),
  rbac.can_upload_region(text), rbac.doc_create(text, text, text, bigint, text),
  rbac.doc_set_status(text, text, text, integer), rbac.doc_delete(text) from public;
grant execute on function rbac.cur_is_full_view(), rbac.can_see_document(text, uuid), rbac.org_regions(),
  rbac.can_upload_region(text), rbac.doc_create(text, text, text, bigint, text),
  rbac.doc_set_status(text, text, text, integer), rbac.doc_delete(text) to copilot_app;
