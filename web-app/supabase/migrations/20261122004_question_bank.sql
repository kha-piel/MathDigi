begin;

do $migration$
begin
  if exists (select 1 from math_only_backup.migration_state where key='004') then
    raise notice '004 already applied; before/after bank questions=%', (select count(*) from public.question_bank);
    return;
  end if;
  if to_regprocedure('public.current_user_is_school_exam_admin()') is null then
    raise exception '004 requires current_user_is_school_exam_admin() for admin policies';
  end if;
  if to_regclass('public.question_bank') is not null
    or to_regclass('public.question_bank_options') is not null
    or to_regclass('public.question_bank_assets') is not null
    or to_regprocedure('public.set_question_bank_updated_at()') is not null then
    raise exception 'Question bank objects already exist without 004 state; inspect manually';
  end if;
  raise notice '004 before: question bank absent';
  create table public.question_bank (
    question_id text primary key,
    subject_code text not null default 'TOAN' constraint question_bank_math_only_ck check (subject_code='TOAN'),
    topic_id uuid null references public.topics(topic_id) on delete set null,
    topic text,
    question_type text not null check (question_type in ('multiple_choice','true_false','short_answer')),
    difficulty_level integer null check (difficulty_level between 1 and 4),
    review_status text not null default 'pending_review' check (review_status in ('draft','pending_review','approved','rejected')),
    constraint question_bank_difficulty_required_when_approved_ck check (review_status <> 'approved' or difficulty_level is not null),
    question_text text not null,
    statement_json jsonb not null default '[]'::jsonb,
    correct_answer text,
    solution text,
    source text,
    obsidian_source_path text,
    has_image boolean not null default false,
    tags text[] not null default '{}',
    content_hash text,
    metadata jsonb not null default '{}'::jsonb,
    created_by uuid default auth.uid(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create unique index question_bank_content_hash_uq on public.question_bank(content_hash) where content_hash is not null;
  create index idx_question_bank_topic_id on public.question_bank(topic_id);
  create index idx_question_bank_type_level on public.question_bank(question_type,difficulty_level);
  create index idx_question_bank_review_status on public.question_bank(review_status);
  create table public.question_bank_options (
    option_id text primary key,
    question_id text not null references public.question_bank(question_id) on delete cascade,
    option_label text not null,
    option_text text not null,
    display_order integer not null default 0,
    created_at timestamptz not null default now(),
    unique(question_id,option_label)
  );
  create table public.question_bank_assets (
    asset_id text primary key,
    question_id text not null references public.question_bank(question_id) on delete cascade,
    asset_type text not null check (asset_type in ('question_block','figure','table','other')),
    asset_path text not null,
    caption text,
    display_order integer not null default 0,
    created_at timestamptz not null default now()
  );
  execute $fn$create function public.set_question_bank_updated_at() returns trigger
    language plpgsql as $body$begin new.updated_at=now(); return new; end;$body$$fn$;
  create trigger trg_question_bank_updated_at before update on public.question_bank
    for each row execute function public.set_question_bank_updated_at();
  alter table public.question_bank enable row level security;
  alter table public.question_bank_options enable row level security;
  alter table public.question_bank_assets enable row level security;
  create policy question_bank_approved_read on public.question_bank for select to anon, authenticated
    using (review_status='approved');
  create policy question_bank_admin_all on public.question_bank for all to authenticated
    using (public.current_user_is_school_exam_admin()) with check (public.current_user_is_school_exam_admin());
  create policy question_bank_options_approved_read on public.question_bank_options for select to anon, authenticated
    using (exists (select 1 from public.question_bank q where q.question_id=question_bank_options.question_id and q.review_status='approved'));
  create policy question_bank_options_admin_all on public.question_bank_options for all to authenticated
    using (public.current_user_is_school_exam_admin()) with check (public.current_user_is_school_exam_admin());
  create policy question_bank_assets_approved_read on public.question_bank_assets for select to anon, authenticated
    using (exists (select 1 from public.question_bank q where q.question_id=question_bank_assets.question_id and q.review_status='approved'));
  create policy question_bank_assets_admin_all on public.question_bank_assets for all to authenticated
    using (public.current_user_is_school_exam_admin()) with check (public.current_user_is_school_exam_admin());
  grant select on public.question_bank, public.question_bank_options, public.question_bank_assets to anon;
  grant select,insert,update,delete on public.question_bank, public.question_bank_options, public.question_bank_assets to authenticated;
  insert into math_only_backup.migration_state(key,value) values ('004','{}');
  raise notice '004 after: bank questions=0 options=0 assets=0';
end $migration$;

commit;
