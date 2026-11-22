begin;
create table public.student_tutor_chat_messages (
  message_id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 8000),
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index student_tutor_chat_messages_user_created_idx
  on public.student_tutor_chat_messages (user_id, created_at desc);
alter table public.student_tutor_chat_messages enable row level security;
create policy tutor_chat_select on public.student_tutor_chat_messages
  for select to authenticated using (user_id = auth.uid());
create policy tutor_chat_insert on public.student_tutor_chat_messages
  for insert to authenticated with check (user_id = auth.uid());
create policy tutor_chat_delete on public.student_tutor_chat_messages
  for delete to authenticated using (user_id = auth.uid());
grant select, insert, delete on public.student_tutor_chat_messages to authenticated;
commit;
