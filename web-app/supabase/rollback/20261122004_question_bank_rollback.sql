begin;

do $$
declare
  total bigint;
begin
  if to_regclass('math_only_backup.migration_state') is null then
    raise notice '004 rollback: no state; before/after unchanged'; return;
  end if;
  if not exists (select 1 from math_only_backup.migration_state where key='004') then
    raise notice '004 rollback: already rolled back; before/after unchanged'; return;
  end if;
  lock table public.question_bank,public.question_bank_options,public.question_bank_assets in access exclusive mode;
  select count(*) into total from public.question_bank;
  raise notice '004 rollback before bank questions=%',total;
  if total > 0 then
    if current_setting('math_only.force_drop_question_bank',true) is distinct from 'on' then
      raise exception 'question_bank is not empty; export first or SET math_only.force_drop_question_bank = ''on'' to back up and drop';
    end if;
    create table if not exists math_only_backup.question_bank_rows (
      backup_id bigint generated always as identity primary key,
      table_name text not null,
      row_data jsonb not null,
      backed_up_at timestamptz not null default now()
    );
    insert into math_only_backup.question_bank_rows(table_name,row_data)
      select 'public.question_bank',to_jsonb(q) from public.question_bank q
      union all select 'public.question_bank_options',to_jsonb(o) from public.question_bank_options o
      union all select 'public.question_bank_assets',to_jsonb(a) from public.question_bank_assets a;
    raise notice '004 backed up bank rows=%', (select count(*) from math_only_backup.question_bank_rows);
  end if;
  drop table public.question_bank_assets,public.question_bank_options,public.question_bank;
  drop function public.set_question_bank_updated_at();
  delete from math_only_backup.migration_state where key='004';
  raise notice '004 rollback after: question bank tables removed; forced backups retained';
end $$;

commit;
