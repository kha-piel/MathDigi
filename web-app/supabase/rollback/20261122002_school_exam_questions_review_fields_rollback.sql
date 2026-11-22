begin;

do $$
declare
  custom_solutions bigint;
begin
  if to_regclass('math_only_backup.migration_state') is null then
    raise notice '002 rollback: no migration state; before/after unchanged';
    return;
  end if;
  if not exists (select 1 from math_only_backup.migration_state where key = '002') then
    raise notice '002 rollback: already rolled back; before/after unchanged';
    return;
  end if;
  lock table public.school_exam_questions in share row exclusive mode;
  select count(*) into custom_solutions from public.school_exam_questions
    where solution is not null and solution is distinct from explanation;
  raise notice '002 rollback before questions=% custom solutions=%',
    (select count(*) from public.school_exam_questions), custom_solutions;
  if custom_solutions > 0 then
    raise exception 'Refusing to drop % custom solutions; export/reconcile them with explanation first', custom_solutions;
  end if;
  drop index if exists public.idx_school_exam_questions_review_status;
  alter table public.school_exam_questions
    drop constraint if exists school_exam_questions_difficulty_required_when_approved_ck,
    drop constraint if exists school_exam_questions_review_status_ck,
    drop column review_status,
    drop column solution,
    drop column source;
  delete from math_only_backup.migration_state where key = '002';
  raise notice '002 rollback after questions=% review columns removed', (select count(*) from public.school_exam_questions);
end $$;

commit;
