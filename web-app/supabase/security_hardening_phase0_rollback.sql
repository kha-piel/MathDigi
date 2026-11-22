-- Rollback for security_hardening_phase0.sql: drops every phase0_* policy, recreates the
-- policies saved in public.security_phase0_policy_backup, restores each table's original RLS
-- flag and the previous current_user_is_school_exam_admin() (from setup_school_exam_admin_policies.sql).

begin;

create or replace function public.current_user_is_school_exam_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles
    where user_id = auth.uid()
      and role in ('admin', 'teacher')
      and coalesce(status, 'active') = 'active'
  )
  or exists (
    select 1
    from public.user_profiles
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and role in ('admin', 'teacher')
      and coalesce(status, 'active') = 'active'
  )
  or lower(coalesce(auth.jwt() ->> 'email', '')) = 'admin@local.test';
$$;

do $$
begin
  if to_regclass('public.user_profiles') is not null then
    drop trigger if exists user_profiles_block_privileged_changes on public.user_profiles;
  end if;
end;
$$;
drop function if exists public.user_profiles_block_privileged_changes();

do $$
declare
  pol record;
  saved record;
  role_list text;
begin
  for pol in
    select schemaname, tablename, policyname from pg_policies where policyname like 'phase0\_%'
  loop
    execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;

  if to_regclass('public.security_phase0_policy_backup') is null then
    raise notice 'phase0 rollback: no backup table, nothing to restore';
    return;
  end if;

  for saved in
    select * from public.security_phase0_policy_backup where policyname is not null
  loop
    select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ')
      into role_list
    from unnest(saved.roles) as r;

    execute format(
      'create policy %I on %I.%I as %s for %s to %s%s%s',
      saved.policyname, saved.schemaname, saved.tablename, saved.permissive, saved.cmd,
      coalesce(role_list, 'public'),
      case when saved.qual is not null then ' using (' || saved.qual || ')' else '' end,
      case when saved.with_check is not null then ' with check (' || saved.with_check || ')' else '' end
    );
  end loop;

  for saved in
    select * from public.security_phase0_policy_backup
    where policyname is null and rls_enabled = false
  loop
    execute format('alter table %I.%I disable row level security', saved.schemaname, saved.tablename);
  end loop;
end;
$$;

drop table if exists public.security_phase0_policy_backup;

commit;
