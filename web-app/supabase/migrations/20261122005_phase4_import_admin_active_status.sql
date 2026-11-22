-- Phase 0 follow-up: the exam-import admin check must match the hardened admin helper.
-- Before: phase4_can_manage_exam_import() let admin/teacher profiles with a NULL status pass
-- (coalesce(status, 'active')). After: only status = 'active' passes, matched by user_id.
-- Apply after migrate_phase4_exam_import.sql. Rollback: ../rollback/20261122005_phase4_import_admin_active_status_rollback.sql
begin;

do $migration$
begin
  if to_regprocedure('public.phase4_can_manage_exam_import()') is null then
    raise notice '005 phase4_can_manage_exam_import() missing; nothing changed';
    return;
  end if;

  create or replace function public.phase4_can_manage_exam_import()
  returns boolean language sql stable security definer set search_path = public
  as $fn$
    select exists (
      select 1 from public.user_profiles
      where user_id = auth.uid() and role in ('admin', 'teacher')
        and status = 'active'
    );
  $fn$;
end $migration$;

commit;
