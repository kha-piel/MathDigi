-- Run against a disposable database with the Phase 4 migration already applied.
begin;
with fixture_user as (
  insert into auth.users (id) values (gen_random_uuid()) returning id
), fixture_admin as (
  insert into public.user_profiles (user_id, email, role, status)
  select id, 'phase4-admin@example.invalid', 'admin', 'active' from fixture_user
  returning user_id
)
select set_config('request.jwt.claim.sub', user_id::text, true) from fixture_admin;

do $$
declare
  sample jsonb := '{
    "exam": {
      "exam_id": "phase4-test", "title": "Test", "school_name": "Test", "city": "Test",
      "subject_code": "TOAN", "subject_name": "Math", "year": 2026, "duration_minutes": 90,
      "pdf_url": "https://example.invalid/test.pdf", "display_variant_code": "101",
      "answer_key_provided": true, "tags": [], "import_attempt_id": "ac8f3c26-c04d-4490-a88f-9bb31ede52f9",
      "import_pdf_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "import_warnings": []
    },
    "sections": [], "assets": [], "options": [],
    "questions": [{
      "question_id": "phase4-test-q1", "question_number": 1, "question_type": "short_answer",
      "question_text": "Find x.", "correct_answer": "4", "difficulty_level": 3,
      "topic": "Mu va logarit", "statement_json": [], "has_image": false,
      "metadata": {"import_issues": [], "import_review_confirmed": true}
    }]
  }';
  other jsonb := jsonb_set(sample, '{exam,exam_id}', '"phase4-other"');
  test_user uuid := '9f8709f6-d837-4bc5-a2e1-283586a170af';
begin
  begin
    perform public.save_school_exam_import(jsonb_set(sample, '{questions,0,question_type}', '"invalid"'));
    raise exception 'Expected a failing child write';
  exception when check_violation then null;
  end;

  if exists (select 1 from public.exams where exam_id = 'phase4-test') then
    raise exception 'Child write did not roll back the exam';
  end if;

  perform public.save_school_exam_import(sample);
  if not exists (
    select 1 from public.questions q join public.topics t using (topic_id)
    where q.question_id = 'phase4-test-q1' and q.review_status = 'pending_review'
      and t.topic_slug = public.math_slugify('Mu va logarit')
  ) then
    raise exception 'Import did not set the Phase 2 review status and topic link';
  end if;
  begin
    perform public.save_school_exam_import(other);
    raise exception 'Expected duplicate hash to fail';
  exception when unique_violation then null;
  end;
  begin
    perform public.set_school_exam_import_state('phase4-test', 'published');
    raise exception 'Published an unreviewed draft';
  exception when raise_exception then
    if sqlerrm not like 'Every question must be validated%' then raise; end if;
  end;

  perform public.save_school_exam_import(
    jsonb_set(sample, '{questions,0,difficulty_level}', 'null'), true
  );
  begin
    perform public.set_school_exam_import_state('phase4-test', 'published');
    raise exception 'Published without difficulty';
  exception when raise_exception then
    if sqlerrm not like 'Every question must be validated%' then raise; end if;
  end;

  perform public.save_school_exam_import(jsonb_set(sample, '{exam}', '{"exam_id":"phase4-test"}'), true);
  if not exists (
    select 1 from public.questions where question_id = 'phase4-test-q1'
      and review_status = 'approved' and topic_id is not null
  ) then
    raise exception 'Review did not approve the question in the Phase 2 column';
  end if;
  if public.set_school_exam_import_state('phase4-test', 'published') <> 'published' then
    raise exception 'Could not publish reviewed questions';
  end if;
  if public.set_school_exam_import_state('phase4-test', 'undo') <> 'undone' then
    raise exception 'Untaken exam was not undone';
  end if;
  if not exists (select 1 from public.questions where question_id = 'phase4-test-q1') then
    raise exception 'Undo did not retain Math data';
  end if;

  other := jsonb_set(other, '{questions,0,question_id}', '"phase4-other-q1"');
  perform public.save_school_exam_import(other);
  perform public.save_school_exam_import(other, true);
  perform public.set_school_exam_import_state('phase4-other', 'published');
  insert into auth.users (id) values (test_user);
  insert into public.student_attempts (user_id, exam_id, started_at)
    values (test_user, 'phase4-other', now());
  if public.set_school_exam_import_state('phase4-other', 'undo') <> 'unpublished' then
    raise exception 'A taken exam must only be unpublished';
  end if;
  if not exists (select 1 from public.student_attempts where exam_id = 'phase4-other') then
    raise exception 'Unpublishing removed student history';
  end if;
end;
$$;

rollback;
