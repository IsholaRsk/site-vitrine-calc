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
-- ============================================
-- 2. RLS - Sécurité Row Level Security
-- ============================================

-- Active RLS
alter table public.profiles enable row level security;
alter table public.deposit_requests enable row level security;
alter table public.transactions enable row level security;
alter table public.admin_logs enable row level security;

-- Fonction helper is_admin
create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable;

-- Fonction helper is_admin_by_id (pour RPC)
create or replace function public.is_admin_by_id(uid uuid)
returns boolean as $$
  select exists (
    select 1 from public.profiles where id = uid and role='admin'
  );
$$ language sql security definer stable;

-- ===== PROFILES =====
drop policy if exists "Profiles: users can view own" on public.profiles;
create policy "Profiles: users can view own"
on public.profiles for select
to authenticated
using (auth.uid() = id or public.is_admin());

drop policy if exists "Profiles: users can update own non-balance" on public.profiles;
-- Permet update de full_name/username mais PAS balance (vérifié par trigger)
create policy "Profiles: users can update own non-balance"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- Empêche user de modifier balance directement (trigger)
create or replace function prevent_balance_tampering()
returns trigger as $$
begin
  -- Si balance change et que l'utilisateur n'est pas service_role et pas admin via RPC
  if OLD.balance is distinct from NEW.balance then
    -- Autorise seulement si appel vient de fonction security definer (service_role) ou si role reste admin
    -- On vérifie que l'utilisateur courant n'est pas l'owner essayant de tricher
    if auth.uid() = OLD.id and not public.is_admin() then
      -- Vérifie si total_credited change aussi (signe d'un crédit légitime via RPC)
      -- Si seul balance change sans passer par RPC approve, on bloque
      if OLD.total_credited = NEW.total_credited and OLD.total_spent = NEW.total_spent then
        raise exception 'Modification du solde interdite côté client. Utilisez le système de dépôt.';
      end if;
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists check_balance_tampering on public.profiles;
create trigger check_balance_tampering
  before update on public.profiles
  for each row execute function prevent_balance_tampering();

-- ===== DEPOSIT_REQUESTS =====
drop policy if exists "Deposits: users view own" on public.deposit_requests;
create policy "Deposits: users view own"
on public.deposit_requests for select
to authenticated
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Deposits: users insert own pending" on public.deposit_requests;
create policy "Deposits: users insert own pending"
on public.deposit_requests for insert
to authenticated
with check (
  auth.uid() = user_id
  and amount > 0
  and status = 'pending'
  and char_length(transaction_reference) >= 3
);

-- Pas de update/delete pour users - seulement via RPC sécurisé
drop policy if exists "Deposits: no direct update for users" on public.deposit_requests;
-- On ne crée PAS de policy update pour users, donc bloqué
-- Admin ne peut pas non plus updater directement, seulement via RPC security definer
drop policy if exists "Deposits: admin can view all" on public.deposit_requests;
create policy "Deposits: admin can view all"
on public.deposit_requests for select
to authenticated
using (public.is_admin());

-- ===== TRANSACTIONS =====
drop policy if exists "Transactions: users view own" on public.transactions;
create policy "Transactions: users view own"
on public.transactions for select
to authenticated
using (auth.uid() = user_id or public.is_admin());

-- Pas d'insert/update/delete direct pour users
-- Seulement via RPC security definer

drop policy if exists "Transactions: admin view all" on public.transactions;
create policy "Transactions: admin view all"
on public.transactions for select
to authenticated
using (public.is_admin());

-- ===== ADMIN_LOGS =====
drop policy if exists "Admin logs: admin view" on public.admin_logs;
create policy "Admin logs: admin view"
on public.admin_logs for select
to authenticated
using (public.is_admin());

drop policy if exists "Admin logs: admin insert" on public.admin_logs;
create policy "Admin logs: admin insert"
on public.admin_logs for insert
to authenticated
with check (public.is_admin() and auth.uid() = admin_id);

-- Vue admin pour soldes
create or replace view public.admin_user_wallets as
select 
  p.id,
  p.username,
  p.full_name,
  p.email,
  coalesce(p.balance,0) as balance,
  coalesce(p.total_credited,0) as total_credited,
  coalesce(p.total_spent,0) as total_spent,
  (select count(*) from public.deposit_requests d where d.user_id = p.id and d.status='pending') as pending_deposits,
  p.role,
  p.created_at
from public.profiles p
order by p.balance desc;
-- ============================================
-- 3. RPC SÉCURISÉES - Approbation atomique côté serveur
-- Empêche double validation et double crédit
-- ============================================

-- Fonction APPROUVER un dépôt - ATOMIQUE
create or replace function public.approve_deposit(request_id uuid)
returns json as $$
declare
  req record;
  new_balance numeric;
  trans_id uuid;
begin
  -- Vérifie admin
  if not public.is_admin() then
    raise exception 'Accès administrateur requis';
  end if;

  -- Verrouille la ligne pour empêcher double validation (SELECT FOR UPDATE)
  select * into req from public.deposit_requests where id = request_id for update;
  
  if not found then
    raise exception 'Demande introuvable';
  end if;

  if req.status != 'pending' then
    raise exception 'Demande déjà traitée: %', req.status;
  end if;

  if req.amount <= 0 then
    raise exception 'Montant invalide: %', req.amount;
  end if;

  -- Transaction atomique: crédit solde + update demande + création transaction + log
  -- 1. Crédite solde utilisateur
  update public.profiles
  set 
    balance = balance + req.amount,
    total_credited = total_credited + req.amount,
    updated_at = now()
  where id = req.user_id
  returning balance into new_balance;

  if not found then
    raise exception 'Profil utilisateur introuvable';
  end if;

  -- 2. Update demande en approved
  update public.deposit_requests
  set 
    status = 'approved',
    admin_id = auth.uid(),
    processed_at = now()
  where id = request_id and status = 'pending' -- Double sécurité anti double crédit
  returning * into req;

  if not found then
    -- Rollback implicite si on arrive ici (status avait changé entre temps)
    raise exception 'Demande déjà traitée par un autre admin (double validation empêchée)';
  end if;

  -- 3. Crée transaction historique financier
  insert into public.transactions (user_id, type, amount, reference, deposit_request_id)
  values (req.user_id, 'deposit', req.amount, req.transaction_reference, req.id)
  returning id into trans_id;

  -- 4. Log admin
  insert into public.admin_logs (admin_id, action, target_table, target_id, details)
  values (
    auth.uid(),
    'approve_deposit',
    'deposit_requests',
    req.id,
    jsonb_build_object(
      'amount', req.amount,
      'user_id', req.user_id,
      'new_balance', new_balance,
      'transaction_id', trans_id,
      'payment_method', req.payment_method,
      'reference', req.transaction_reference
    )
  );

  return json_build_object(
    'success', true,
    'deposit_id', req.id,
    'user_id', req.user_id,
    'amount', req.amount,
    'new_balance', new_balance,
    'transaction_id', trans_id
  );
exception
  when others then
    -- Log erreur
    insert into public.admin_logs (admin_id, action, target_table, target_id, details)
    values (
      auth.uid(),
      'approve_deposit_failed',
      'deposit_requests',
      request_id,
      jsonb_build_object('error', SQLERRM)
    );
    raise;
end;
$$ language plpgsql security definer;

-- Fonction REFUSER un dépôt
create or replace function public.reject_deposit(request_id uuid, reason text)
returns json as $$
declare
  req record;
begin
  if not public.is_admin() then
    raise exception 'Accès administrateur requis';
  end if;

  if reason is null or char_length(trim(reason)) < 3 then
    raise exception 'Motif de refus requis (min 3 caractères)';
  end if;

  select * into req from public.deposit_requests where id = request_id for update;
  
  if not found then
    raise exception 'Demande introuvable';
  end if;

  if req.status != 'pending' then
    raise exception 'Demande déjà traitée: %', req.status;
  end if;

  update public.deposit_requests
  set 
    status = 'rejected',
    rejection_reason = trim(reason),
    admin_id = auth.uid(),
    processed_at = now()
  where id = request_id and status = 'pending';

  if not found then
    raise exception 'Demande déjà traitée par un autre admin';
  end if;

  insert into public.admin_logs (admin_id, action, target_table, target_id, details)
  values (
    auth.uid(),
    'reject_deposit',
    'deposit_requests',
    request_id,
    jsonb_build_object(
      'amount', req.amount,
      'user_id', req.user_id,
      'reason', trim(reason),
      'reference', req.transaction_reference
    )
  );

  return json_build_object(
    'success', true,
    'deposit_id', request_id,
    'status', 'rejected',
    'reason', trim(reason)
  );
end;
$$ language plpgsql security definer;

-- Fonction pour obtenir son propre solde (sécurisée)
create or replace function public.get_my_balance()
returns numeric as $$
  select coalesce(balance,0) from public.profiles where id = auth.uid();
$$ language sql security definer stable;

-- Fonction pour lister ses propres dépôts (optionnel, RLS fait déjà)
create or replace function public.get_my_deposits()
returns setof public.deposit_requests as $$
  select * from public.deposit_requests where user_id = auth.uid() order by created_at desc;
$$ language sql security definer stable;

-- Permissions RPC
grant execute on function public.approve_deposit(uuid) to authenticated;
grant execute on function public.reject_deposit(uuid, text) to authenticated;
grant execute on function public.get_my_balance() to authenticated;
grant execute on function public.get_my_deposits() to authenticated;
grant execute on function public.is_admin() to authenticated;
-- ============================================
-- 4. STORAGE - Bucket pour preuves de paiement
-- ============================================

-- Crée bucket deposit-proofs (si pas existant)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'deposit-proofs',
  'deposit-proofs',
  false,
  10485760, -- 10MB
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict (id) do nothing;

-- Policies storage
-- Users can upload their own proofs
create policy "Users can upload own deposit proofs"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'deposit-proofs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can view own deposit proofs"
on storage.objects for select
to authenticated
using (
  bucket_id = 'deposit-proofs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Admin can view all deposit proofs"
on storage.objects for select
to authenticated
using (
  bucket_id = 'deposit-proofs'
  and public.is_admin()
);

create policy "Users can delete own deposit proofs"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'deposit-proofs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Garde aussi l'ancien bucket payment-proofs pour compatibilité
insert into storage.buckets (id, name, public)
values ('payment-proofs','payment-proofs',false)
on conflict (id) do nothing;
