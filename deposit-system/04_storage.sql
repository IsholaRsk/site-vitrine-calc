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
