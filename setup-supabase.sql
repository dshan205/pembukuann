-- Jalankan sekali di Supabase > SQL Editor
create table dshan_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table dshan_state enable row level security;
create policy "hanya pengguna login" on dshan_state
  for all to authenticated using (true) with check (true);
insert into dshan_state (id, data) values ('main', '{}'::jsonb);
-- Lalu: Authentication > Users > buat 2 akun (pemilik dan pekerja),
-- dan matikan "Allow new users to sign up" di Authentication > Providers > Email.
