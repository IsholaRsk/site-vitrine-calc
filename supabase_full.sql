-- Migration: Ajoute solde utilisateur + crédit automatique à la validation photo carte
-- À exécuter dans Supabase Dashboard > SQL Editor

-- 1. Ajoute colonnes balance et total_credited à profiles
alter table profiles add column if not exists balance numeric default 0 not null;
alter table profiles add column if not exists total_credited numeric default 0 not null;
alter table profiles add column if not exists updated_at timestamptz default now();

-- 2. Fonction qui crédite automatiquement le solde quand un paiement passe en accepted
create or replace function credit_user_balance()
returns trigger as $$
declare
  bal numeric;
  proof_text text := NEW.proof_url;
  bal_str text;
begin
  if NEW.status = 'accepted' and OLD.status != 'accepted' then
    -- Extrait solde depuis proof_url format: path|balance:50
    if proof_text like '%|balance:%' then
      bal_str := substring(proof_text from '\|balance:([0-9]+\.?[0-9]*)');
      if bal_str is not null and bal_str <> '' then
        bal := bal_str::numeric;
      else
        bal := NEW.amount;
      end if;
    else
      bal := NEW.amount;
    end if;

    -- Si pas de montant, on ne crédite rien
    if bal is null or bal <= 0 then
      bal := NEW.amount;
    end if;

    -- Crédite le profil utilisateur
    update profiles set 
      balance = coalesce(balance,0) + coalesce(bal,0),
      total_credited = coalesce(total_credited,0) + coalesce(bal,0),
      updated_at = now()
    where id = NEW.user_id;

    -- Log pour debug
    raise log 'Credit % to user % from payment %', bal, NEW.user_id, NEW.id;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

-- 3. Trigger sur payments
drop trigger if exists on_payment_accepted_credit on payments;
create trigger on_payment_accepted_credit
  after update on payments
  for each row execute function credit_user_balance();

-- 4. Optionnel: Vue pour admin des soldes
create or replace view user_balances as
select 
  p.id,
  p.username,
  p.full_name,
  u.email,
  coalesce(p.balance,0) as balance,
  coalesce(p.total_credited,0) as total_credited,
  p.role,
  p.updated_at
from profiles p
left join auth.users u on u.id = p.id
order by p.balance desc;

-- 5. RLS: permet à l'utilisateur de lire son propre solde
-- (si RLS activé sur profiles)
do $$
begin
  if exists (select 1 from pg_tables where tablename='profiles') then
    -- Politique lecture propre solde
    drop policy if exists "Users can read own balance" on profiles;
    create policy "Users can read own balance" on profiles
      for select using (auth.uid() = id or exists (select 1 from profiles where id = auth.uid() and role='admin'));
    
    -- Politique update via trigger (service role bypass RLS, mais on autorise aussi trigger)
    drop policy if exists "Service role can update balance" on profiles;
    create policy "Service role can update balance" on profiles
      for update using (true) with check (true);
  end if;
end $$;

-- 6. Test: vérifie colonnes
select column_name, data_type, column_default from information_schema.columns where table_name='profiles' and column_name in ('balance','total_credited');

-- 7. Exemple: créditer manuellement un utilisateur (remplace user_id)
-- update profiles set balance = balance + 50 where id = 'USER_ID_HERE';
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
