# Math-only: live Supabase schema

Manual migrations for **exams, exam_sections, questions, question_options,
question_assets, student_attempts, student_answers, student_ai_messages**.
The repository's older SQL and application code still use `school_exams` /
`school_exam_*` names; those are **not** the live names. This change does not
retarget application code. No remote database is touched by the test harness.

## Apply

Use the database owner in a maintenance window; stop application writes.
First take a full backup:

```sh
pg_dump "$SUPABASE_DB_URL" -Fc -f mathdigi-before-math-only.dump
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f web-app/supabase/migrations/20261122000_math_only_precheck.sql
```

**Before 003/004:** apply `../security_hardening_phase0.sql` first. 003 and 004 reuse
`current_user_is_school_exam_admin()`; without Phase 0 that helper is the old one from
`setup_school_exam_admin_policies.sql`, which also grants admin by profile email and to
anyone signed in as `admin@local.test`. Then apply **006** after both Phase 0 and
`../migrate_phase4_exam_import.sql`: it makes the exam-import admin check accept only
status `active`, and re-creates the phase4 visibility policies (unpublished imports
hidden from students) if Phase 0 dropped them.

Review raw exam subject counts, FK-dependent counts, subjects/topics/legacy counts,
Storage prefixes and table columns. Apply complete files **000 → 001 → 002 → 003
→ 004**, with the same psql command (change filename), or execute each entire file
in SQL Editor. Every file is one transaction.

- **001:** normalize case/whitespace TOAN codes; abort unknown codes; back up and
  purge only VAT_LY/HOA_HOC exams and affected FK rows. Deactivate LY/HOA/VAT_LY/
  HOA_HOC subjects and their topics without deleting legacy FK targets.
- **002:** add question review_status/solution/source. Null metadata review status
  plus non-null difficulty becomes approved; approved always requires difficulty.
  Existing explanation and difficulty checks stay. Backfills preserve timestamps.
- **003:** backfill TOAN topic slugs, seed the six admin-import topics plus distinct
  math question topics, and link questions.topic_id by slug. Requires exactly one
  TOAN subject. Duplicate existing slugs abort for human cleanup. Existing topics
  RLS/ACLs are preserved; if RLS was off and the admin helper exists, add public-read/
  admin-write policies. Missing helper skips those RLS changes with NOTICE. A newly
  created topics table gets application role grants.
- **004:** create the reviewed question bank, options/assets, indexes, trigger and
  RLS. Anonymous/authenticated students see approved rows only; authenticated
  admins can manage all rows. The existing admin helper is required.
- **005:** allow null `student_attempts.exam_id` and require it for rows marked
  `metadata.attempt_kind = practice`; add a partial practice-history index.
  This migration can run independently against the existing live attempts table;
  it does not require the question-bank migrations. It records the original
  nullability, rejects inconsistent existing practice rows, and does not change
  RLS or existing data. Application saves remain best-effort until it is applied.

## Rollback

If 005 was applied, roll it back first using its matching rollback file. It
restores the original nullability and refuses to restore NOT NULL while null-exam
attempts exist; back up and reconcile those rows manually rather than deleting
learning history automatically.

Stop writes; apply matching files in `../rollback/` in reverse: **004 → 003 → 002
→ 001**. Rollback 004 refuses a nonempty bank. To explicitly back up its rows to
`math_only_backup.question_bank_rows` and drop it, set this in the **same session**
(not a psql variable):

```sh
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
  -c "SET math_only.force_drop_question_bank = 'on'" \
  -f web-app/supabase/rollback/20261122004_question_bank_rollback.sql
```

003 removes its seeded topics, added slugs/column/index/function, and only RLS
policies it added; previously null slugs and their timestamps are restored.
002 refuses if a non-null solution differs from explanation: export/reconcile
custom solutions first. Source/review values are dropped, so export those if needed.
001 inserts deleted rows parent-before-child (FK retry, ON CONFLICT DO NOTHING),
restores surviving SET NULL/SET DEFAULT rows, original normalized exam values,
subject/topic activation and timestamps, and removes the math constraint/defaults.

Backups/state in `math_only_backup` are deliberately private and retained; they
contain student data. Archive securely. Applied migrations/rollbacks are safe to
rerun. After rollback, archive/drop `math_only_backup.purge_rows` before a new 001
cycle. Do not remove active state. Restore requires unchanged table layouts,
stable primary keys and no conflicting replacement rows. Missing PKs, unknown
subjects, math-deleting cross-subject cascades and RESTRICT blockers abort safely.
Immediate FK cycles can block restore. Non-FK references, external files and
arbitrary delete-trigger side effects require the full pg_dump backup. Defaults
are dropped on 001 rollback, matching the checked-in original schema.

## Storage cleanup (separate, optional operation)

Node 18+, no dependencies. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
securely; neither is printed. Bucket: `school-exams`; only VAT_LY/ and HOA_HOC/
are traversed. Stop Storage writes while listing/backing up/deleting/restoring.

```sh
node web-app/supabase/scripts/cleanup-non-math-storage.mjs # dry run: counts, bytes, paths
node web-app/supabase/scripts/cleanup-non-math-storage.mjs --backup-dir ./storage-backup
node web-app/supabase/scripts/cleanup-non-math-storage.mjs --backup-dir ./fresh-backup --execute
node web-app/supabase/scripts/cleanup-non-math-storage.mjs --restore ./fresh-backup
```

Use a fresh backup directory. All downloads and SHA-256/size checks must succeed
before deletion starts; a manifest preserves paths and MIME types. Restore checks
all files before uploading with upsert. Keep backups until verified. If a delete
batch fails, some files may already be deleted: restore from the complete backup.
Restore does not restore object IDs, timestamps, ownership or custom metadata.

## Local tests

```sh
bash web-app/supabase/tests/test_math_only_migrations.sh
node web-app/supabase/tests/test_cleanup_non_math_storage.mjs
```

Docker postgres:15 loads repository SQL, renames tables/policies to live names,
adds live-shaped subjects/topics plus legacy FK fixtures, tests RLS/reruns/errors,
and compares public schema plus every public/auth/storage table checksum after
full reverse rollback. Container/port are random and cleaned on exit. Storage
tests use only a local HTTP mock.

Roll back **006** (`../rollback/20261122006_phase4_import_admin_active_status_rollback.sql`)
before any other file: it restores the NULL-status-as-active import check and drops only
the phase4 visibility policies 006 re-created.
