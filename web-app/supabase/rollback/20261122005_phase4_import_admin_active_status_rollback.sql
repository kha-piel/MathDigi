-- Restores the original phase4_can_manage_exam_import() (NULL status counted as active).
begin;

do $rollback$
begin
  if to_regprocedure('public.phase4_can_manage_exam_import()') is null then
    raise notice '005 rollback: phase4_can_manage_exam_import() missing; nothing changed';
    return;
  end if;

  create or replace function public.phase4_can_manage_exam_import()
  returns boolean language sql stable security definer set search_path = public
  as $fn$
    select exists (
      select 1 from public.user_profiles
      where user_id = auth.uid() and role in ('admin', 'teacher')
        and coalesce(status, 'active') = 'active'
    );
  $fn$;
end $rollback$;

commit;
