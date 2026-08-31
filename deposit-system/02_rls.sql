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
