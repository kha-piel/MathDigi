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
with exams as (select * from public.exams where subject_code='TOAN' and exam_id not like 'fixture-%'),
questions as (select q.* from public.questions q join exams e using(exam_id)),
rows(kind,data) as (
  select 'exams',to_jsonb(e) from exams e
  union all select 'sections',to_jsonb(s) from public.exam_sections s join exams e using(exam_id)
  union all select 'questions',to_jsonb(q) - array['review_status','solution','source','topic_id'] from questions q
  union all select 'options',to_jsonb(o) from public.question_options o join questions q using(question_id)
  union all select 'assets',to_jsonb(a) from public.question_assets a join questions q using(question_id)
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
create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.auth_uid'',true),'''')::uuid';
create function auth.jwt() returns jsonb language sql stable as 'select ''{}''::jsonb';
grant usage on schema auth to anon,authenticated;
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
do $$
declare item record; policy_row record; new_policy text;
begin
  for item in select * from (values
    ('school_exams','exams'),('school_exam_sections','exam_sections'),
    ('school_exam_questions','questions'),('school_exam_question_options','question_options'),
    ('school_exam_question_assets','question_assets'),('student_school_exam_attempts','student_attempts'),
    ('student_school_exam_answers','student_answers'),('student_school_exam_ai_messages','student_ai_messages')
  ) names(old_name,new_name) loop
    execute format('alter table public.%I rename to %I',item.old_name,item.new_name);
    for policy_row in select polname from pg_policy where polrelid=to_regclass('public.'||item.new_name) loop
      new_policy:=replace(policy_row.polname,item.old_name,item.new_name);
      execute format('alter policy %I on public.%I rename to %I',policy_row.polname,item.new_name,new_policy);
    end loop;
  end loop;
end $$;
alter table public.student_attempts rename column school_exam_id to exam_id;
create table public.subjects (
  subject_id uuid primary key default gen_random_uuid(), subject_code text, subject_name text,
  is_active boolean default true, created_at timestamptz default timezone('utc',now()),
  updated_at timestamptz default timezone('utc',now())
);
create table public.topics (
  topic_id uuid primary key default gen_random_uuid(),subject_id uuid not null references public.subjects(subject_id),
  parent_topic_id uuid references public.topics(topic_id),topic_name text not null,topic_slug text,
  topic_order integer default 0,description text,is_active boolean default true,
  created_at timestamptz default timezone('utc',now()),updated_at timestamptz default timezone('utc',now())
);
grant select on public.topics to anon;
grant select,insert,update,delete on public.topics to authenticated;
create function public.set_catalog_updated_at() returns trigger language plpgsql
  as $$begin new.updated_at=now(); return new; end;$$;
create trigger catalog_subjects_updated before update on public.subjects for each row execute function public.set_catalog_updated_at();
create trigger catalog_topics_updated before update on public.topics for each row execute function public.set_catalog_updated_at();
insert into public.subjects(subject_code,subject_name) values ('TOAN','Toán học'),('LY','Vật Lý'),('HOA','Hóa học');
insert into public.topics(subject_id,topic_name,topic_order)
select subject_id,name,n from public.subjects cross join (values ('Tich phan',1),('Logarit',2),('Khao sat ham so',3)) topics(name,n)
where subject_code='TOAN';
insert into public.topics(subject_id,topic_name) select subject_id,subject_name from public.subjects where subject_code<>'TOAN';
create table public.legacy_exams(exam_id text primary key,subject_id uuid references public.subjects(subject_id));
create table public.legacy_questions(question_id text primary key,topic_id uuid references public.topics(topic_id));
insert into public.legacy_exams select subject_code,subject_id from public.subjects;
insert into public.legacy_questions select topic_id::text,topic_id from public.topics;
insert into auth.users values ('00000000-0000-0000-0000-000000000001');
insert into auth.users values ('00000000-0000-0000-0000-000000000002');
insert into public.user_profiles(user_id,email,role,status)
  values ('00000000-0000-0000-0000-000000000001','student@test.invalid','student','active');
insert into public.user_profiles(user_id,email,role,status)
  values ('00000000-0000-0000-0000-000000000002','admin@test.invalid','admin','active');
insert into public.exams(exam_id,title,school_name,city,subject_code,subject_name,year,pdf_url)
select 'fixture-' || code, 'Fixture', 'School', 'City', code, code, 2026, 'https://invalid/source.pdf'
from unnest(array['VAT_LY','HOA_HOC',' toan ']) code;
insert into public.exam_sections(section_id,exam_id,part_code,title,start_question_number,end_question_number)
select exam_id || '-section', exam_id, 'multiple_choice', 'Part I', 1, 10
from public.exams where exam_id like 'fixture-%';
insert into public.questions(question_id,exam_id,section_id,question_number,question_type,question_text,difficulty_level,explanation,metadata)
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
from public.exams e cross join generate_series(1,10) n where e.exam_id like 'fixture-%';
insert into public.question_options(option_id,question_id,option_label,option_text)
select question_id || '-A', question_id, 'A', 'Answer' from public.questions where exam_id like 'fixture-%';
insert into public.question_assets(asset_id,question_id,asset_type,asset_path)
select question_id || '-asset', question_id, 'figure', 'assets/figure.png' from public.questions where exam_id like 'fixture-%';
update public.questions set topic='Đường tích phân' where exam_id like 'fixture-%';
insert into public.student_attempts(attempt_id,user_id,exam_id,started_at)
select ('00000000-0000-0000-0000-' || lpad(row_number() over ()::text,12,'0'))::uuid,
  '00000000-0000-0000-0000-000000000001', exam_id, '2026-01-01'::timestamptz
from public.exams where exam_id like 'fixture-%';
insert into public.student_answers(answer_id,attempt_id,question_number,question_type)
select attempt_id,attempt_id,1,'multiple_choice' from public.student_attempts;
insert into public.student_ai_messages(message_id,attempt_id,role,content)
select attempt_id,attempt_id,'user','Hello' from public.student_attempts;
create table public.unknown_answer_children (
  id integer primary key, answer_id uuid references public.student_answers(answer_id) on delete cascade
);
insert into public.unknown_answer_children select row_number() over (),answer_id from public.student_answers;
create table public.unknown_composite_parent (
  a text, b integer, exam_id text references public.exams(exam_id) on delete cascade, primary key(a,b)
);
insert into public.unknown_composite_parent select exam_id,1,exam_id from public.exams where exam_id like 'fixture-%';
create table public.unknown_set_null (
  id text primary key,
  a text, b integer,
  question_id text references public.questions(question_id) on delete set null,
  foreign key(a,b) references public.unknown_composite_parent(a,b) on delete set null
);
insert into public.unknown_set_null select exam_id,exam_id,1,exam_id || '-q1' from public.exams where exam_id like 'fixture-%';
insert into storage.objects(bucket_id,name) values
  ('school-exams','VAT_LY/2026/source.pdf'), ('school-exams','HOA_HOC/2026/source.pdf'), ('school-exams','TOAN/2026/source.pdf');
SQL
echo 'PASS: synthetic exams, history, transitive/composite/SET NULL FKs and Storage fixtures loaded'

PRE="$ROOT/migrations/20261122000_math_only_precheck.sql"
M1="$ROOT/migrations/20261122001_math_only_purge_non_math_exams.sql"
M2="$ROOT/migrations/20261122002_questions_review_fields.sql"
M3="$ROOT/migrations/20261122003_math_topics.sql"
M4="$ROOT/migrations/20261122004_question_bank.sql"
R1="$ROOT/rollback/20261122001_math_only_purge_non_math_exams_rollback.sql"
R2="$ROOT/rollback/20261122002_questions_review_fields_rollback.sql"
R3="$ROOT/rollback/20261122003_math_topics_rollback.sql"
R4="$ROOT/rollback/20261122004_question_bank_rollback.sql"

sql <<'SQL'
insert into public.exams(exam_id,title,school_name,city,subject_code,subject_name,year,pdf_url)
values ('unknown','Unknown','School','City','MATH','Unknown',2026,'');
SQL
checksums > "$WORK/unknown.before"
reject '001 aborts on unknown subject code' 'Unknown subject_code' "$(< "$M1")"
checksums > "$WORK/unknown.after"
diff -u "$WORK/unknown.before" "$WORK/unknown.after"
echo 'PASS: unknown-code abort is atomic (normalization and all data unchanged)'
sql -c "delete from public.exams where exam_id='unknown'"

sql <<'SQL'
alter table public.questions add column purge_link text references public.exams(exam_id) on delete cascade;
update public.questions set purge_link='fixture-VAT_LY' where question_id='fixture- toan -q1';
SQL
reject '001 refuses cross-subject cascade deleting a math question' 'FK cascade would delete math exam data' "$(< "$M1")"
sql -c 'alter table public.questions drop column purge_link'
sql <<'SQL'
create table public.no_pk_history(exam_id text references public.exams(exam_id) on delete cascade);
insert into public.no_pk_history values ('fixture-VAT_LY');
SQL
reject '001 safely refuses affected table without primary key' 'needs a primary key' "$(< "$M1")"
sql -c 'drop table public.no_pk_history'
sql <<'SQL'
create table public.restrict_history(id integer primary key, exam_id text references public.exams(exam_id) on delete restrict);
insert into public.restrict_history values (1,'fixture-VAT_LY');
SQL
reject '001 safely aborts on RESTRICT references' 'restrict_history_exam_id_fkey' "$(< "$M1")"
sql -c 'drop table public.restrict_history'

schema_dump "$WORK/schema.before"
checksums > "$WORK/data.before"
math_checksums > "$WORK/math.before"
MATH_BEFORE=$(sql -Atc "select count(*) from public.exams where upper(btrim(subject_code))='TOAN'")
QUESTIONS_BEFORE=$(sql -Atc "select count(*) from public.questions q join public.exams e using(exam_id) where upper(btrim(e.subject_code))='TOAN'")
apply "$PRE"
apply "$M1"
math_checksums > "$WORK/math.after"
diff -u "$WORK/math.before" "$WORK/math.after"
echo 'PASS: original TOAN exams/sections/questions/options/assets unchanged byte-for-byte'
assert_sql 'math exam count preserved and normalized' "select count(*)=$MATH_BEFORE and bool_and(subject_code='TOAN') from public.exams"
assert_sql 'math question count preserved' "select count(*)=$QUESTIONS_BEFORE from public.questions"
assert_sql 'LY/HOA subjects and their topics deactivated, not deleted' "select (select count(*)=3 from public.subjects) and (select bool_and(not is_active) from public.subjects where subject_code in ('LY','HOA')) and (select bool_and(not t.is_active) from public.topics t join public.subjects s using(subject_id) where s.subject_code in ('LY','HOA'))"
assert_sql 'legacy FK rows preserved' 'select (select count(*)=3 from public.legacy_exams) and (select count(*)=5 from public.legacy_questions)'
assert_sql 'non-math history and transitive rows gone' "select (select count(*)=1 from public.student_attempts) and (select count(*)=1 from public.student_answers) and (select count(*)=1 from public.student_ai_messages) and (select count(*)=1 from public.unknown_answer_children)"
assert_sql 'SET NULL rows survive with cleared composite and question FKs' "select count(*)=2 from public.unknown_set_null where a is null and b is null and question_id is null"
assert_sql 'Storage objects not deleted' "select count(*)=3 from storage.objects"
reject 'math-only constraint rejects VAT_LY' 'exams_subject_code_math_only_ck' "insert into public.exams(exam_id,title,school_name,city,subject_code,subject_name,year,pdf_url) values ('bad','Bad','School','City','VAT_LY','Physics',2026,'');"
assert_sql 'TOAN and Toán học defaults' "select (select pg_get_expr(adbin,adrelid) from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where adrelid='public.exams'::regclass and attname='subject_code')='''TOAN''::text' and (select pg_get_expr(adbin,adrelid) from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where adrelid='public.exams'::regclass and attname='subject_name')='''Toán học''::text'"

apply "$M2"
math_checksums > "$WORK/math.review"
diff -u "$WORK/math.before" "$WORK/math.review"
echo 'PASS: review backfill preserves every original TOAN field and timestamp'
assert_sql 'review backfill handles reviewed, missing, pending, draft, rejected and unknown metadata' "select bool_and(review_status=case when question_number in (1,5,9,10) then 'approved' else 'pending_review' end) from public.questions where exam_id='fixture- toan '"
assert_sql 'solution copied from explanation' 'select bool_and(solution is not distinct from explanation) from public.questions'
reject 'approved with null difficulty rejected' 'questions_difficulty_required_when_approved_ck' "update public.questions set review_status='approved',difficulty_level=null where question_id='fixture- toan -q2';"
reject 'invalid review status rejected' 'questions_review_status_ck' "update public.questions set review_status='other' where question_id='fixture- toan -q1';"
reject 'existing difficulty 1-4 check retained' 'difficulty_level_check' "update public.questions set difficulty_level=5 where question_id='fixture- toan -q1';"
apply "$M3"
assert_sql 'Vietnamese slugification includes đ and accented vowels' "select public.math_slugify('Đường TÍCH phân, Ứng dụng!')='duong-tich-phan-ung-dung'"
assert_sql 'slugify supports decomposed Vietnamese and null input' "select public.math_slugify(normalize('Đường tích phân',NFD))='duong-tich-phan' and public.math_slugify(null) is null"
assert_sql 'three existing math slugs backfilled' "select count(*)=3 and bool_and(topic_slug is not null) from public.topics where topic_name in ('Tich phan','Logarit','Khao sat ham so')"
assert_sql 'admin-import topics and distinct question topics seeded once' "select (select count(*)=1 from public.topics where topic_slug='duong-tich-phan') and (select count(*)=6 from public.topics where topic_slug in ('hinh-hoc-khong-gian-va-oxyz','nguyen-ham-va-tich-phan','khao-sat-ham-so-cuc-tri-va-gtln-gtnn','mu-va-logarit','xac-suat-to-hop-va-thong-ke','quan-he-vuong-goc-va-khoi-da-dien'))"
assert_sql 'question topic_id backfilled by slug' "select bool_and(t.topic_slug='duong-tich-phan') and count(*)=10 from public.questions q join public.topics t using(topic_id) where q.exam_id='fixture- toan '"
assert_sql 'seeded topic_order follows existing max' "select min(topic_order)>3 from public.topics where topic_id in (select ids.id::uuid from math_only_backup.migration_state s cross join lateral jsonb_array_elements_text(s.value->'seeded_ids') ids(id) where s.key='003')"
assert_sql 'topics RLS enabled with public read' "begin; set role anon; select count(*)>5 from public.topics; rollback;"
apply "$M4"
sql <<'SQL'
insert into public.question_bank(question_id,question_type,question_text,review_status,difficulty_level,content_hash)
values ('bank-approved','multiple_choice','Approved','approved',2,'hash-approved'),('bank-pending','short_answer','Pending','pending_review',null,null);
insert into public.question_bank_options(option_id,question_id,option_label,option_text)
values ('bank-a','bank-approved','A','A'),('bank-p','bank-pending','A','A');
insert into public.question_bank_assets(asset_id,question_id,asset_type,asset_path)
values ('bank-a','bank-approved','figure','a.png'),('bank-p','bank-pending','figure','p.png');
SQL
assert_sql 'anon sees only approved bank questions/options/assets' "begin; set role anon; select (select count(*)=1 from public.question_bank) and (select count(*)=1 from public.question_bank_options) and (select count(*)=1 from public.question_bank_assets); rollback;"
assert_sql 'authenticated student cannot see pending bank questions' "begin; set role authenticated; set test.auth_uid='00000000-0000-0000-0000-000000000001'; select count(*)=1 from public.question_bank; rollback;"
assert_sql 'admin sees every bank row' "begin; set role authenticated; set test.auth_uid='00000000-0000-0000-0000-000000000002'; select count(*)=2 from public.question_bank; rollback;"
reject 'student cannot insert bank questions' 'row-level security' "set role authenticated; set test.auth_uid='00000000-0000-0000-0000-000000000001'; insert into public.question_bank(question_id,question_type,question_text) values ('forbidden','short_answer','No');"
reject 'bank approved requires difficulty' 'question_bank_difficulty_required_when_approved_ck' "insert into public.question_bank(question_id,question_type,question_text,review_status) values ('bad-bank','short_answer','No','approved');"
reject 'bank content hash must be unique' 'question_bank_content_hash_uq' "insert into public.question_bank(question_id,question_type,question_text,content_hash) values ('bad-hash','short_answer','No','hash-approved');"
reject 'bank rejects non-math subject' 'question_bank_math_only_ck' "insert into public.question_bank(question_id,subject_code,question_type,question_text) values ('bad-subject','LY','short_answer','No');"
assert_sql 'bank updated_at trigger runs on update' "begin; update public.question_bank set updated_at='2000-01-01' where question_id='bank-approved'; select updated_at>'2000-01-01' from public.question_bank where question_id='bank-approved'; rollback;"
assert_sql 'bank parent deletion cascades to options and assets' "begin; delete from public.question_bank where question_id='bank-approved'; select not exists(select 1 from public.question_bank_options where question_id='bank-approved') and not exists(select 1 from public.question_bank_assets where question_id='bank-approved'); rollback;"
sql <<'SQL'
begin;
set role authenticated;
set test.auth_uid='00000000-0000-0000-0000-000000000002';
insert into public.question_bank(question_id,question_type,question_text) values ('admin-temp','short_answer','Admin');
update public.question_bank set question_text='Edited' where question_id='admin-temp';
delete from public.question_bank where question_id='admin-temp';
rollback;
SQL
echo 'PASS: admin can insert/update/delete bank questions'
checksums > "$WORK/idempotent.before"
apply "$M1"
apply "$M2"
apply "$M3"
apply "$M4"
checksums > "$WORK/idempotent.after"
diff -u "$WORK/idempotent.before" "$WORK/idempotent.after"
echo 'PASS: rerunning 001/002/003/004 changes no data'

sql -c "begin; alter table public.questions disable trigger user; update public.questions set solution='New detailed solution' where question_id='fixture- toan -q1'; alter table public.questions enable trigger user; commit;"
reject '002 rollback refuses custom solution data loss' 'Refusing to drop' "$(< "$R2")"
sql -c "begin; alter table public.questions disable trigger user; update public.questions set solution=explanation where question_id='fixture- toan -q1'; alter table public.questions enable trigger user; commit;"
reject '004 rollback refuses nonempty bank without force setting' 'question_bank is not empty' "$(< "$R4")"
sql <<< "set math_only.force_drop_question_bank='on'; $(< "$R4")"
assert_sql 'forced bank rollback preserves all rows in backup' 'select count(*)=6 from math_only_backup.question_bank_rows'
apply "$R3"
apply "$R2"
apply "$R1"
schema_dump "$WORK/schema.after"
checksums > "$WORK/data.after"
diff -u "$WORK/schema.before" "$WORK/schema.after"
echo 'PASS: public schema dump identical after reverse rollback'
diff -u "$WORK/data.before" "$WORK/data.after"
echo 'PASS: every public/auth/storage table count/checksum identical after reverse rollback'
apply "$R4"
apply "$R3"
apply "$R2"
apply "$R1"
echo 'PASS: rollback reruns are no-ops'

# Empty database and missing optional Storage schema are separate scenarios.
sql -c 'create database empty_case'
sql -d empty_case < "$ROOT/school_exams_schema.sql" > "$WORK/empty.log" 2>&1
sql -d empty_case < "$ROOT/school_exam_questions_schema.sql" >> "$WORK/empty.log" 2>&1
sql -d empty_case <<'SQL'
alter table public.school_exams rename to exams;
alter table public.school_exam_sections rename to exam_sections;
alter table public.school_exam_questions rename to questions;
alter table public.school_exam_question_options rename to question_options;
alter table public.school_exam_question_assets rename to question_assets;
create table public.subjects(subject_id uuid primary key default gen_random_uuid(),subject_code text,subject_name text,is_active boolean default true);
insert into public.subjects(subject_code,subject_name) values ('TOAN','Toán học');
SQL
for file in "$PRE" "$M1" "$M2" "$M3"; do
  sql -d empty_case < "$file" >> "$WORK/empty.log" 2>&1 || { cat "$WORK/empty.log"; exit 1; }
done
[[ $(sql -d empty_case -Atc "select relrowsecurity and has_table_privilege('anon',oid,'SELECT') and has_table_privilege('authenticated',oid,'SELECT') and not has_table_privilege('authenticated',oid,'INSERT,UPDATE,DELETE') and not has_table_privilege('anon',oid,'INSERT,UPDATE,DELETE') from pg_class where oid='public.topics'::regclass") == t ]]
for role in anon authenticated; do
  sql -d empty_case -c "set role $role; select * from public.topics" > /dev/null
  if sql -d empty_case -c "set role $role; insert into public.topics(subject_id,topic_name) select subject_id,'Forbidden' from public.topics limit 1" > "$WORK/rejected.log" 2>&1; then
    echo "FAIL: $role can write topics without admin helper"; exit 1
  fi
done
echo 'PASS: created topics without admin helper has RLS, public reads and no student writes'
for file in "$R3" "$R2" "$R1"; do
  sql -d empty_case < "$file" >> "$WORK/empty.log" 2>&1 || { cat "$WORK/empty.log"; exit 1; }
done
echo 'PASS: empty database, missing topics creation/rollback, absent admin helper and Storage schema'
echo 'PASS: all math-only migration assertions'
