# Math-only database migrations

These scripts are manual SQL migrations, not a configured Supabase CLI project.
Run as the database owner, during a maintenance window with application writes
stopped. Nothing here deletes Storage objects. Public exam reads remain unchanged.

1. Take a full backup **before** migrating:
   `pg_dump "$SUPABASE_DB_URL" -Fc -f mathdigi-before-math-only.dump`.
2. Run `20261122000_math_only_precheck.sql` first and review every subject/FK count.
   It is read-only, follows FK paths (without revisiting cycles), reports legacy
   table columns, and skips Storage inspection if `storage.objects` is absent.
3. Apply `20261122001_math_only_purge_non_math_exams.sql`, then
   `20261122002_school_exam_questions_review_fields.sql`.

For each file, use:

```sh
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f web-app/supabase/migrations/20261122000_math_only_precheck.sql
```

Change the filename for subsequent migrations, or execute each complete file in
Supabase SQL Editor. Each file is one transaction; any error must abort the run.
Unknown subject codes abort 001, including its normalization. Only case/whitespace
variants of TOAN are normalized; VAT_LY and HOA_HOC are the only purge codes.

## Rollback

Stop writes and apply files in `../rollback/` in reverse order: **002, then 001**,
using the same psql flags. Rollback 002 refuses if any non-null solution differs
from explanation; export/reconcile those solutions before retrying. It otherwise
drops all three new columns, including new source/review values: export those if
needed. Rollback 001 removes the math constraint/defaults, inserts deleted rows
parent-before-child (FK-retry order, ON CONFLICT DO NOTHING), restores surviving
SET NULL/SET DEFAULT rows and original normalized exam rows, including timestamps.

`math_only_backup` is deliberately retained after rollback. Keep it private and
archive it with the DB backup; it contains student data. An applied migration is a
no-op when rerun. After rollback, archive/drop `math_only_backup.purge_rows` before
starting another 001 cycle. Do not remove backup/state while a migration is active.

Dynamic purge discovery follows CASCADE, SET NULL and SET DEFAULT FKs transitively;
RESTRICT/NO ACTION blockers abort the transaction rather than being deleted.
Cross-subject cascades that would delete math exams/questions/options/assets or
sections also abort instead of deleting math data.
Affected tables must have primary keys. Restore requires unchanged table layouts,
no conflicting replacement rows, and no concurrent writes. Arbitrary delete-trigger
side effects, external files, and non-FK references are outside this backup; the
full pg_dump is required. Unresolvable immediate FK cycles abort rollback safely.
Defaults are dropped on 001 rollback, matching the checked-in original schema.
Backfills suppress user triggers temporarily to preserve existing timestamps;
FK triggers remain active. No RLS policies or existing explanation fields change.

## Local test

```sh
bash web-app/supabase/tests/test_math_only_migrations.sh
```

Requires Docker; starts disposable postgres:15 with a random host port/container
name, loads existing schemas/seeds, tests migrations and reverse rollback, compares
public schema/data snapshots, and removes the container on exit. No remote DB is used.
