# Système Dépôt / Crédit Compte - Supabase - EscortHub

Système complet sécurisé où l'utilisateur demande un crédit, admin approuve via RPC atomique côté serveur qui crédite le solde.

## 1. SQL Supabase - Installation

### Ordre d'exécution dans Supabase Dashboard > SQL Editor :

**A) Schéma (tables)**
```sql
-- Copie/colle deposit-system/01_schema.sql
```
Crée :
- `profiles` (id FK auth.users, email, balance, role, total_credited, total_spent)
- `deposit_requests` (id, user_id, amount>0, payment_method, transaction_reference unique par user, proof_url, status pending/approved/rejected, rejection_reason, admin_id, created_at, processed_at)
- `transactions` (id, user_id, type deposit, amount, reference, deposit_request_id)
- `admin_logs` (journalisation)
- Indexes + triggers updated_at + handle_new_user_profile (crée profil + wallet 0$ à l'inscription)

**B) RLS (sécurité)**
```sql
-- Copie/colle deposit-system/02_rls.sql
```
- Active RLS sur toutes les tables
- `is_admin()` helper
- Profiles : users view own, admin view all, trigger prevent_balance_tampering empêche modification solde côté client
- Deposits : users view own + insert own pending seulement, pas de update/delete direct, admin view all mais pas update direct (seulement via RPC security definer)
- Transactions : users view own, admin view all, pas d'insert direct
- Admin_logs : admin only

**C) RPC sécurisées (crédit atomique serveur)**
```sql
-- Copie/colle deposit-system/03_rpc.sql
```
- `approve_deposit(request_id uuid)` SECURITY DEFINER :
  1. Vérifie admin
  2. SELECT FOR UPDATE pour verrouiller ligne (anti double validation)
  3. Vérifie status=pending sinon exception
  4. UPDATE profiles balance += amount
  5. UPDATE deposit_requests status=approved, admin_id=auth.uid(), processed_at=now() WHERE status=pending (double sécurité)
  6. INSERT transactions
  7. INSERT admin_logs
  8. Retourne json {success, amount, new_balance}
  - Atomique : tout réussit ou rollback

- `reject_deposit(request_id uuid, reason text)` :
  - Vérifie admin + reason min 3 chars
  - SELECT FOR UPDATE
  - UPDATE status=rejected, rejection_reason, admin_id, processed_at
  - Log admin

- `get_my_balance()` et `get_my_deposits()` helpers

**D) Storage**
```sql
-- Copie/colle deposit-system/04_storage.sql
```
- Crée bucket `deposit-proofs` (10MB, images + PDF, privé)
- Policies : users upload/view/delete own folder `user_id/*`, admin view all

**E) Optionnel - Backend portefeuille déjà fait**
Si tu as déjà exécuté `supabase_all_final.sql`, il contient déjà balance + wallets. Exécute quand même `01_schema.sql` qui fait `IF NOT EXISTS` et ajoute colonnes manquantes.

### Vérification
```sql
select * from profiles limit 1;
select * from deposit_requests where status='pending';
select public.is_admin(); -- doit retourner true si tu es admin
```

Pour te mettre admin :
```sql
update profiles set role='admin' where email='ton-email@example.com';
```

## 2. HTML

**User :** `user_deposit.html`
- Header avec balance badge
- Formulaire : montant, méthode (transcash, pcs, paypal, virement, crypto, autre), référence, preuve file
- Info box : solde non crédité immédiatement
- Wallet info : solde actuel
- Historique : liste demandes avec statut couleur

**Admin :** `admin_deposits.html`
- Filtres pending/approved/rejected/all
- Liste toutes demandes avec user (username, email, solde actuel), montant, méthode, référence, preuve, date
- Boutons Approuver & Créditer / Refuser
- Modal refus avec textarea motif

Copie les 2 fichiers à la racine du projet (même niveau que index.html).

## 3. CSS

`user_deposit.css` contient tout le style (variables --accent #ff8a00, panels, info-box, balance-big, history-item avec border-left couleur selon statut, toast).

Link dans HTML :
```html
<link rel="stylesheet" href="/style.css" />
<link rel="stylesheet" href="./user_deposit.css" />
```

## 4. JavaScript utilisateur (`user_deposit.js`)

- Import supabase client depuis `../config.js` (CONFIG.SUPABASE_URL)
- `refreshAuth()` : vérifie connecté sinon redirect #/login
- `loadBalance()` : essaie RPC `get_my_balance()` puis fallback select profiles.balance
- `loadHistory()` : select deposit_requests order created_at desc, affiche statut avec couleur, bouton Voir preuve (signedUrl 300s)
- Upload preuve : FileReader preview, vérif size 10MB
- Submit : upload file vers `deposit-proofs/{user_id}/{uuid}.ext` si présent, puis insert deposit_requests status pending, NE PAS créditer solde, affiche message "Votre demande a été envoyée. Votre solde sera crédité après validation par un administrateur."

Sécurité :
- Montant >0 vérifié
- Référence unique par user (contrainte SQL)
- Pas de crédit côté client

## 5. JavaScript admin (`admin_deposits.js`)

- `checkAdmin()` : vérifie role admin sinon redirect
- `loadDeposits()` : select deposit_requests + join profiles (username, email, balance)
- Filtres
- Voir preuve : createSignedUrl
- Approuver : confirm dialog, puis `supabase.rpc("approve_deposit", {request_id: id})` → RPC atomique serveur crédite, toast avec nouveau solde, reload
- Refuser : ouvre modal, demande motif, puis `supabase.rpc("reject_deposit", {request_id, reason})`, toast, reload

Aucune redirection après approbation (comme demandé) - reste sur dashboard.

## 6. RPC / Edge Function sécurisée

**RPC `approve_deposit`** est la solution recommandée (PostgreSQL transaction atomique, SECURITY DEFINER, anti double crédit via SELECT FOR UPDATE + WHERE status=pending).

Alternative Edge Function (Deno) si tu préfères :
```ts
// supabase/functions/approve-deposit/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
// Vérifie JWT admin, puis transaction similaire
```
Mais RPC suffit et est plus simple.

## 7. Configuration RLS - Résumé

- **profiles** : users can view own OR is_admin, users can update own but trigger bloque balance tampering
- **deposit_requests** : users view own OR admin, users insert own pending only, no update/delete for users, admin view all, update seulement via RPC security definer (bypass RLS)
- **transactions** : users view own OR admin, no insert direct (seulement RPC)
- **admin_logs** : admin view/insert only
- **storage deposit-proofs** : users upload/view/delete own folder user_id/*, admin view all

Empêche :
- User voir demandes autres
- User modifier solde
- User changer statut
- Double validation (SELECT FOR UPDATE + WHERE status=pending)

## 8. Instructions précises installation

1. **Supabase SQL** : Exécute dans l'ordre 01_schema.sql → 02_rls.sql → 03_rpc.sql → 04_storage.sql dans SQL Editor. Vérifie pas d'erreur.

2. **Buckets** : Vérifie Storage > Buckets > deposit-proofs existe (privé).

3. **Admin** : Mets ton user admin :
```sql
update profiles set role='admin' where email='ton@email.com';
```

4. **Fichiers** : Copie `user_deposit.html`, `user_deposit.css`, `user_deposit.js`, `admin_deposits.html`, `admin_deposits.js` à la racine (ou dans deposit-system/ et adapte paths).

5. **Vercel config** : Ajoute dans vercel.json rewrites pour ces pages si besoin :
```json
{ "source": "/deposit", "destination": "/deposit-system/user_deposit.html" },
{ "source": "/admin/deposits", "destination": "/deposit-system/admin_deposits.html" }
```
Ou sers-les directement via static.

6. **Liens** : Dans index.html header, ajoute lien vers Créditer :
```html
<a href="/deposit-system/user_deposit.html"><i class="fa-solid fa-wallet"></i> Créditer</a>
```

7. **Test user** :
- Connecte-toi → va sur user_deposit.html → remplis montant 50, méthode transcash, référence TX123, upload photo → Envoyer → message "Votre demande a été envoyée..."
- Vérifie dans Table Editor deposit_requests status pending, proof_url présent, balance toujours 0

8. **Test admin** :
- Connecte-toi en admin → admin_deposits.html → vois demande pending avec user, montant, méthode, référence, Voir preuve → clique Approuver → RPC crédite → balance passe à 50$, transaction créée, deposit status approved, admin_logs loggué
- Essaie de ré-approuver même demande → erreur "Déjà traitée" (anti double crédit)
- Test refus : crée nouvelle demande → Refuser → entre motif → status rejected, balance reste 0, user voit motif dans historique

9. **Sécurité finale** :
- Vérifie qu'un user non admin ne peut pas appeler approve_deposit (doit throw "Accès administrateur requis")
- Vérifie qu'un user ne peut pas updater son balance via console JS (trigger bloque)
- Vérifie RLS : user A ne voit pas dépôts user B

10. **Prod** : git add, commit, push → Vercel deploy.

Tu as maintenant un système dépôt/crédit complet, sécurisé côté serveur, atomique, anti double crédit, avec historique et motif refus.
