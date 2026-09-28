-- Run once in the SQL Editor for the same Supabase project as checkins.
-- This follows the existing app's shared personal dataset model: all devices
-- using the app's public key can read and update the same gym planner.
-- No service-role key belongs in the HTML.
begin;
create table if not exists public.gym_state (
  id text primary key check (id = 'personal'),
  payload jsonb not null default '{"program":[],"days":[]}'::jsonb,
  revision integer not null default 0 check (revision >= 0),
  constraint gym_payload_shape check (
    jsonb_typeof(payload->'program') = 'array'
    and jsonb_typeof(payload->'days') = 'array'
    and payload ? 'program' and payload ? 'days'
  )
);
insert into public.gym_state (id) values ('personal') on conflict (id) do nothing;
alter table public.gym_state enable row level security;
grant select, update on public.gym_state to anon, authenticated;
drop policy if exists gym_read on public.gym_state;
create policy gym_read on public.gym_state for select to anon, authenticated using (id = 'personal');
drop policy if exists gym_update on public.gym_state;
create policy gym_update on public.gym_state for update to anon, authenticated
  using (id = 'personal') with check (id = 'personal');
commit;
