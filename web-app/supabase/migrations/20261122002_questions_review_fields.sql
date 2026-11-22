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
  approved_count bigint;
  solution_count bigint;
  trigger_row record;
begin
  lock table public.questions in share row exclusive mode;
  if exists (select 1 from math_only_backup.migration_state where key = '002') then
    raise notice '002 already applied; before/after questions=%', (select count(*) from public.questions);
    return;
  end if;
  if exists (select 1 from pg_attribute where attrelid = 'public.questions'::regclass
    and attname in ('review_status','solution','source') and not attisdropped) then
    raise exception 'Review columns already exist without migration state; inspect manually before applying 002';
  end if;
  raise notice '002 before questions=%', (select count(*) from public.questions);
  alter table public.questions
    add column review_status text not null default 'pending_review',
    add column solution text null,
    add column source text null;
  create temporary table review_triggers on commit drop as
    select tgname, tgenabled from pg_trigger where tgrelid = 'public.questions'::regclass
      and not tgisinternal and tgenabled <> 'D';
  for trigger_row in select * from review_triggers loop
    execute format('alter table public.questions disable trigger %I', trigger_row.tgname);
  end loop;
  update public.questions set
    review_status = case when difficulty_level is not null and (
      metadata ->> 'review_status' in ('auto_extracted_reviewed','approved','reviewed')
      or metadata ->> 'review_status' is null
    ) then 'approved' else 'pending_review' end,
    solution = explanation where solution is null;
  select count(*) filter (where review_status = 'approved'), count(*) filter (where solution is not null)
    into approved_count, solution_count from public.questions;
  for trigger_row in select * from review_triggers loop
    execute format('alter table public.questions enable %s trigger %I',
      case trigger_row.tgenabled when 'A' then 'always' when 'R' then 'replica' else '' end, trigger_row.tgname);
  end loop;
  alter table public.questions
    add constraint questions_review_status_ck
      check (review_status in ('draft','pending_review','approved','rejected')),
    add constraint questions_difficulty_required_when_approved_ck
      check (review_status <> 'approved' or difficulty_level is not null);
  create index idx_questions_review_status on public.questions (review_status);
  insert into math_only_backup.migration_state(key, value)
    values ('002', jsonb_build_object('approved', approved_count, 'solutions', solution_count));
  raise notice '002 after questions=% approved=% pending_review=% solutions=%',
    (select count(*) from public.questions), approved_count,
    (select count(*) from public.questions) - approved_count, solution_count;
end $$;

commit;
