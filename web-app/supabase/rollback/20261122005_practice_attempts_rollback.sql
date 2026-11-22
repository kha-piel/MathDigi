begin;

do $$
declare
  was_not_null boolean;
begin
  if to_regclass('math_only_backup.migration_state') is null then
    raise notice '005 rollback: no state; before/after unchanged'; return;
  end if;
  if not exists (select 1 from math_only_backup.migration_state where key='005') then
    raise notice '005 rollback: already rolled back; before/after unchanged'; return;
  end if;
  if to_regclass('public.student_attempts') is null then
    raise exception '005 rollback requires public.student_attempts';
  end if;
  lock table public.student_attempts in access exclusive mode;
  select (value->>'exam_id_was_not_null')::boolean into was_not_null
    from math_only_backup.migration_state where key='005';
  if was_not_null and exists (select 1 from public.student_attempts where exam_id is null) then
    raise exception '005 rollback cannot restore NOT NULL while null-exam attempts exist; back up and reconcile them manually';
  end if;
  drop index public.idx_student_attempts_practice_history;
  alter table public.student_attempts drop constraint student_attempts_practice_exam_ck;
  if was_not_null then
    alter table public.student_attempts alter column exam_id set not null;
  end if;
  delete from math_only_backup.migration_state where key='005';
  raise notice '005 rollback complete; original exam_id nullability restored';
end $$;

commit;
