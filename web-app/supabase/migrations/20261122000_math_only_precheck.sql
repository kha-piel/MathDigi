begin transaction read only;

select subject_code, count(*) as exam_count
from public.exams group by subject_code order by subject_code;

do $$
declare
  subject record;
  item record;
  total bigint;
begin
  raise notice 'Precheck: read-only; no rows changed';
  for subject in select distinct subject_code from public.exams
    where upper(btrim(subject_code)) <> 'TOAN' order by subject_code
  loop
    for item in
      with recursive paths(rel, predicate, visited, depth) as (
        select 'public.exams'::regclass::oid,
          format('r0.subject_code = %L', subject.subject_code) collate "C",
          array['public.exams'::regclass::oid], 0
        union all
        select fk.conrelid,
          format('exists (select 1 from %s r%s where (%s) and %s)',
            fk.confrelid::regclass, depth, paths.predicate, links.condition),
          visited || fk.conrelid, depth + 1
        from paths join pg_constraint fk on fk.confrelid = paths.rel and fk.contype = 'f'
        cross join lateral (
          select string_agg(format('r%s.%I = r%s.%I', depth + 1, ca.attname, depth, pa.attname), ' and ' order by keys.n) as condition
          from unnest(fk.conkey, fk.confkey) with ordinality keys(child, parent, n)
          join pg_attribute ca on ca.attrelid = fk.conrelid and ca.attnum = keys.child
          join pg_attribute pa on pa.attrelid = fk.confrelid and pa.attnum = keys.parent
        ) links
        where not fk.conrelid = any(visited)
      )
      select rel, string_agg('(' || replace(predicate, 'r' || depth || '.', 'r.') || ')', ' or ') as predicate
      from paths group by rel order by rel
    loop
      execute format('select count(*) from %s r where %s', item.rel::regclass, item.predicate) into total;
      raise notice 'subject=% table=% rows=%', subject.subject_code, item.rel::regclass, total;
    end loop;
  end loop;
  if to_regclass('storage.objects') is not null then
    for item in execute $q$select prefix, count(o.name) as count
      from (values ('VAT_LY'), ('HOA_HOC')) codes(prefix)
      left join storage.objects o on o.bucket_id = 'school-exams'
        and starts_with(o.name, codes.prefix || '/')
      group by prefix order by prefix$q$
    loop
      raise notice 'storage school-exams prefix=% rows=% (not deleted by migration)', item.prefix, item.count;
    end loop;
  else
    raise notice 'storage.objects missing; storage count skipped';
  end if;
  for item in select name, to_regclass('public.' || name) as rel
    from unnest(array['topics','subjects','question_bank']) name
  loop
    raise notice 'public.% exists=% columns=%', item.name, item.rel is not null,
      (select string_agg(format('%I %s%s', attname, format_type(atttypid, atttypmod),
        case when attnotnull then ' NOT NULL' else '' end), ', ' order by attnum)
       from pg_attribute where attrelid = item.rel and attnum > 0 and not attisdropped);
  end loop;
  raise notice 'Precheck complete: no rows changed';
end $$;

do $$
declare
  subject record;
  item record;
  total bigint;
begin
  if to_regclass('public.subjects') is null then
    raise notice 'subjects missing; subject/topic/legacy counts skipped';
    return;
  end if;
  for subject in select subject_id, subject_code from public.subjects order by subject_code loop
    for item in
      with recursive paths(rel, predicate, visited, depth) as (
        select 'public.subjects'::regclass::oid,
          format('r0.subject_id = %L', subject.subject_id) collate "C",
          array['public.subjects'::regclass::oid], 0
        union all
        select fk.conrelid,
          format('exists (select 1 from %s r%s where (%s) and %s)',
            fk.confrelid::regclass, depth, paths.predicate, links.condition),
          visited || fk.conrelid, depth + 1
        from paths join pg_constraint fk on fk.confrelid = paths.rel and fk.contype = 'f'
        cross join lateral (
          select string_agg(format('r%s.%I = r%s.%I', depth + 1, ca.attname, depth, pa.attname), ' and ' order by keys.n) as condition
          from unnest(fk.conkey, fk.confkey) with ordinality keys(child, parent, n)
          join pg_attribute ca on ca.attrelid = fk.conrelid and ca.attnum = keys.child
          join pg_attribute pa on pa.attrelid = fk.confrelid and pa.attnum = keys.parent
        ) links where not fk.conrelid = any(visited)
      )
      select rel, string_agg('(' || replace(predicate, 'r' || depth || '.', 'r.') || ')', ' or ') as predicate
      from paths group by rel order by rel
    loop
      execute format('select count(*) from %s r where %s', item.rel::regclass, item.predicate) into total;
      raise notice 'catalog subject=% table=% rows=%', subject.subject_code, item.rel::regclass, total;
    end loop;
  end loop;
  raise notice 'Catalog precheck complete: no rows changed';
end $$;

commit;
