-- Rollback for security_hardening_phase0.sql: restores the previous (insecure) behaviour
-- exactly as defined in setup_school_exam_admin_policies.sql,
-- setup_student_learning_history.sql and setup_school_exam_storage_bucket.sql.

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

drop trigger if exists user_profiles_block_privileged_changes on public.user_profiles;
drop function if exists public.user_profiles_block_privileged_changes();

drop policy if exists "user_profiles_owner_update" on public.user_profiles;
drop policy if exists "user_profiles_owner_insert" on public.user_profiles;

create policy "user_profiles_owner_update"
on public.user_profiles
for update
to authenticated
using (user_id = auth.uid() or lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
with check (user_id = auth.uid() or lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "user_profiles_owner_insert"
on public.user_profiles
for insert
to authenticated
with check (user_id = auth.uid() or lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "school_exams_admin_insert" on storage.objects;
drop policy if exists "school_exams_admin_update" on storage.objects;
drop policy if exists "school_exams_admin_delete" on storage.objects;

create policy "school_exams_authenticated_insert"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'school-exams');

create policy "school_exams_authenticated_update"
on storage.objects
for update
to authenticated
using (bucket_id = 'school-exams')
with check (bucket_id = 'school-exams');

create policy "school_exams_authenticated_delete"
on storage.objects
for delete
to authenticated
using (bucket_id = 'school-exams');

commit;
