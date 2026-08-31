-- Portefeuille obligatoire après inscription - crédit avant choisir fille

-- 1. S'assure que balance existe (déjà dans supabase_balance.sql)
alter table profiles add column if not exists balance numeric default 0 not null;
alter table profiles add column if not exists total_credited numeric default 0 not null;
alter table profiles add column if not exists total_spent numeric default 0 not null;

-- 2. Trigger création profil + portefeuille à l'inscription
create or replace function handle_new_user_wallet()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, username, role, balance, total_credited, total_spent)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',''),
    coalesce(new.raw_user_meta_data->>'username','user_'||substring(new.id::text,1,6)),
    'user',
    0,
    0,
    0
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created_wallet on auth.users;
create trigger on_auth_user_created_wallet
  after insert on auth.users
  for each row execute function handle_new_user_wallet();

-- 3. Fonction déduction solde quand achat produit (si paiement via balance)
create or replace function deduct_balance_on_purchase()
returns trigger as $$
declare
  current_bal numeric;
begin
  if NEW.method = 'balance' and NEW.status = 'accepted' then
    -- Vérifie solde (déjà déduit côté app, mais on sécurise)
    select balance into current_bal from profiles where id = NEW.user_id;
    -- Si on veut déduire ici aussi (au cas où app ne l'a pas fait), on le fait
    -- Pour éviter double déduction, on ne déduit que si proof_url contient 'balance deduction' déjà fait côté app, on skip
    if NEW.proof_url not like 'balance deduction%' then
      update profiles set 
        balance = greatest(0, coalesce(balance,0) - NEW.amount),
        total_spent = coalesce(total_spent,0) + NEW.amount,
        updated_at = now()
      where id = NEW.user_id;
    else
      -- Déjà déduit côté app, on met juste à jour total_spent
      update profiles set 
        total_spent = coalesce(total_spent,0) + NEW.amount,
        updated_at = now()
      where id = NEW.user_id;
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists on_balance_purchase on payments;
create trigger on_balance_purchase
  after insert on payments
  for each row execute function deduct_balance_on_purchase();

-- 4. Vue admin soldes + wallets
create or replace view admin_user_wallets as
select 
  p.id,
  p.username,
  p.full_name,
  u.email,
  coalesce(p.balance,0) as balance,
  coalesce(p.total_credited,0) as total_credited,
  coalesce(p.total_spent,0) as total_spent,
  (select count(*) from public.wallets w where w.user_id = p.id) as wallet_count,
  (select count(*) from payments pay where pay.user_id = p.id and pay.status='pending') as pending_payments,
  p.role,
  p.created_at
from profiles p
left join auth.users u on u.id = p.id
order by p.balance desc;

-- 5. RLS pour wallets déjà fait, mais on s'assure
alter table public.wallets enable row level security;
drop policy if exists "Users can view their own wallets" on public.wallets;
create policy "Users can view their own wallets" on public.wallets for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users can add their own wallets" on public.wallets;
create policy "Users can add their own wallets" on public.wallets for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users can delete their own wallets" on public.wallets;
create policy "Users can delete their own wallets" on public.wallets for delete to authenticated using (auth.uid() = user_id);

-- 6. Test
select * from admin_user_wallets limit 5;
