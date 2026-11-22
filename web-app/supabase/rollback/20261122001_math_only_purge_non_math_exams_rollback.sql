begin;

do $$
declare
  trigger_row record;
  entry record;
  columns_sql text;
  update_sql text;
  key_sql text;
  progress bigint;
  restored bigint := 0;
  changed bigint;
begin
  if to_regclass('math_only_backup.migration_state') is null then
    raise notice '001 rollback: no migration state; before/after unchanged';
    return;
  end if;
  if not exists (select 1 from math_only_backup.migration_state where key = '001') then
    raise notice '001 rollback: already rolled back; before/after unchanged';
    return;
  end if;
  if exists (select 1 from math_only_backup.migration_state where key in ('002','003','004')) then
    raise exception 'Roll back 004, 003 and 002 before 001';
  end if;
  raise notice '001 rollback before exams=% backup rows=%', (select count(*) from public.exams),
    (select count(*) from math_only_backup.purge_rows);
  alter table public.exams drop constraint if exists exams_subject_code_math_only_ck;
  alter table public.exams alter column subject_code drop default;
  alter table public.exams alter column subject_name drop default;
  create temporary table restore_pending on commit drop as select * from math_only_backup.purge_rows;
  create temporary table restore_triggers on commit drop as
    select tgrelid, tgname, tgenabled from pg_trigger
    where not tgisinternal and tgenabled <> 'D'
      and tgrelid in (select to_regclass(table_name) from restore_pending);
  for trigger_row in select * from restore_triggers loop
    execute format('alter table %s disable trigger %I', trigger_row.tgrelid::regclass, trigger_row.tgname);
  end loop;
  loop
    progress := 0;
    for entry in select * from restore_pending loop
      select string_agg(format('%I', attname), ', ' order by attnum),
        string_agg(format('%I = restored.%I', attname, attname), ', ' order by attnum)
      into columns_sql, update_sql from pg_attribute
      where attrelid = to_regclass(entry.table_name) and attnum > 0 and not attisdropped and attgenerated = '';
      select string_agg(format('target.%I = restored.%I', a.attname, a.attname), ' and ' order by k.n)
      into key_sql from pg_constraint c
      cross join lateral unnest(c.conkey) with ordinality k(num, n)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.num
      where c.conrelid = to_regclass(entry.table_name) and c.contype = 'p';
      begin
        if entry.will_delete then
          execute format('insert into %s (%s) overriding system value select %s from jsonb_populate_record(null::%s, $1) on conflict do nothing',
            entry.table_name, columns_sql, columns_sql, entry.table_name) using entry.row_data;
        else
          execute format('update %s target set %s from jsonb_populate_record(null::%s, $1) restored where %s',
            entry.table_name, update_sql, entry.table_name, key_sql) using entry.row_data;
          get diagnostics changed = row_count;
          if changed <> 1 then
            raise exception 'Expected one surviving row in %, found %; restore from backup manually', entry.table_name, changed;
          end if;
        end if;
        delete from restore_pending where table_name = entry.table_name and row_tid = entry.row_tid;
        progress := progress + 1;
        restored := restored + 1;
      exception when foreign_key_violation then
        null;
      end;
    end loop;
    exit when not exists (select 1 from restore_pending);
    if progress = 0 then
      raise exception 'Cannot restore remaining FK dependency cycle; rollback transaction aborted, backups retained';
    end if;
  end loop;
  for trigger_row in select * from restore_triggers loop
    execute format('alter table %s enable %s trigger %I', trigger_row.tgrelid::regclass,
      case trigger_row.tgenabled when 'A' then 'always' when 'R' then 'replica' else '' end, trigger_row.tgname);
  end loop;
  delete from math_only_backup.migration_state where key = '001';
  raise notice '001 rollback after exams=% restored rows=%; backup retained', (select count(*) from public.exams), restored;
end $$;

commit;
