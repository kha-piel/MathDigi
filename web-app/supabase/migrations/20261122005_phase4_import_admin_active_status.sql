-- Phase 0 follow-up for the exam-import (phase4) objects.
-- 1. phase4_can_manage_exam_import() let admin/teacher profiles with a NULL status pass
--    (coalesce(status, 'active')). Now only status = 'active' passes, matched by user_id.
-- 2. security_hardening_phase0.sql drops every existing policy on exams / exam_sections /
--    questions / question_options / question_assets. If phase4 ran before it, the restrictive
--    phase4_*_visibility policies that hide unpublished imports are gone. Re-create any missing one.
-- Apply after migrate_phase4_exam_import.sql and security_hardening_phase0.sql (in either order).
-- Rollback: ../rollback/20261122005_phase4_import_admin_active_status_rollback.sql
begin;

create table if not exists public.security_phase0_005_created_policies (
  tablename name not null,
  policyname name not null,
  primary key (tablename, policyname)
);

do $migration$
declare
  pol record;
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

  for pol in
    select * from (values
      ('exams', 'phase4_exam_visibility',
       'create policy phase4_exam_visibility on public.exams as restrictive for select using (import_state is null or is_active or public.phase4_can_manage_exam_import())'),
      ('exam_sections', 'phase4_section_visibility',
       'create policy phase4_section_visibility on public.exam_sections as restrictive for select using (exists (select 1 from public.exams e where e.exam_id = exam_sections.exam_id))'),
      ('questions', 'phase4_question_visibility',
       'create policy phase4_question_visibility on public.questions as restrictive for select using (exists (select 1 from public.exams e where e.exam_id = questions.exam_id))'),
      ('question_options', 'phase4_option_visibility',
       'create policy phase4_option_visibility on public.question_options as restrictive for select using (exists (select 1 from public.questions q where q.question_id = question_options.question_id))'),
      ('question_assets', 'phase4_asset_visibility',
       'create policy phase4_asset_visibility on public.question_assets as restrictive for select using ((not import_archived or public.phase4_can_manage_exam_import()) and exists (select 1 from public.questions q where q.question_id = question_assets.question_id))')
    ) as p(tablename, policyname, ddl)
  loop
    if to_regclass(format('public.%I', pol.tablename)) is null then
      raise notice '005 table % missing; % skipped', pol.tablename, pol.policyname;
    elsif not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = pol.tablename and policyname = pol.policyname
    ) then
      execute pol.ddl;
      insert into public.security_phase0_005_created_policies values (pol.tablename, pol.policyname)
        on conflict do nothing;
      raise notice '005 re-created %.%', pol.tablename, pol.policyname;
    end if;
  end loop;
end $migration$;

commit;
