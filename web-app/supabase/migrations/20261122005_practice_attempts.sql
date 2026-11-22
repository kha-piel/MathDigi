begin;

create schema if not exists math_only_backup;
revoke all on schema math_only_backup from public;
create table if not exists math_only_backup.migration_state (
  key text primary key,
  value jsonb not null,
  created_at timestamptz not null default now()
);

do $$
declare
  was_not_null boolean;
begin
  if to_regclass('public.student_attempts') is null then
    raise exception '005 requires public.student_attempts';
  end if;
  lock table public.student_attempts in access exclusive mode;
  if exists (select 1 from math_only_backup.migration_state where key='005') then
    raise notice '005 already applied; before/after unchanged'; return;
  end if;
  select attnotnull into was_not_null from pg_attribute
    where attrelid='public.student_attempts'::regclass and attname='exam_id' and not attisdropped;
  if was_not_null is null then
    raise exception '005 requires student_attempts.exam_id';
  end if;
  if exists (select 1 from pg_constraint where conrelid='public.student_attempts'::regclass
    and conname='student_attempts_practice_exam_ck')
    or to_regclass('public.idx_student_attempts_practice_history') is not null then
    raise exception '005 objects already exist without migration state; inspect manually';
  end if;
  if exists (select 1 from public.student_attempts
    where metadata->>'attempt_kind'='practice' and exam_id is not null) then
    raise exception '005 found practice attempts with exam_id; reconcile manually before applying';
  end if;
  alter table public.student_attempts alter column exam_id drop not null;
  alter table public.student_attempts add constraint student_attempts_practice_exam_ck
    check (metadata->>'attempt_kind' is distinct from 'practice' or exam_id is null);
  create index idx_student_attempts_practice_history on public.student_attempts(user_id, completed_at desc)
    where metadata->>'attempt_kind'='practice';
  insert into math_only_backup.migration_state(key,value)
    values ('005', jsonb_build_object('exam_id_was_not_null', was_not_null));
  raise notice '005 applied: exam_id nullable; practice attempts require null exam_id';
end $$;

commit;
