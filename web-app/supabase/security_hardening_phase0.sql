-- Phase 0 security hardening. Run once in the Supabase SQL Editor, AFTER the
-- existing setup_* scripts. Rollback: security_hardening_phase0_rollback.sql.
--
-- Assumptions (taken from the schema files in this folder, not from the live DB):
--   * public.user_profiles(user_id uuid, email text, role text, status text, ...)
--     created by setup_student_learning_history.sql.
--   * public.current_user_is_school_exam_admin() from setup_school_exam_admin_policies.sql
--     guards school_exams / school_exam_* tables.
--   * Storage bucket 'school-exams' from setup_school_exam_storage_bucket.sql.
-- If the live DB uses other table names (e.g. exams / questions), the policies on those
-- tables are NOT touched by this script; review them separately.
--
-- Pre-check (read-only): admin/teacher rows that only matched by email before and will
-- lose admin rights after this script because user_id is not linked to auth.users:
--   select p.email, p.role, p.user_id, u.id as auth_user_id
--   from public.user_profiles p
--   left join auth.users u on lower(u.email) = lower(p.email)
--   where p.role in ('admin', 'teacher')
--     and (p.user_id is null or p.user_id is distinct from u.id);
-- Link those rows (update user_profiles set user_id = <auth_user_id> ...) before running.

begin;

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

-- 2. user_profiles: users may only create a student profile for themselves and may only
--    edit their own row by user_id. Reading by email stays for the login fallback.
drop policy if exists "user_profiles_owner_update" on public.user_profiles;
drop policy if exists "user_profiles_owner_insert" on public.user_profiles;

create policy "user_profiles_owner_update"
on public.user_profiles
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "user_profiles_owner_insert"
on public.user_profiles
for insert
to authenticated
with check (
  user_id = auth.uid()
  and role = 'student'
  and coalesce(status, 'active') = 'active'
  and (email is null or lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
);

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

drop trigger if exists user_profiles_block_privileged_changes on public.user_profiles;
create trigger user_profiles_block_privileged_changes
before update on public.user_profiles
for each row
execute function public.user_profiles_block_privileged_changes();

-- 3. Storage: only admin/teacher may write or delete in 'school-exams'. Public read is kept
--    because exam images are rendered from public URLs.
drop policy if exists "school_exams_authenticated_insert" on storage.objects;
drop policy if exists "school_exams_authenticated_update" on storage.objects;
drop policy if exists "school_exams_authenticated_delete" on storage.objects;
drop policy if exists "school_exams_admin_insert" on storage.objects;
drop policy if exists "school_exams_admin_update" on storage.objects;
drop policy if exists "school_exams_admin_delete" on storage.objects;

create policy "school_exams_admin_insert"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'school-exams' and public.current_user_is_school_exam_admin());

create policy "school_exams_admin_update"
on storage.objects
for update
to authenticated
using (bucket_id = 'school-exams' and public.current_user_is_school_exam_admin())
with check (bucket_id = 'school-exams' and public.current_user_is_school_exam_admin());

create policy "school_exams_admin_delete"
on storage.objects
for delete
to authenticated
using (bucket_id = 'school-exams' and public.current_user_is_school_exam_admin());

commit;
