begin;

create function public.phase4_can_manage_exam_import()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where user_id = auth.uid() and role in ('admin', 'teacher')
      and coalesce(status, 'active') = 'active'
  );
$$;

alter table public.exams
  add column if not exists import_pdf_sha256 text,
  add column if not exists import_attempt_id uuid,
  add column if not exists import_state text,
  add column if not exists import_warnings jsonb not null default '[]'::jsonb;

alter table public.question_assets
  add column if not exists import_archived boolean not null default false;

create unique index if not exists school_exams_import_pdf_sha256_uq
  on public.exams (import_pdf_sha256)
  where import_pdf_sha256 is not null and import_state <> 'undone';

create policy phase4_exam_visibility on public.exams as restrictive for select
  using (import_state is null or is_active or public.phase4_can_manage_exam_import());

create policy phase4_section_visibility on public.exam_sections as restrictive for select
  using (exists (select 1 from public.exams e where e.exam_id = exam_sections.exam_id));

create policy phase4_question_visibility on public.questions as restrictive for select
  using (exists (select 1 from public.exams e where e.exam_id = questions.exam_id));

create policy phase4_option_visibility on public.question_options as restrictive for select
  using (exists (select 1 from public.questions q where q.question_id = question_options.question_id));

create policy phase4_asset_visibility on public.question_assets as restrictive for select
  using (
    (not import_archived or public.phase4_can_manage_exam_import())
    and exists (select 1 from public.questions q where q.question_id = question_assets.question_id)
  );

create function public.save_school_exam_import(bundle jsonb, reviewing boolean default false)
returns void language plpgsql security invoker set search_path = public
as $$
declare
  exam public.exams := jsonb_populate_record(null::public.exams, bundle->'exam');
begin
  if not public.phase4_can_manage_exam_import() then
    raise insufficient_privilege using message = 'School exam admin required';
  end if;

  if reviewing then
    select e.* into exam from public.exams e
      where e.exam_id = exam.exam_id and (e.import_state is null or not e.is_active) for update;
    if not found then
      raise exception 'Exam missing or currently published';
    end if;
    if exists (
      (select question_id from public.questions where exam_id = exam.exam_id)
      except
      (select q.question_id from jsonb_populate_recordset(null::public.questions, bundle->'questions') q)
    ) or exists (
      (select q.question_id from jsonb_populate_recordset(null::public.questions, bundle->'questions') q)
      except
      (select question_id from public.questions where exam_id = exam.exam_id)
    ) then
      raise exception 'Existing question IDs cannot change during review';
    end if;
    update public.exams set answer_key_provided = not exists (
      select 1 from jsonb_populate_recordset(null::public.questions, bundle->'questions') q
      where btrim(coalesce(q.correct_answer, '')) = ''
    ) where exam_id = exam.exam_id;
  else
    if exam.import_pdf_sha256 is null or exam.import_pdf_sha256 !~ '^[0-9a-f]{64}$'
      or exam.import_attempt_id is null then
      raise exception 'Missing or invalid PDF fingerprint';
    end if;
    insert into public.exams (
      exam_id, title, school_name, city, subject_code, subject_name, year, duration_minutes,
      pdf_url, display_variant_code, answer_key_provided, source_path, tags, is_active,
      import_pdf_sha256, import_attempt_id, import_state, import_warnings
    ) values (
      exam.exam_id, exam.title, exam.school_name, exam.city, exam.subject_code, exam.subject_name,
      exam.year, exam.duration_minutes, exam.pdf_url, exam.display_variant_code,
      exam.answer_key_provided, exam.source_path, exam.tags, false, exam.import_pdf_sha256,
      exam.import_attempt_id, 'pending_review', exam.import_warnings
    );
  end if;

  insert into public.exam_sections (
    section_id, exam_id, part_code, title, instructions, start_question_number,
    end_question_number, display_order, options_per_question, statement_count
  )
  select s.section_id, exam.exam_id, s.part_code, s.title, s.instructions, s.start_question_number,
    s.end_question_number, s.display_order, s.options_per_question, s.statement_count
  from jsonb_populate_recordset(null::public.exam_sections, bundle->'sections') s
  on conflict (section_id) do update set
    start_question_number = excluded.start_question_number, end_question_number = excluded.end_question_number
  where exam_sections.exam_id = excluded.exam_id and reviewing;

  insert into public.questions (
    question_id, exam_id, section_id, question_number, difficulty_level, question_type,
    question_text, correct_answer, statement_json, topic, topic_id, has_image, metadata, review_status
  )
  select q.question_id, exam.exam_id, q.section_id, q.question_number, q.difficulty_level,
    q.question_type, q.question_text, q.correct_answer, q.statement_json, q.topic, t.topic_id,
    q.has_image, q.metadata - 'review_status', case when reviewing
      and q.metadata->'import_review_confirmed' = 'true'::jsonb
      and jsonb_typeof(q.metadata->'import_issues') = 'array'
      and q.metadata->'import_issues' = '[]'::jsonb and q.difficulty_level between 1 and 4
      then 'approved' else 'pending_review' end
  from jsonb_populate_recordset(null::public.questions, bundle->'questions') q
  left join public.subjects s on s.subject_code = exam.subject_code
  left join public.topics t on t.subject_id = s.subject_id and t.topic_slug = public.math_slugify(q.topic)
  on conflict (question_id) do update set
    difficulty_level = excluded.difficulty_level, question_text = excluded.question_text,
    correct_answer = excluded.correct_answer, statement_json = excluded.statement_json,
    topic = excluded.topic, topic_id = excluded.topic_id, has_image = excluded.has_image,
    metadata = (questions.metadata - 'review_status') || excluded.metadata, review_status = excluded.review_status
  where questions.exam_id = excluded.exam_id and reviewing;

  insert into public.question_options (
    option_id, question_id, option_label, option_text, display_order
  )
  select o.option_id, o.question_id, o.option_label, o.option_text, o.display_order
  from jsonb_populate_recordset(null::public.question_options, bundle->'options') o
  join public.questions q using (question_id)
  where q.exam_id = exam.exam_id
  on conflict (question_id, option_label) do update set
    option_text = excluded.option_text, display_order = excluded.display_order
  where reviewing;

  if reviewing then
    update public.question_assets a set import_archived = true
      from public.questions q
      where a.question_id = q.question_id and q.exam_id = exam.exam_id
        and not exists (
          select 1 from jsonb_populate_recordset(null::public.question_assets, bundle->'assets') incoming
          where incoming.asset_id = a.asset_id
        );
  end if;
  insert into public.question_assets (
    asset_id, question_id, asset_type, asset_path, caption, display_order
  )
  select a.asset_id, a.question_id, a.asset_type, a.asset_path, a.caption, a.display_order
  from jsonb_populate_recordset(null::public.question_assets, bundle->'assets') a
  join public.questions q using (question_id)
  where q.exam_id = exam.exam_id
  on conflict (asset_id) do update set display_order = excluded.display_order, import_archived = false
  where question_assets.question_id = excluded.question_id and reviewing;
end;
$$;

create function public.set_school_exam_import_state(target_exam_id text, target_state text)
returns text language plpgsql security definer set search_path = public
as $$
declare
  prior_state text;
  next_state text;
begin
  if not public.phase4_can_manage_exam_import() then
    raise insufficient_privilege using message = 'School exam admin required';
  end if;
  if target_state is null or target_state not in ('published', 'undo') then
    raise exception 'Invalid import state';
  end if;
  select import_state into prior_state from public.exams
    where exam_id = target_exam_id for update;
  if not found then
    raise exception 'Import not found';
  end if;
  if target_state = 'published' then
    if prior_state is null then raise exception 'Import not found'; end if;
    next_state := 'published';
  elsif prior_state is null or exists (
    select 1 from public.student_attempts where exam_id = target_exam_id
  ) then
    next_state := 'unpublished';
  else
    next_state := 'undone';
  end if;
  update public.exams
    set import_state = case when prior_state is not null then next_state end,
      is_active = next_state = 'published'
    where exam_id = target_exam_id;
  return next_state;
end;
$$;

create function public.check_school_exam_import_attempt()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  exam_state text;
begin
  select import_state into exam_state from public.exams
    where exam_id = new.exam_id for key share;
  if exam_state in ('undone', 'pending_review') then
    raise exception 'This exam is not available for attempts';
  end if;
  return new;
end;
$$;

create trigger phase4_exam_attempt_guard before insert or update of exam_id
on public.student_attempts for each row execute function public.check_school_exam_import_attempt();

create function public.check_school_exam_import_publish()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.import_state is not null and new.is_active then
    if new.import_state <> 'published'
      or not exists (select 1 from public.questions q where q.exam_id = new.exam_id)
      or exists (
        select 1 from public.questions q where q.exam_id = new.exam_id
          and (q.review_status is distinct from 'approved'
            or q.metadata->'import_issues' is distinct from '[]'::jsonb
            or q.difficulty_level is null or q.difficulty_level not between 1 and 4
            or btrim(q.question_text) = ''
            or btrim(coalesce(q.topic, '')) = ''
            or (q.question_type = 'multiple_choice' and (
              coalesce(q.correct_answer, '') !~ '^[A-D]$'
              or 4 <> (select count(*) from public.question_options o
                where o.question_id = q.question_id and o.option_label in ('A','B','C','D')
                  and btrim(o.option_text) <> '')
            ))
            or (q.question_type = 'true_false' and (
              coalesce(q.correct_answer, '') !~ '^[DS]{4}$'
              or 4 <> (select count(distinct s->>'label') from jsonb_array_elements(q.statement_json) s
                where s->>'label' in ('a','b','c','d') and btrim(s->>'text') <> '')
            ))
            or (q.question_type = 'short_answer' and
              btrim(coalesce(q.correct_answer, '')) !~ '^[+-]?[0-9]+([.,][0-9]+)?([[:space:]]*[|][[:space:]]*[+-]?[0-9]+([.,][0-9]+)?)*$'))
      ) then
      raise exception 'Every question must be validated and reviewed before publishing';
    end if;
  end if;
  return new;
end;
$$;

create trigger phase4_exam_publish_guard before insert or update of is_active, import_state
on public.exams for each row execute function public.check_school_exam_import_publish();

revoke execute on function public.phase4_can_manage_exam_import() from public;
grant execute on function public.phase4_can_manage_exam_import() to anon, authenticated;
revoke execute on function public.save_school_exam_import(jsonb, boolean) from public, anon;
revoke execute on function public.set_school_exam_import_state(text, text) from public, anon;
grant execute on function public.save_school_exam_import(jsonb, boolean) to authenticated;
grant execute on function public.set_school_exam_import_state(text, text) to authenticated;

commit;
