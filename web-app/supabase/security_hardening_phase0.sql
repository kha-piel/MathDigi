-- Phase 0 security hardening. Run once in the Supabase SQL Editor (as postgres).
-- Rollback: security_hardening_phase0_rollback.sql.
--
-- Tables covered (each is skipped with a NOTICE if it or a column it needs is missing):
--   live schema (confirmed by Product Engineer): exams, exam_questions, exam_sections, questions,
--     question_options, question_assets, topics, subjects, student_attempts, attempt_answers,
--     student_answers, student_ai_messages, chat_sessions, chat_messages, user_profiles
--   repo schema (web-app/supabase/*.sql): school_exams, school_exam_sections, school_exam_questions,
--     school_exam_question_options, school_exam_question_assets, student_school_exam_attempts,
--     student_school_exam_answers, student_school_exam_ai_messages
--   storage bucket 'school-exams'
-- For each covered table, every existing policy is copied to public.security_phase0_policy_backup
-- and dropped, then replaced by the phase0_* policies below (so no old permissive policy survives).
--
-- Pre-check (read-only): admin/teacher rows that only matched by email before and will
-- lose admin rights because user_id is not linked to auth.users:
--   select p.email, p.role, p.user_id, u.id as auth_user_id
--   from public.user_profiles p
--   left join auth.users u on lower(u.email) = lower(p.email)
--   where p.role in ('admin', 'teacher')
--     and (p.user_id is null or p.user_id is distinct from u.id);

begin;

create table if not exists public.security_phase0_policy_backup (
  schemaname name not null,
  tablename name not null,
  policyname name null, -- null row = table-level marker holding the original RLS flag
  permissive text null,
  roles name[] null,
  cmd text null,
  qual text null,
  with_check text null,
  rls_enabled boolean null,
  backed_up_at timestamptz not null default now()
);
alter table public.security_phase0_policy_backup enable row level security;
revoke all on public.security_phase0_policy_backup from anon, authenticated;

-- 1. Admin check by user_id only: no email match, no hard-coded admin@local.test.
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
  );
$$;

-- Replaces all policies on public.<p_table> with p_policies (format strings, %I = table name).
create or replace function pg_temp.phase0_secure_table(
  p_table text,
  p_required_columns text[],
  p_parent_table text,
  p_policies text[]
)
returns void
language plpgsql
as $$
declare
  missing text[];
  pol record;
  stmt text;
begin
  if to_regclass(format('public.%I', p_table)) is null then
    raise notice 'phase0: skip public.% (table not found)', p_table;
    return;
  end if;
  if p_parent_table is not null and to_regclass(format('public.%I', p_parent_table)) is null then
    raise notice 'phase0: skip public.% (parent table public.% not found)', p_table, p_parent_table;
    return;
  end if;
  select array_agg(c) into missing
  from unnest(p_required_columns) as c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table and column_name = c
  );
  if missing is not null then
    raise notice 'phase0: skip public.% (missing columns %)', p_table, missing;
    return;
  end if;

  if not exists (
    select 1 from public.security_phase0_policy_backup
    where schemaname = 'public' and tablename = p_table
  ) then
    insert into public.security_phase0_policy_backup (schemaname, tablename, rls_enabled)
    select 'public', p_table, c.relrowsecurity
    from pg_class c
    where c.oid = format('public.%I', p_table)::regclass;

    insert into public.security_phase0_policy_backup
      (schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check)
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public' and tablename = p_table;
  end if;

  for pol in
    select policyname from pg_policies where schemaname = 'public' and tablename = p_table
  loop
    execute format('drop policy %I on public.%I', pol.policyname, p_table);
  end loop;

  execute format('alter table public.%I enable row level security', p_table);
  foreach stmt in array p_policies loop
    execute format(stmt, p_table);
  end loop;
end;
$$;

-- 2. Exam content: anyone may read, only admin/teacher may write.
do $$
declare
  t text;
begin
  foreach t in array array[
    'exam_sections', 'questions', 'question_options', 'question_assets', 'topics', 'subjects',
    'school_exams', 'school_exam_sections', 'school_exam_questions',
    'school_exam_question_options', 'school_exam_question_assets'
  ] loop
    perform pg_temp.phase0_secure_table(t, array[]::text[], null, array[
      'create policy phase0_read_all on public.%I for select using (true)',
      'create policy phase0_admin_insert on public.%I for insert to authenticated with check (public.current_user_is_school_exam_admin())',
      'create policy phase0_admin_update on public.%I for update to authenticated using (public.current_user_is_school_exam_admin()) with check (public.current_user_is_school_exam_admin())',
      'create policy phase0_admin_delete on public.%I for delete to authenticated using (public.current_user_is_school_exam_admin())'
    ]);
  end loop;
end;
$$;

-- exams: students may also create/edit their own custom practice exams (exam-attempt-service.ts).
-- Custom exams are private to their creator; every other exam stays readable by everyone.
select pg_temp.phase0_secure_table('exams', array['created_by', 'exam_type'], null, array[
  'create policy phase0_read on public.%I for select using (exam_type is distinct from ''custom'' or created_by = auth.uid() or public.current_user_is_school_exam_admin())',
  'create policy phase0_insert on public.%I for insert to authenticated with check (public.current_user_is_school_exam_admin() or (created_by = auth.uid() and exam_type = ''custom''))',
  'create policy phase0_update on public.%I for update to authenticated using (public.current_user_is_school_exam_admin() or (created_by = auth.uid() and exam_type = ''custom'')) with check (public.current_user_is_school_exam_admin() or (created_by = auth.uid() and exam_type = ''custom''))',
  'create policy phase0_delete on public.%I for delete to authenticated using (public.current_user_is_school_exam_admin() or (created_by = auth.uid() and exam_type = ''custom''))'
]);

select pg_temp.phase0_secure_table('exam_questions', array['exam_id'], 'exams', array[
  'create policy phase0_read on public.%I for select using (public.current_user_is_school_exam_admin() or exists (select 1 from public.exams e where e.exam_id = exam_questions.exam_id and (e.exam_type is distinct from ''custom'' or e.created_by = auth.uid())))',
  'create policy phase0_insert on public.%I for insert to authenticated with check (public.current_user_is_school_exam_admin() or exists (select 1 from public.exams e where e.exam_id = exam_questions.exam_id and e.created_by = auth.uid() and e.exam_type = ''custom''))',
  'create policy phase0_update on public.%I for update to authenticated using (public.current_user_is_school_exam_admin() or exists (select 1 from public.exams e where e.exam_id = exam_questions.exam_id and e.created_by = auth.uid() and e.exam_type = ''custom'')) with check (public.current_user_is_school_exam_admin() or exists (select 1 from public.exams e where e.exam_id = exam_questions.exam_id and e.created_by = auth.uid() and e.exam_type = ''custom''))',
  'create policy phase0_delete on public.%I for delete to authenticated using (public.current_user_is_school_exam_admin() or exists (select 1 from public.exams e where e.exam_id = exam_questions.exam_id and e.created_by = auth.uid() and e.exam_type = ''custom''))'
]);

-- 3. Student data: owner only (by user_id), admin/teacher may read.
do $$
declare
  t text;
begin
  foreach t in array array['student_attempts', 'student_school_exam_attempts', 'chat_sessions'] loop
    perform pg_temp.phase0_secure_table(t, array['user_id'], null, array[
      'create policy phase0_owner_select on public.%I for select to authenticated using (user_id = auth.uid() or public.current_user_is_school_exam_admin())',
      'create policy phase0_owner_insert on public.%I for insert to authenticated with check (user_id = auth.uid())',
      'create policy phase0_owner_update on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())'
    ]);
  end loop;
end;
$$;

-- Child rows: owned through their parent attempt / chat session.
do $$
declare
  child record;
  owner_check text;
begin
  for child in
    select * from (values
      ('attempt_answers', 'attempt_id', 'student_attempts', 'attempt_id'),
      ('student_answers', 'attempt_id', 'student_attempts', 'attempt_id'),
      ('student_ai_messages', 'attempt_id', 'student_attempts', 'attempt_id'),
      ('student_school_exam_answers', 'attempt_id', 'student_school_exam_attempts', 'attempt_id'),
      ('student_school_exam_ai_messages', 'attempt_id', 'student_school_exam_attempts', 'attempt_id'),
      ('chat_messages', 'session_id', 'chat_sessions', 'session_id')
    ) as v(child_table, fk_column, parent_table, parent_key)
  loop
    owner_check := format(
      'exists (select 1 from public.%I p where p.%I = %I.%I and p.user_id = auth.uid())',
      child.parent_table, child.parent_key, child.child_table, child.fk_column
    );
    perform pg_temp.phase0_secure_table(child.child_table, array[child.fk_column], child.parent_table, array[
      'create policy phase0_owner_select on public.%I for select to authenticated using (' || owner_check || ' or public.current_user_is_school_exam_admin())',
      'create policy phase0_owner_insert on public.%I for insert to authenticated with check (' || owner_check || ')',
      'create policy phase0_owner_update on public.%I for update to authenticated using (' || owner_check || ') with check (' || owner_check || ')'
    ]);
  end loop;
end;
$$;

-- 4. user_profiles: users may only create a student profile for themselves and edit their own
--    row by user_id. Reading by email stays for the login fallback in auth-service.ts.
select pg_temp.phase0_secure_table('user_profiles', array['user_id', 'email', 'role', 'status'], null, array[
  'create policy phase0_owner_select on public.%I for select to authenticated using (user_id = auth.uid() or lower(email) = lower(coalesce(auth.jwt() ->> ''email'', '''')))',
  'create policy phase0_owner_update on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
  'create policy phase0_owner_insert on public.%I for insert to authenticated with check (user_id = auth.uid() and role = ''student'' and coalesce(status, ''active'') = ''active'' and (email is null or lower(email) = lower(coalesce(auth.jwt() ->> ''email'', ''''))))'
]);

-- Role/status/user_id are privileged; email may only be synced to the caller's auth email.
-- Changes made as postgres / service_role (SQL Editor, server scripts) are not blocked.
create or replace function public.user_profiles_block_privileged_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.role is distinct from old.role
      or new.status is distinct from old.status
      or new.user_id is distinct from old.user_id then
      raise exception 'Khong duoc tu doi role/status/user_id cua user_profiles'
        using errcode = '42501';
    end if;
    if new.email is distinct from old.email
      and lower(coalesce(new.email, '')) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
      raise exception 'Email profile phai trung email dang nhap'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.user_profiles') is not null then
    drop trigger if exists user_profiles_block_privileged_changes on public.user_profiles;
    create trigger user_profiles_block_privileged_changes
    before update on public.user_profiles
    for each row
    execute function public.user_profiles_block_privileged_changes();
  end if;
end;
$$;

-- 5. Storage 'school-exams': public read stays (exam images use public URLs); only admin/teacher
--    may write or delete. Every existing policy mentioning the bucket is backed up and replaced.
do $$
declare
  pol record;
begin
  for pol in
    select * from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') like '%school-exams%' or coalesce(with_check, '') like '%school-exams%')
  loop
    if not exists (
      select 1 from public.security_phase0_policy_backup
      where schemaname = 'storage' and tablename = 'objects' and policyname = pol.policyname
    ) and pol.policyname not like 'phase0\_%' then
      insert into public.security_phase0_policy_backup
        (schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check)
      values ('storage', 'objects', pol.policyname, pol.permissive, pol.roles, pol.cmd, pol.qual, pol.with_check);
    end if;
    execute format('drop policy %I on storage.objects', pol.policyname);
  end loop;
end;
$$;

create policy phase0_school_exams_read
on storage.objects
for select
using (bucket_id = 'school-exams');

create policy phase0_school_exams_admin_insert
on storage.objects
for insert
to authenticated
with check (bucket_id = 'school-exams' and public.current_user_is_school_exam_admin());

create policy phase0_school_exams_admin_update
on storage.objects
for update
to authenticated
using (bucket_id = 'school-exams' and public.current_user_is_school_exam_admin())
with check (bucket_id = 'school-exams' and public.current_user_is_school_exam_admin());

create policy phase0_school_exams_admin_delete
on storage.objects
for delete
to authenticated
using (bucket_id = 'school-exams' and public.current_user_is_school_exam_admin());

commit;
