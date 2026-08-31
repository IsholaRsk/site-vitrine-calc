"use strict";
require("dotenv").config();
try { 
  if (typeof global.WebSocket === 'undefined') {
    global.WebSocket = require("ws"); 
  }
} catch {}
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 3000;
const STATIC_DIR = __dirname;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("❌ Erreur : SUPABASE_URL et SUPABASE_SECRET_KEY manquants");
}

let supabaseAdmin = null;
try {
  if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }
} catch (e) {
  console.error("❌ Erreur création Supabase client:", e.message);
}

const app = express();

app.use(cors({ origin: (origin, cb) => cb(null, origin || true), credentials: true }));
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, _, next) => {
  if (req.path.startsWith("/api/")) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

async function requireUser(req, res) {
  if (!supabaseAdmin) {
    res.status(500).json({ error: "Supabase non configuré" });
    return null;
  }
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentification requise." });
    return null;
  }
  const token = auth.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: "Token manquant." });
    return null;
  }
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    res.status(401).json({ error: "Session invalide." });
    return null;
  }
  return data.user;
}
async function requireAdmin(req, res) {
  const user = await requireUser(req, res);
  if (!user) return null;
  const { data: profile, error } = await supabaseAdmin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (error || !profile || profile.role !== "admin") {
    res.status(403).json({ error: "Accès administrateur requis." });
    return null;
  }
  return user;
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString(), supabaseConfigured: !!supabaseAdmin });
});

app.use("/api", (req, res, next) => {
  if (req.path === "/health") return next();
  if (!supabaseAdmin) {
    return res.status(500).json({ error: "Supabase non configuré" });
  }
  next();
});

// --- PRODUCTS ---
app.get("/api/products", async (req, res) => {
  const { data, error } = await supabaseAdmin.from("products").select("*").order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ products: data || [] });
});
app.post("/api/products", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const body = req.body;
  const payload = {
    ...(body.id ? { id: body.id } : {}),
    nom: String(body.nom || "").trim(),
    age: Number(body.age),
    lieu: String(body.lieu || "").trim(),
    prix: Number(body.prix),
    image: String(body.image || "").trim(),
    updated_at: new Date().toISOString()
  };
  if (!payload.nom || !Number.isFinite(payload.age) || payload.age < 18 || !payload.lieu || !Number.isFinite(payload.prix) || payload.prix <= 0 || !payload.image) {
    return res.status(400).json({ error: "Données produit invalides." });
  }
  if (!payload.id) delete payload.id;
  const { data, error } = await supabaseAdmin.from("products").upsert(payload).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ product: data });
});
app.delete("/api/products/:id", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { error } = await supabaseAdmin.from("products").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "Produit supprimé." });
});

// --- PAYMENTS ---
app.post("/api/payments", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const body = req.body;
  const amount = Number(body.amount);
  const method = String(body.method || "transcash").trim();
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Montant invalide." });
  if (!["card","transcash","balance","direct"].includes(method)) return res.status(400).json({ error: "Méthode invalide." });
  const proofUrl = String(body.proofUrl || "").trim();
  if (method !== "balance" && method !== "direct" && !proofUrl) return res.status(400).json({ error: "Photo Transcash requise." });
  const payload = {
    user_id: user.id,
    product_id: body.productId || null,
    ad_id: body.adId || null,
    target: String(body.target || "product"),
    amount,
    method,
    status: method === "balance" || method === "direct" ? "accepted" : "pending",
    validation: method === "balance" || method === "direct" ? "valid" : "pending",
    proof_url: proofUrl || `method ${method}`
  };
  const { data, error } = await supabaseAdmin.from("payments").insert(payload).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ payment: data, message: "Paiement enregistré." });
});
app.get("/api/payments", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { data, error } = await supabaseAdmin.from("payments").select("*").order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ payments: data || [] });
});
app.patch("/api/payments/:id", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const body = req.body;
  const allowed = {};
  if (["pending", "accepted", "declined"].includes(body.status)) allowed.status = body.status;
  if (["pending", "valid", "invalid"].includes(body.validation)) allowed.validation = body.validation;
  allowed.updated_at = new Date().toISOString();
  const { data: payment, error } = await supabaseAdmin.from("payments").update(allowed).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (payment.status === "accepted" && payment.target === "ad" && payment.ad_id) {
    await supabaseAdmin.from("ads").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", payment.ad_id);
  }
  if (payment.status === "declined" && payment.target === "ad" && payment.ad_id) {
    await supabaseAdmin.from("ads").update({ status: "declined", updated_at: new Date().toISOString() }).eq("id", payment.ad_id);
  }
  res.json({ payment });
});
app.get("/api/payments/:id/proof", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { data: payment, error } = await supabaseAdmin.from("payments").select("proof_url").eq("id", req.params.id).single();
  if (error || !payment?.proof_url) return res.status(404).json({ error: "Preuve introuvable." });
  const rawProof = payment.proof_url.split("|")[0];
  const { data: signed, error: signedError } = await supabaseAdmin.storage.from("payment-proofs").createSignedUrl(rawProof, 300);
  if (signedError || !signed?.signedUrl) return res.status(500).json({ error: signedError?.message || "Impossible de créer le lien." });
  res.redirect(302, signed.signedUrl);
});

// ===== WALLET BACKEND - PORTEFEUILLE PERSO PAR USER =====
app.get("/api/wallet", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const { data: profile, error } = await supabaseAdmin.from("profiles").select("id,username,full_name,balance,total_credited,total_spent,role").eq("id", user.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ 
    wallet: {
      user_id: user.id,
      balance: Number(profile?.balance||0),
      total_credited: Number(profile?.total_credited||0),
      total_spent: Number(profile?.total_spent||0),
      username: profile?.username||"",
      role: profile?.role||"user"
    }
  });
});
app.get("/api/wallet/history", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const { data, error } = await supabaseAdmin.from("payments").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ payments: data||[] });
});
app.post("/api/wallet/recharge", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const amount = Number(req.body.amount);
  const proofUrl = String(req.body.proofUrl||"").trim();
  if (!Number.isFinite(amount) || amount<=0) return res.status(400).json({ error: "Montant invalide - solde Transcash requis" });
  if (!proofUrl) return res.status(400).json({ error: "Photo Transcash requise" });
  const { data, error } = await supabaseAdmin.from("payments").insert({
    user_id: user.id,
    target: "recharge",
    amount,
    method: "transcash",
    status: "pending",
    validation: "pending",
    proof_url: proofUrl
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ payment: data, message: `Recharge Transcash ${amount}$ en attente validation` });
});
app.post("/api/wallet/deduct", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const amount = Number(req.body.amount);
  const productId = req.body.productId||null;
  if (!Number.isFinite(amount) || amount<=0) return res.status(400).json({ error: "Montant invalide" });
  const { data: profile, error: profErr } = await supabaseAdmin.from("profiles").select("balance,total_spent").eq("id", user.id).maybeSingle();
  if (profErr) return res.status(500).json({ error: profErr.message });
  const currentBal = Number(profile?.balance||0);
  if (currentBal < amount) return res.status(400).json({ error: `Solde insuffisant: ${currentBal}$ < ${amount}$` });
  const newBal = currentBal - amount;
  const { error: updErr } = await supabaseAdmin.from("profiles").update({ balance: newBal, updated_at: new Date().toISOString() }).eq("id", user.id);
  if (updErr) return res.status(500).json({ error: updErr.message });
  const { data: payment } = await supabaseAdmin.from("payments").insert({
    user_id: user.id,
    product_id: productId,
    target: "product",
    amount,
    method: "balance",
    status: "accepted",
    validation: "valid",
    proof_url: `balance deduction ${amount}$ -> new ${newBal}$`
  }).select().single();
  await supabaseAdmin.from("profiles").update({ total_spent: Number(profile?.total_spent||0)+amount }).eq("id", user.id);
  res.json({ wallet: { balance: newBal }, payment, message: `Débité ${amount}$ - nouveau solde ${newBal}$` });
});
app.get("/api/wallets", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const { data, error } = await supabaseAdmin.from("wallets").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ wallets: data||[] });
});
app.post("/api/wallets", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const address = String(req.body.wallet_address||req.body.address||"").trim();
  const network = String(req.body.network||"ethereum").trim();
  if (!address || address.length<10) return res.status(400).json({ error: "Adresse wallet invalide" });
  if (!["ethereum","polygon","bsc","solana"].includes(network)) return res.status(400).json({ error: "Réseau invalide" });
  const { data, error } = await supabaseAdmin.from("wallets").insert({ user_id: user.id, wallet_address: address, network }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ wallet: data });
});
app.delete("/api/wallets/:id", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const { data, error } = await supabaseAdmin.from("wallets").delete().eq("id", req.params.id).eq("user_id", user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "Wallet supprimé", wallet: data });
});

// --- ADS ---
app.get("/api/ads", async (req, res) => {
  const { data, error } = await supabaseAdmin.from("ads").select("*").eq("status", "active").order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ads: data || [] });
});
app.post("/api/ads", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const body = req.body;
  const title = String(body.title || "").trim();
  const text = String(body.text || "").trim();
  const mediaUrl = String(body.mediaUrl || "").trim();
  if (!title || (!text && !mediaUrl)) return res.status(400).json({ error: "Titre et contenu requis." });
  const payload = { user_id: user.id, title, text, media_type: String(body.mediaType || "text"), media_url: mediaUrl, status: "pending" };
  const { data, error } = await supabaseAdmin.from("ads").insert(payload).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ ad: data });
});
app.delete("/api/ads/:id", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { error } = await supabaseAdmin.from("ads").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "Annonce supprimée." });
});

// --- SETTINGS ---
app.get("/api/settings", async (req, res) => {
  const { data, error } = await supabaseAdmin.from("settings").select("key,value");
  if (error) return res.status(500).json({ error: error.message });
  const settings = {};
  for (const item of data || []) {
    if (item.key === "payment_redirect_url") settings.paymentRedirectUrl = item.value;
  }
  res.json({ settings });
});
app.patch("/api/settings", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const url = String(req.body.paymentRedirectUrl || req.body.url || "").trim();
  if (!url) return res.status(400).json({ error: "Lien requis." });
  try { new URL(url); } catch { return res.status(400).json({ error: "URL invalide." }); }
  const { data, error } = await supabaseAdmin.from("settings").upsert({ key: "payment_redirect_url", value: url, updated_at: new Date().toISOString() }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ settings: { paymentRedirectUrl: data.value } });
});

app.use(express.static(STATIC_DIR, { extensions: ["html"], setHeaders: (res, filePath) => { if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache"); } }));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Route API introuvable." });
  const indexPath = path.join(STATIC_DIR, "index.html");
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.status(404).send("404");
});

app.use((err, req, res, next) => {
  console.error("❌ Erreur:", err);
  res.status(500).json({ error: "Erreur interne", details: err.message });
});

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ EscortHub wallet backend démarré sur http://localhost:${PORT}`);
    console.log(`✅ API wallet: /api/wallet, /api/wallet/recharge, /api/wallet/deduct, /api/wallets`);
  });
}

module.exports = app;
