begin;

create schema if not exists math_only_backup;
revoke all on schema math_only_backup from public;
create table if not exists math_only_backup.migration_state (
  key text primary key,
  value jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists math_only_backup.purge_rows (
  table_name text not null,
  row_tid text not null,
  row_data jsonb not null,
  will_delete boolean not null,
  primary key (table_name, row_tid)
);

do $$
declare
  item record;
  changed bigint;
  progress bigint;
  unknown_codes text;
begin
  lock table public.exams in share row exclusive mode;
  if exists (select 1 from math_only_backup.migration_state where key = '001') then
    raise notice '001 already applied; before/after exams=%', (select count(*) from public.exams);
    return;
  end if;
  if exists (select 1 from math_only_backup.purge_rows) then
    raise exception 'Retained purge backup exists; archive/drop it before a new purge cycle';
  end if;
  for item in
    with recursive tables(rel) as (
      select 'public.exams'::regclass::oid
      union
      select c.conrelid from tables t join pg_constraint c on c.confrelid = t.rel and c.contype = 'f'
    ) select rel from tables order by rel
  loop
    execute format('lock table %s in share row exclusive mode', item.rel::regclass);
  end loop;
  insert into math_only_backup.purge_rows
    select 'public.exams', tableoid::text || '/' || ctid::text, to_jsonb(e), false
    from public.exams e where upper(btrim(subject_code)) = 'TOAN' and subject_code <> 'TOAN';
  update public.exams set subject_code = 'TOAN'
    where upper(btrim(subject_code)) = 'TOAN' and subject_code <> 'TOAN';
  get diagnostics changed = row_count;
  raise notice '001 normalized exams=%', changed;
  select string_agg(quote_literal(subject_code), ', ' order by subject_code) into unknown_codes
    from (select distinct subject_code from public.exams
      where subject_code not in ('TOAN','VAT_LY','HOA_HOC')) codes;
  if unknown_codes is not null then
    raise exception 'Unknown subject_code(s): %; entire transaction aborted', unknown_codes;
  end if;
  insert into math_only_backup.purge_rows
    select 'public.exams', tableoid::text || '/' || ctid::text, to_jsonb(e), true
    from public.exams e where subject_code <> 'TOAN';
  if to_regclass('public.subjects') is not null then
    lock table public.subjects in share row exclusive mode;
    insert into math_only_backup.purge_rows
      select 'public.subjects', tableoid::text || '/' || ctid::text, to_jsonb(s), false
      from public.subjects s where subject_code in ('LY','HOA','VAT_LY','HOA_HOC') and is_active is distinct from false;
    if to_regclass('public.topics') is not null then
      lock table public.topics in share row exclusive mode;
      insert into math_only_backup.purge_rows
        select 'public.topics', t.tableoid::text || '/' || t.ctid::text, to_jsonb(t), false
        from public.topics t join public.subjects s using(subject_id)
        where s.subject_code in ('LY','HOA','VAT_LY','HOA_HOC') and t.is_active is distinct from false;
    end if;
  end if;
  loop
    progress := 0;
    for item in
      select c.*, links.condition, format('%I.%I', ns.nspname, rel.relname) as table_name
      from pg_constraint c
      join pg_class rel on rel.oid = c.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
      cross join lateral (
        select string_agg(format('child.%I = parent.%I', ca.attname, pa.attname), ' and ' order by keys.n) as condition
        from unnest(c.conkey, c.confkey) with ordinality keys(child, parent, n)
        join pg_attribute ca on ca.attrelid = c.conrelid and ca.attnum = keys.child
        join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = keys.parent
      ) links
      where c.contype = 'f' and c.confdeltype in ('c','n','d')
        and exists (select 1 from math_only_backup.purge_rows b
          where to_regclass(b.table_name) = c.confrelid and b.will_delete)
    loop
      execute format($q$
        insert into math_only_backup.purge_rows as saved
        select %L, child.tableoid::text || '/' || child.ctid::text, to_jsonb(child), %L::boolean
        from %s child where exists (
          select 1 from math_only_backup.purge_rows b
          cross join lateral jsonb_populate_record(null::%s, b.row_data) parent
          where to_regclass(b.table_name) = %s and b.will_delete and %s)
        on conflict (table_name, row_tid) do update set will_delete = true
          where not saved.will_delete and excluded.will_delete$q$,
        item.table_name, item.confdeltype = 'c', item.conrelid::regclass,
        item.confrelid::regclass, item.confrelid, item.condition);
      get diagnostics changed = row_count;
      progress := progress + changed;
    end loop;
    exit when progress = 0;
  end loop;
  if exists (
    select 1 from math_only_backup.purge_rows b
    join public.exams e on e.exam_id = b.row_data ->> 'exam_id'
    where b.will_delete and e.subject_code = 'TOAN'
      and to_regclass(b.table_name) in ('public.exams'::regclass,
        'public.exam_sections'::regclass, 'public.questions'::regclass)
  ) or exists (
    select 1 from math_only_backup.purge_rows b
    join public.questions q on q.question_id = b.row_data ->> 'question_id'
    join public.exams e on e.exam_id = q.exam_id
    where b.will_delete and e.subject_code = 'TOAN'
      and to_regclass(b.table_name) in ('public.question_options'::regclass,
        'public.question_assets'::regclass)
  ) then
    raise exception 'FK cascade would delete math exam data; inspect cross-subject references manually';
  end if;
  for item in select table_name, count(*) as count from math_only_backup.purge_rows group by table_name order by table_name loop
    raise notice '001 backed up table=% rows=%', item.table_name, item.count;
    if not exists (select 1 from pg_constraint where conrelid = to_regclass(item.table_name) and contype = 'p') then
      raise exception 'Affected table % needs a primary key for lossless rollback', item.table_name;
    end if;
  end loop;
  raise notice '001 before delete exams=% non-math=%',
    (select count(*) from public.exams), (select count(*) from public.exams where subject_code <> 'TOAN');
  delete from public.exams where subject_code <> 'TOAN';
  get diagnostics changed = row_count;
  if to_regclass('public.subjects') is not null then
    if to_regclass('public.topics') is not null then
      update public.topics t set is_active = false from public.subjects s
      where t.subject_id = s.subject_id and s.subject_code in ('LY','HOA','VAT_LY','HOA_HOC')
        and t.is_active is distinct from false;
      raise notice '001 deactivated topics=%', (select count(*) from math_only_backup.purge_rows where table_name='public.topics');
    end if;
    update public.subjects set is_active = false
      where subject_code in ('LY','HOA','VAT_LY','HOA_HOC') and is_active is distinct from false;
    raise notice '001 deactivated subjects=%', (select count(*) from math_only_backup.purge_rows where table_name='public.subjects');
  end if;
  alter table public.exams alter column subject_code set default 'TOAN';
  alter table public.exams alter column subject_name set default 'Toán học';
  alter table public.exams add constraint exams_subject_code_math_only_ck check (subject_code = 'TOAN');
  insert into math_only_backup.migration_state(key, value) values ('001', jsonb_build_object('deleted_exams', changed));
  raise notice '001 after delete exams=% deleted=%; Storage unchanged', (select count(*) from public.exams), changed;
end $$;

commit;
