begin;

do $$
declare
  state jsonb;
  item record;
begin
  if to_regclass('math_only_backup.migration_state') is null then
    raise notice '003 rollback: no state; before/after unchanged'; return;
  end if;
  select value into state from math_only_backup.migration_state where key='003';
  if state is null then
    raise notice '003 rollback: already rolled back; before/after unchanged'; return;
  end if;
  if exists (select 1 from math_only_backup.migration_state where key='004') then
    raise exception 'Roll back 004 before 003';
  end if;
  lock table public.questions, public.topics in share row exclusive mode;
  raise notice '003 rollback before topics=%', (select count(*) from public.topics);
  alter table public.questions drop column topic_id;
  if (state->>'added_policies')::boolean then
    drop policy math_topics_public_select on public.topics;
    drop policy math_topics_admin_write on public.topics;
    alter table public.topics disable row level security;
  end if;
  delete from public.topics where topic_id in
    (select value::uuid from jsonb_array_elements_text(state->'seeded_ids'));
  create temporary table topic_restore_triggers on commit drop as
    select tgname,tgenabled from pg_trigger where tgrelid='public.topics'::regclass
      and not tgisinternal and tgenabled <> 'D';
  for item in select * from topic_restore_triggers loop
    execute format('alter table public.topics disable trigger %I',item.tgname);
  end loop;
  update public.topics t set topic_slug=null, updated_at=original.updated_at
    from jsonb_populate_recordset(null::public.topics,state->'old_rows') original
    where original.topic_id=t.topic_id;
  for item in select * from topic_restore_triggers loop
    execute format('alter table public.topics enable %s trigger %I',
      case item.tgenabled when 'A' then 'always' when 'R' then 'replica' else '' end,item.tgname);
  end loop;
  drop index public.topics_subject_slug_uq;
  drop function public.math_slugify(text);
  raise notice '003 rollback after topics=%', (select count(*) from public.topics);
  if (state->>'created_topics')::boolean then drop table public.topics; end if;
  delete from math_only_backup.migration_state where key='003';
end $$;

commit;
