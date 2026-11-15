-- =====================================================================================================
-- prod_rollback.sql  -  removes EVERYTHING prod_migration.sql added. The main app's tables, rows and
-- policies are not touched.  Run as a superuser:
--   psql -h <host> -p <port> -U <superuser> -d closemore_next -v ON_ERROR_STOP=1 -f prod_rollback.sql
-- WARNING: drops public.copilot_documents (the list of indexed documents). The PDFs in S3 and the
-- vectors are not deleted by this script.
-- Safe to run more than once.
-- =====================================================================================================

\set ON_ERROR_STOP on
begin;

do $$
declare t text;
begin
  foreach t in array array['deals','deal_team_members','deal_contacts','line_items','contacts','users',
                           'pipelines','deal_types','products','organization_regions','organizations']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists copilot_allow on public.%I', t);
      execute format('drop policy if exists copilot_rules on public.%I', t);
    end if;
  end loop;
end $$;

drop table if exists public.copilot_documents;
drop schema if exists rbac cascade;

do $$
declare r text;
begin
  foreach r in array array['copilot_app', 'copilot_ro', 'copilot_rules_owner']
  loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('drop owned by %I', r);      -- removes every grant given to the role in this database
      begin
        execute format('drop role %I', r);
      exception when dependent_objects_still_exist then
        -- roles belong to the whole server; another database on it still uses this one
        raise notice 'role % kept: another database on this server still uses it (nothing left in this database)', r;
      end;
    end if;
  end loop;
end $$;

commit;

\echo 'CloseMore Copilot changes removed.'
