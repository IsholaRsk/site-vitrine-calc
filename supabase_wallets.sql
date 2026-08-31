-- Table wallets pour adresses crypto utilisateur
create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_address text not null,
  network text not null default 'ethereum',
  created_at timestamptz not null default now()
);

alter table public.wallets enable row level security;

create policy "Users can view their own wallets"
on public.wallets
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can add their own wallets"
on public.wallets
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can delete their own wallets"
on public.wallets
for delete
to authenticated
using (auth.uid() = user_id);

-- Index pour performance
create index if not exists wallets_user_id_idx on public.wallets(user_id);
create index if not exists wallets_network_idx on public.wallets(network);
