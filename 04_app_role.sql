-- 04_app_role.sql  (run on the PRIVATE demo copy only, after Phase 1)
-- Creates the login role the backend uses for the Copilot, and removes
-- set_config() from ordinary roles. The password is set by run_phase2.py.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'copilot_app') then
    create role copilot_app login;
  end if;
end $$;

-- Never superuser, never bypasses RLS, cannot create anything
alter role copilot_app login nosuperuser nobypassrls nocreatedb nocreaterole inherit;

-- Gets exactly the SELECT grants of copilot_ro (users.Password excluded)
grant copilot_ro to copilot_app;

-- Safety defaults for every session of this role
alter role copilot_app set default_transaction_read_only = on;
alter role copilot_app set statement_timeout = '30s';
alter role copilot_app set idle_in_transaction_session_timeout = '60s';

-- Extra layer: ordinary roles may not call set_config() at all.
-- (The backend sets identity with SET LOCAL statements, which the SQL guard never lets the LLM send.)
revoke execute on function pg_catalog.set_config(text, text, boolean) from public;

-- Nobody but the owner creates objects in public
revoke create on schema public from public;
