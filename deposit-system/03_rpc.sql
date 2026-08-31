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
