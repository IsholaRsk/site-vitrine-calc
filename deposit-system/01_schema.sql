-- ============================================
-- 1. SCHEMA - Système dépôt/crédit sécurisé
-- À exécuter dans Supabase SQL Editor
-- ============================================

-- Extension pour gen_random_uuid
create extension if not exists "pgcrypto";

-- TABLE: profiles (si pas déjà existante, on la crée / alter)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  username text,
  role text not null default 'user' check (role in ('user','admin')),
  balance numeric not null default 0 check (balance >= 0),
  total_credited numeric not null default 0 check (total_credited >= 0),
  total_spent numeric not null default 0 check (total_spent >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ajoute colonnes si table existait déjà
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists balance numeric default 0;
alter table public.profiles add column if not exists total_credited numeric default 0;
alter table public.profiles add column if not exists total_spent numeric default 0;
alter table public.profiles add column if not exists created_at timestamptz default now();
alter table public.profiles add column if not exists updated_at timestamptz default now();

-- TABLE: deposit_requests
create table if not exists public.deposit_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric not null check (amount > 0 and amount <= 100000),
  payment_method text not null check (char_length(payment_method) >= 2),
  transaction_reference text not null check (char_length(transaction_reference) >= 3),
  proof_url text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  rejection_reason text,
  admin_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint unique_reference_per_user unique (user_id, transaction_reference)
);

-- TABLE: transactions (historique financier)
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('deposit','withdraw','purchase','refund','recharge')) default 'deposit',
  amount numeric not null check (amount > 0),
  reference text,
  deposit_request_id uuid references public.deposit_requests(id) on delete set null,
  created_at timestamptz not null default now()
);

-- TABLE: admin_logs (journalisation)
create table if not exists public.admin_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  target_table text not null,
  target_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

-- INDEXES
create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists profiles_balance_idx on public.profiles(balance);
create index if not exists deposit_requests_user_id_idx on public.deposit_requests(user_id);
create index if not exists deposit_requests_status_idx on public.deposit_requests(status);
create index if not exists deposit_requests_created_at_idx on public.deposit_requests(created_at desc);
create index if not exists deposit_requests_admin_id_idx on public.deposit_requests(admin_id);
create index if not exists transactions_user_id_idx on public.transactions(user_id);
create index if not exists transactions_deposit_request_id_idx on public.transactions(deposit_request_id);
create index if not exists transactions_created_at_idx on public.transactions(created_at desc);
create index if not exists admin_logs_admin_id_idx on public.admin_logs(admin_id);

-- Trigger updated_at pour profiles
create or replace function update_updated_at_column()
returns trigger as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists update_profiles_updated_at on public.profiles;
create trigger update_profiles_updated_at
  before update on public.profiles
  for each row execute function update_updated_at_column();

-- Trigger création profil à l'inscription
create or replace function handle_new_user_profile()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, username, role, balance)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name',''),
    coalesce(new.raw_user_meta_data->>'username','user_'||substring(new.id::text,1,6)),
    'user',
    0
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function handle_new_user_profile();
