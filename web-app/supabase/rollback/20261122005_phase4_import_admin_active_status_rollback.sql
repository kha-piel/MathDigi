-- Restores the original phase4_can_manage_exam_import() (NULL status counted as active)
-- and drops only the phase4 visibility policies that migration 005 re-created.
begin;

do $rollback$
declare
  pol record;
begin
  if to_regclass('public.security_phase0_005_created_policies') is not null then
    for pol in select * from public.security_phase0_005_created_policies loop
      if to_regclass(format('public.%I', pol.tablename)) is not null then
        execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
      end if;
    end loop;
    drop table public.security_phase0_005_created_policies;
  end if;

  if to_regprocedure('public.phase4_can_manage_exam_import()') is null then
    raise notice '005 rollback: phase4_can_manage_exam_import() missing; function not changed';
    return;
  end if;

  create or replace function public.phase4_can_manage_exam_import()
  returns boolean language sql stable security definer set search_path = public
  as $fn$
    select exists (
      select 1 from public.user_profiles
      where user_id = auth.uid() and role in ('admin', 'teacher')
        and coalesce(status, 'active') = 'active'
    );
  $fn$;
end $rollback$;

commit;
