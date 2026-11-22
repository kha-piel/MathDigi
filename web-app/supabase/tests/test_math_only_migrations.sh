#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
NAME="mathdigi-math-only-${RANDOM}-$$"
WORK=$(mktemp -d)
cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
trap 'printf "FAIL: unexpected error at line %s\n" "$LINENO" >&2' ERR

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=local-test-only \
  -p 127.0.0.1::5432 postgres:15 > /dev/null
ready=false
for ((i=0; i<60; i++)); do
  if docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
[[ "$ready" == true ]] || { echo 'FAIL: Postgres startup'; exit 1; }
echo 'PASS: disposable postgres:15 ready (random container and host port)'

sql() { docker exec -i "$NAME" psql -X -q -v ON_ERROR_STOP=1 -U postgres "$@"; }
load() {
  if ! sql < "$1" > "$WORK/load.log" 2>&1; then
    cat "$WORK/load.log"
    echo "FAIL: load $(basename "$1")"
    exit 1
  fi
  echo "PASS: load $(basename "$1")"
}
apply() { echo "--- $(basename "$1")"; sql < "$1"; }
assert_sql() {
  local label=$1 query=$2 result
  result=$(sql -Atc "$query")
  if [[ "$result" != t ]]; then
    printf 'FAIL: %s (got %s)\n' "$label" "$result"
    exit 1
  fi
  printf 'PASS: %s\n' "$label"
}
reject() {
  local label=$1 expected=$2 input=$3
  if sql <<< "$input" > "$WORK/rejected.log" 2>&1; then
    echo "FAIL: $label unexpectedly accepted"
    exit 1
  fi
  if [[ "$(< "$WORK/rejected.log")" != *"$expected"* ]]; then
    cat "$WORK/rejected.log"
    echo "FAIL: $label failed for the wrong reason"
    exit 1
  fi
  echo "PASS: $label"
}
checksums() {
  sql -At <<'SQL'
select format(
  'select %L || ''|'' || count(*) || ''|'' || md5(coalesce(string_agg(to_jsonb(t)::text, E''\n'' order by to_jsonb(t)::text), '''')) from %I.%I t;',
  schemaname || '.' || tablename, schemaname, tablename)
from pg_tables where schemaname in ('public','auth','storage') order by schemaname, tablename
\gexec
SQL
}
math_checksums() {
  sql -At <<'SQL'
with exams as (select * from public.school_exams where subject_code='TOAN' and exam_id not like 'fixture-%'),
questions as (select q.* from public.school_exam_questions q join exams e using(exam_id)),
rows(kind,data) as (
  select 'exams',to_jsonb(e) from exams e
  union all select 'sections',to_jsonb(s) from public.school_exam_sections s join exams e using(exam_id)
  union all select 'questions',to_jsonb(q) - array['review_status','solution','source'] from questions q
  union all select 'options',to_jsonb(o) from public.school_exam_question_options o join questions q using(question_id)
  union all select 'assets',to_jsonb(a) from public.school_exam_question_assets a join questions q using(question_id)
)
select kind || '|' || md5(string_agg(data::text,E'\n' order by data::text)) from rows group by kind order by kind;
SQL
}
schema_dump() {
  docker exec "$NAME" pg_dump -U postgres --schema-only --schema=public \
    | sed '/^\\restrict /d; /^\\unrestrict /d' > "$1"
}

sql <<'SQL'
create role anon;
create role authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as 'select null::uuid';
create function auth.jwt() returns jsonb language sql stable as 'select ''{}''::jsonb';
create table public.user_profiles(user_id uuid primary key references auth.users(id), email text, role text, status text);
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id bigint generated always as identity primary key, bucket_id text references storage.buckets(id), name text);
SQL
for file in school_exams_schema.sql school_exam_questions_schema.sql \
  setup_school_exam_admin_policies.sql setup_student_learning_history.sql \
  setup_school_exam_storage_bucket.sql \
  seed_school_exam_chuyen_le_khiet_quang_2025.sql \
  seed_school_exam_questions_chuyen-le-khiet-quang-2025.sql \
  seed_school_exam_thpt_tran_phu_quang_ninh_2026_lan_3.sql \
  seed_school_exam_questions_thpt-tran-phu-quang-ninh-2026-lan-3.sql \
  seed_school_exam_van_lang_ha_noi.sql \
  seed_school_exam_questions_thpt-van-lang-ha-noi-2025.sql; do
  load "$ROOT/$file"
done

sql <<'SQL'
insert into auth.users values ('00000000-0000-0000-0000-000000000001');
insert into public.user_profiles(user_id,email,role,status)
  values ('00000000-0000-0000-0000-000000000001','student@test.invalid','student','active');
insert into public.school_exams(exam_id,title,school_name,city,subject_code,subject_name,year,pdf_url)
select 'fixture-' || code, 'Fixture', 'School', 'City', code, code, 2026, 'https://invalid/source.pdf'
from unnest(array['VAT_LY','HOA_HOC',' toan ']) code;
insert into public.school_exam_sections(section_id,exam_id,part_code,title,start_question_number,end_question_number)
select exam_id || '-section', exam_id, 'multiple_choice', 'Part I', 1, 10
from public.school_exams where exam_id like 'fixture-%';
insert into public.school_exam_questions(question_id,exam_id,section_id,question_number,question_type,question_text,difficulty_level,explanation,metadata)
select e.exam_id || '-q' || n, e.exam_id, e.exam_id || '-section', n, 'multiple_choice','Question',
  case when n in (2,3) then null else 2 end, 'Original explanation',
  case n when 1 then '{"review_status":"auto_extracted_reviewed"}'::jsonb
    when 2 then '{"review_status":"approved"}'::jsonb
    when 4 then '{"review_status":"pending_review"}'::jsonb
    when 5 then '{"review_status":"reviewed"}'::jsonb
    when 6 then '{"review_status":"draft"}'::jsonb
    when 7 then '{"review_status":"rejected"}'::jsonb
    when 8 then '{"review_status":"unknown"}'::jsonb
    when 10 then '{"review_status":"approved"}'::jsonb
    else '{}'::jsonb end
from public.school_exams e cross join generate_series(1,10) n where e.exam_id like 'fixture-%';
insert into public.school_exam_question_options(option_id,question_id,option_label,option_text)
select question_id || '-A', question_id, 'A', 'Answer' from public.school_exam_questions where exam_id like 'fixture-%';
insert into public.school_exam_question_assets(asset_id,question_id,asset_type,asset_path)
select question_id || '-asset', question_id, 'figure', 'assets/figure.png' from public.school_exam_questions where exam_id like 'fixture-%';
insert into public.student_school_exam_attempts(attempt_id,user_id,school_exam_id,started_at)
select ('00000000-0000-0000-0000-' || lpad(row_number() over ()::text,12,'0'))::uuid,
  '00000000-0000-0000-0000-000000000001', exam_id, '2026-01-01'::timestamptz
from public.school_exams where exam_id like 'fixture-%';
insert into public.student_school_exam_answers(answer_id,attempt_id,question_number,question_type)
select attempt_id,attempt_id,1,'multiple_choice' from public.student_school_exam_attempts;
insert into public.student_school_exam_ai_messages(message_id,attempt_id,role,content)
select attempt_id,attempt_id,'user','Hello' from public.student_school_exam_attempts;
create table public.unknown_answer_children (
  id integer primary key, answer_id uuid references public.student_school_exam_answers(answer_id) on delete cascade
);
insert into public.unknown_answer_children select row_number() over (),answer_id from public.student_school_exam_answers;
create table public.unknown_composite_parent (
  a text, b integer, exam_id text references public.school_exams(exam_id) on delete cascade, primary key(a,b)
);
insert into public.unknown_composite_parent select exam_id,1,exam_id from public.school_exams where exam_id like 'fixture-%';
create table public.unknown_set_null (
  id text primary key,
  a text, b integer,
  question_id text references public.school_exam_questions(question_id) on delete set null,
  foreign key(a,b) references public.unknown_composite_parent(a,b) on delete set null
);
insert into public.unknown_set_null select exam_id,exam_id,1,exam_id || '-q1' from public.school_exams where exam_id like 'fixture-%';
insert into storage.objects(bucket_id,name) values
  ('school-exams','VAT_LY/2026/source.pdf'), ('school-exams','HOA_HOC/2026/source.pdf'), ('school-exams','TOAN/2026/source.pdf');
SQL
echo 'PASS: synthetic exams, history, transitive/composite/SET NULL FKs and Storage fixtures loaded'

PRE="$ROOT/migrations/20261122000_math_only_precheck.sql"
M1="$ROOT/migrations/20261122001_math_only_purge_non_math_exams.sql"
M2="$ROOT/migrations/20261122002_school_exam_questions_review_fields.sql"
R1="$ROOT/rollback/20261122001_math_only_purge_non_math_exams_rollback.sql"
R2="$ROOT/rollback/20261122002_school_exam_questions_review_fields_rollback.sql"

sql <<'SQL'
insert into public.school_exams(exam_id,title,school_name,city,subject_code,subject_name,year,pdf_url)
values ('unknown','Unknown','School','City','MATH','Unknown',2026,'');
SQL
checksums > "$WORK/unknown.before"
reject '001 aborts on unknown subject code' 'Unknown subject_code' "$(< "$M1")"
checksums > "$WORK/unknown.after"
diff -u "$WORK/unknown.before" "$WORK/unknown.after"
echo 'PASS: unknown-code abort is atomic (normalization and all data unchanged)'
sql -c "delete from public.school_exams where exam_id='unknown'"

sql <<'SQL'
alter table public.school_exam_questions add column purge_link text references public.school_exams(exam_id) on delete cascade;
update public.school_exam_questions set purge_link='fixture-VAT_LY' where question_id='fixture- toan -q1';
SQL
reject '001 refuses cross-subject cascade deleting a math question' 'FK cascade would delete math exam data' "$(< "$M1")"
sql -c 'alter table public.school_exam_questions drop column purge_link'
sql <<'SQL'
create table public.no_pk_history(exam_id text references public.school_exams(exam_id) on delete cascade);
insert into public.no_pk_history values ('fixture-VAT_LY');
SQL
reject '001 safely refuses affected table without primary key' 'needs a primary key' "$(< "$M1")"
sql -c 'drop table public.no_pk_history'
sql <<'SQL'
create table public.restrict_history(id integer primary key, exam_id text references public.school_exams(exam_id) on delete restrict);
insert into public.restrict_history values (1,'fixture-VAT_LY');
SQL
reject '001 safely aborts on RESTRICT references' 'restrict_history_exam_id_fkey' "$(< "$M1")"
sql -c 'drop table public.restrict_history'

schema_dump "$WORK/schema.before"
checksums > "$WORK/data.before"
math_checksums > "$WORK/math.before"
MATH_BEFORE=$(sql -Atc "select count(*) from public.school_exams where upper(btrim(subject_code))='TOAN'")
QUESTIONS_BEFORE=$(sql -Atc "select count(*) from public.school_exam_questions q join public.school_exams e using(exam_id) where upper(btrim(e.subject_code))='TOAN'")
apply "$PRE"
apply "$M1"
math_checksums > "$WORK/math.after"
diff -u "$WORK/math.before" "$WORK/math.after"
echo 'PASS: original TOAN exams/sections/questions/options/assets unchanged byte-for-byte'
assert_sql 'math exam count preserved and normalized' "select count(*)=$MATH_BEFORE and bool_and(subject_code='TOAN') from public.school_exams"
assert_sql 'math question count preserved' "select count(*)=$QUESTIONS_BEFORE from public.school_exam_questions"
assert_sql 'non-math history and transitive rows gone' "select (select count(*)=1 from public.student_school_exam_attempts) and (select count(*)=1 from public.student_school_exam_answers) and (select count(*)=1 from public.student_school_exam_ai_messages) and (select count(*)=1 from public.unknown_answer_children)"
assert_sql 'SET NULL rows survive with cleared composite and question FKs' "select count(*)=2 from public.unknown_set_null where a is null and b is null and question_id is null"
assert_sql 'Storage objects not deleted' "select count(*)=3 from storage.objects"
reject 'math-only constraint rejects VAT_LY' 'school_exams_subject_code_math_only_ck' "insert into public.school_exams(exam_id,title,school_name,city,subject_code,subject_name,year,pdf_url) values ('bad','Bad','School','City','VAT_LY','Physics',2026,'');"
assert_sql 'TOAN and Toán học defaults' "select (select pg_get_expr(adbin,adrelid) from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where adrelid='public.school_exams'::regclass and attname='subject_code')='''TOAN''::text' and (select pg_get_expr(adbin,adrelid) from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where adrelid='public.school_exams'::regclass and attname='subject_name')='''Toán học''::text'"

apply "$M2"
math_checksums > "$WORK/math.review"
diff -u "$WORK/math.before" "$WORK/math.review"
echo 'PASS: review backfill preserves every original TOAN field and timestamp'
assert_sql 'review backfill handles reviewed, missing, pending, draft, rejected and unknown metadata' "select bool_and(review_status=case when question_number in (1,5,9,10) then 'approved' else 'pending_review' end) from public.school_exam_questions where exam_id='fixture- toan '"
assert_sql 'solution copied from explanation' 'select bool_and(solution is not distinct from explanation) from public.school_exam_questions'
reject 'approved with null difficulty rejected' 'school_exam_questions_difficulty_required_when_approved_ck' "update public.school_exam_questions set review_status='approved',difficulty_level=null where question_id='fixture- toan -q2';"
reject 'invalid review status rejected' 'school_exam_questions_review_status_ck' "update public.school_exam_questions set review_status='other' where question_id='fixture- toan -q1';"
reject 'existing difficulty 1-4 check retained' 'difficulty_level_check' "update public.school_exam_questions set difficulty_level=5 where question_id='fixture- toan -q1';"
checksums > "$WORK/idempotent.before"
apply "$M1"
apply "$M2"
checksums > "$WORK/idempotent.after"
diff -u "$WORK/idempotent.before" "$WORK/idempotent.after"
echo 'PASS: rerunning 001/002 changes no data'

sql -c "begin; alter table public.school_exam_questions disable trigger user; update public.school_exam_questions set solution='New detailed solution' where question_id='fixture- toan -q1'; alter table public.school_exam_questions enable trigger user; commit;"
reject '002 rollback refuses custom solution data loss' 'Refusing to drop' "$(< "$R2")"
sql -c "begin; alter table public.school_exam_questions disable trigger user; update public.school_exam_questions set solution=explanation where question_id='fixture- toan -q1'; alter table public.school_exam_questions enable trigger user; commit;"
apply "$R2"
apply "$R1"
schema_dump "$WORK/schema.after"
checksums > "$WORK/data.after"
diff -u "$WORK/schema.before" "$WORK/schema.after"
echo 'PASS: public schema dump identical after reverse rollback'
diff -u "$WORK/data.before" "$WORK/data.after"
echo 'PASS: every public/auth/storage table count/checksum identical after reverse rollback'
apply "$R2"
apply "$R1"
echo 'PASS: rollback reruns are no-ops'

# Empty database and missing optional Storage schema are separate scenarios.
sql -c 'create database empty_case'
sql -d empty_case < "$ROOT/school_exams_schema.sql" > "$WORK/empty.log" 2>&1
sql -d empty_case < "$ROOT/school_exam_questions_schema.sql" >> "$WORK/empty.log" 2>&1
for file in "$PRE" "$M1" "$M2" "$R2" "$R1"; do
  sql -d empty_case < "$file" >> "$WORK/empty.log" 2>&1 || { cat "$WORK/empty.log"; exit 1; }
done
echo 'PASS: empty database round trip and precheck without storage schema'
echo 'PASS: all math-only migration assertions'
