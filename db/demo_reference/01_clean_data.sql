-- 01_clean_data.sql  (run on the PRIVATE demo copy only)
-- 1) region helpers  2) normalize region spelling  3) fill empty deal regions from owners

create schema if not exists rbac;

-- 'east ' / 'EAST' / 'East' -> 'East'  (LATAM stays upper case)
create or replace function rbac.canon_region_one(p text) returns text
language sql immutable as $$
  select case when btrim(coalesce(p, '')) = '' then null
              when lower(btrim(p)) = 'latam' then 'LATAM'
              else initcap(lower(btrim(p))) end
$$;

-- 'Indore , australia' -> 'Indore, Australia'  (duplicates removed, order kept)
create or replace function rbac.canon_region_list(p text) returns text
language sql immutable as $$
  select nullif(string_agg(r, ', ' order by ord), '')
  from (
    select r, min(ord) as ord
    from (
      select rbac.canon_region_one(x) as r, ord
      from unnest(string_to_array(coalesce(p, ''), ',')) with ordinality as t(x, ord)
    ) a
    where r is not null
    group by r
  ) b
$$;

update public.users
   set "Region" = rbac.canon_region_list("Region")
 where "Region" is distinct from rbac.canon_region_list("Region");

update public.deals
   set "Region" = rbac.canon_region_list("Region")
 where "Region" is distinct from rbac.canon_region_list("Region");

-- deal has no region but its owner has one -> use the owner's first region
update public.deals d
   set "Region" = btrim(split_part(u."Region", ',', 1))
  from public.users u
 where u."User_ID" = d."Owner_ID"
   and coalesce(d."Region", '') = ''
   and coalesce(u."Region", '') <> '';
