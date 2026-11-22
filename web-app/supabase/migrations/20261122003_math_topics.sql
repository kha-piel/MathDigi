begin;

do $migration$
declare
  state jsonb;
  math_subject uuid;
  created_topics boolean := to_regclass('public.topics') is null;
  enabled_before boolean;
  added_policies boolean := false;
  old_rows jsonb;
  seeded_ids jsonb;
  changed bigint;
begin
  if exists (select 1 from math_only_backup.migration_state where key = '003') then
    raise notice '003 already applied; before/after topics=%', (select count(*) from public.topics);
    return;
  end if;
  if to_regclass('public.subjects') is null then
    raise exception 'subjects is required; cannot resolve TOAN subject';
  end if;
  if (select count(*) from public.subjects where subject_code = 'TOAN') <> 1 then
    raise exception 'Expected exactly one TOAN subject';
  end if;
  select subject_id into math_subject from public.subjects where subject_code = 'TOAN';
  if to_regprocedure('public.math_slugify(text)') is not null then
    raise exception 'math_slugify already exists without 003 state; inspect ownership manually';
  end if;
  if created_topics then
    create table public.topics (
      topic_id uuid primary key default gen_random_uuid(),
      subject_id uuid not null references public.subjects(subject_id),
      parent_topic_id uuid references public.topics(topic_id),
      topic_name text not null,
      topic_slug text,
      topic_order integer default 0,
      description text,
      is_active boolean default true,
      created_at timestamptz default timezone('utc', now()),
      updated_at timestamptz default timezone('utc', now())
    );
    grant select on public.topics to anon,authenticated;
    grant insert,update,delete on public.topics to authenticated;
  end if;
  lock table public.topics, public.questions in share row exclusive mode;
  select relrowsecurity into enabled_before from pg_class where oid = 'public.topics'::regclass;
  raise notice '003 before topics=% math topics=%', (select count(*) from public.topics),
    (select count(*) from public.topics where subject_id = math_subject);
  execute $fn$
    create function public.math_slugify(text) returns text
    language sql immutable strict parallel safe as $body$
      select trim(both '-' from regexp_replace(translate(normalize(lower($1), NFC),
        'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ',
        repeat('a',17) || repeat('e',11) || repeat('i',5) || repeat('o',17) || repeat('u',11) || repeat('y',5) || 'd'),
        '[^a-z0-9]+', '-', 'g'));
    $body$
  $fn$;
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into old_rows
    from public.topics t where subject_id = math_subject and topic_slug is null;
  update public.topics set topic_slug = public.math_slugify(topic_name)
    where subject_id = math_subject and topic_slug is null;
  get diagnostics changed = row_count;
  raise notice '003 backfilled slugs=%', changed;
  create unique index topics_subject_slug_uq on public.topics(subject_id, topic_slug) where topic_slug is not null;
  with names(name) as (
    values ('Hinh hoc khong gian va Oxyz'), ('Nguyen ham va tich phan'),
      ('Khao sat ham so, cuc tri va GTLN/GTNN'), ('Mu va logarit'),
      ('Xac suat, to hop va thong ke'), ('Quan he vuong goc va khoi da dien')
    union
    select distinct q.topic from public.questions q join public.exams e using(exam_id)
      where e.subject_code = 'TOAN' and q.topic is not null
  ), candidates as (
    select distinct on (public.math_slugify(name)) name, public.math_slugify(name) as slug
    from names order by public.math_slugify(name), name
  ), inserted as (
    insert into public.topics(subject_id, topic_name, topic_slug, topic_order)
    select math_subject, name, slug,
      coalesce((select max(topic_order) from public.topics where subject_id = math_subject), 0)
        + row_number() over (order by slug)::integer
    from candidates
    on conflict (subject_id, topic_slug) where topic_slug is not null do nothing
    returning topic_id
  ) select coalesce(jsonb_agg(topic_id), '[]'::jsonb) into seeded_ids from inserted;
  alter table public.questions add column topic_id uuid null
    constraint questions_topic_id_fkey references public.topics(topic_id) on delete set null;
  create temporary table topic_question_triggers on commit drop as
    select tgname, tgenabled from pg_trigger where tgrelid = 'public.questions'::regclass
      and not tgisinternal and tgenabled <> 'D';
  for state in select jsonb_build_object('name',tgname,'enabled',tgenabled) from topic_question_triggers loop
    execute format('alter table public.questions disable trigger %I', state->>'name');
  end loop;
  update public.questions q set topic_id = t.topic_id
    from public.topics t, public.exams e where e.exam_id = q.exam_id and e.subject_code = 'TOAN'
      and t.subject_id = math_subject and t.topic_slug = public.math_slugify(q.topic);
  get diagnostics changed = row_count;
  for state in select jsonb_build_object('name',tgname,'enabled',tgenabled) from topic_question_triggers loop
    execute format('alter table public.questions enable %s trigger %I',
      case state->>'enabled' when 'A' then 'always' when 'R' then 'replica' else '' end, state->>'name');
  end loop;
  if not enabled_before then
    if to_regprocedure('public.current_user_is_school_exam_admin()') is not null then
      alter table public.topics enable row level security;
      create policy math_topics_public_select on public.topics for select using (true);
      create policy math_topics_admin_write on public.topics for all to authenticated
        using (public.current_user_is_school_exam_admin()) with check (public.current_user_is_school_exam_admin());
      added_policies := true;
    else
      raise notice '003 admin helper missing; skipping topics RLS changes';
    end if;
  end if;
  insert into math_only_backup.migration_state(key,value) values ('003', jsonb_build_object(
    'created_topics',created_topics,'rls_enabled_before',enabled_before,'added_policies',added_policies,
    'old_rows',old_rows,'seeded_ids',seeded_ids));
  raise notice '003 after topics=% seeded=% linked questions=%', (select count(*) from public.topics),
    jsonb_array_length(seeded_ids), changed;
end $migration$;

commit;
