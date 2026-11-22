begin;

drop trigger if exists phase4_exam_publish_guard on public.exams;
drop trigger if exists phase4_exam_attempt_guard on public.student_attempts;
drop function if exists public.check_school_exam_import_attempt();
drop function if exists public.check_school_exam_import_publish();
drop function if exists public.set_school_exam_import_state(text, text);
drop function if exists public.save_school_exam_import(jsonb, boolean);

drop policy if exists phase4_asset_visibility on public.question_assets;
drop policy if exists phase4_option_visibility on public.question_options;
drop policy if exists phase4_question_visibility on public.questions;
drop policy if exists phase4_section_visibility on public.exam_sections;
drop policy if exists phase4_exam_visibility on public.exams;
drop function if exists public.phase4_can_manage_exam_import();
drop index if exists public.school_exams_import_pdf_sha256_uq;

-- Retain import metadata, exam rows, and stored objects for recovery.
commit;
