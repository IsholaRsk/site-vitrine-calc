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
  console.error("❌ Erreur : SUPABASE_URL et SUPABASE_SECRET_KEY manquants - le serveur va répondre 500 sur /api mais pas crasher");
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

// ===== MIDDLEWARE =====
app.use(cors({
  origin: (origin, cb) => cb(null, origin || true),
  credentials: true
}));
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// Logging
app.use((req, _, next) => {
  if (req.path.startsWith("/api/")) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// ===== AUTH HELPERS =====
async function requireUser(req, res) {
  if (!supabaseAdmin) {
    res.status(500).json({ error: "Supabase non configuré sur Vercel - vérifie SUPABASE_URL et SUPABASE_SECRET_KEY dans Variables d'environnement puis Redeploy" });
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
    res.status(401).json({ error: "Session invalide ou expirée." });
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

// ===== ROUTES API =====

// Health - ne nécessite pas Supabase
app.get("/api/health", (req, res) => {
  res.json({ 
    ok: true, 
    message: "Backend Supabase OK", 
    timestamp: new Date().toISOString(),
    supabaseConfigured: !!supabaseAdmin,
    env: {
      hasUrl: !!SUPABASE_URL,
      hasSecret: !!SUPABASE_SECRET_KEY,
      url: SUPABASE_URL ? SUPABASE_URL.substring(0,30)+'...' : 'MISSING'
    }
  });
});

// Middleware pour vérifier Supabase sur toutes les autres routes /api
app.use("/api", (req, res, next) => {
  if (req.path === "/health") return next();
  if (!supabaseAdmin) {
    return res.status(500).json({ 
      error: "Supabase non configuré",
      details: "Vérifie sur Vercel > Settings > Environment Variables: SUPABASE_URL et SUPABASE_SECRET_KEY doivent être définis, puis fais Redeploy",
      hasUrl: !!SUPABASE_URL,
      hasSecret: !!SUPABASE_SECRET_KEY
    });
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
    return res.status(400).json({ error: "Données produit invalides. Nom, age>=18, lieu, prix>0, image requis." });
  }
  // If no id, let DB generate uuid
  if (!payload.id) delete payload.id;

  const { data, error } = await supabaseAdmin.from("products").upsert(payload).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ product: data, message: "Produit enregistré." });
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
  const method = String(body.method || "card").trim();
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Montant invalide." });
  if (!["card","transcash"].includes(method)) return res.status(400).json({ error: "Méthode non disponible. Seule carte bancaire acceptée." });
  const proofUrl = String(body.proofUrl || "").trim();
  // Pour carte, proofUrl contient meta carte ****, pas besoin fichier
  if (method === "transcash" && !proofUrl) return res.status(400).json({ error: "Preuve de paiement requise." });
  if (method === "card" && !proofUrl) {
    // Autorise sans preuve fichier, on met meta générique
  }

  const payload = {
    user_id: user.id,
    product_id: body.productId || null,
    ad_id: body.adId || null,
    target: String(body.target || "product"),
    amount,
    method,
    status: "pending",
    validation: "pending",
    proof_url: proofUrl
  };
  const { data, error } = await supabaseAdmin.from("payments").insert(payload).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ payment: data, message: "Paiement enregistré, en attente de validation." });
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

  // Side effects for ads
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

  const { data: signed, error: signedError } = await supabaseAdmin.storage.from("payment-proofs").createSignedUrl(payment.proof_url, 300);
  if (signedError || !signed?.signedUrl) return res.status(500).json({ error: signedError?.message || "Impossible de créer le lien." });

  res.redirect(302, signed.signedUrl);
});

// --- ADS ---
app.get("/api/ads", async (req, res) => {
  // public: only active
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

  const payload = {
    user_id: user.id,
    title,
    text,
    media_type: String(body.mediaType || "text"),
    media_url: mediaUrl,
    status: "pending"
  };
  const { data, error } = await supabaseAdmin.from("ads").insert(payload).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ ad: data, message: "Annonce créée, paiement requis." });
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
  if (!url) return res.status(400).json({ error: "Lien de redirection requis." });
  try { new URL(url); } catch { return res.status(400).json({ error: "URL invalide." }); }

  const { data, error } = await supabaseAdmin.from("settings").upsert({
    key: "payment_redirect_url",
    value: url,
    updated_at: new Date().toISOString()
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ settings: { paymentRedirectUrl: data.value } });
});

// ===== STATIC FILES =====
app.use(express.static(STATIC_DIR, {
  extensions: ["html"],
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache");
    }
  }
}));

// SPA fallback for non-api routes
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Route API introuvable." });
  const indexPath = path.join(STATIC_DIR, "index.html");
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.status(404).send("404 - Fichier introuvable");
});

// Error handler global - évite FUNCTION_INVOCATION_FAILED
app.use((err, req, res, next) => {
  console.error("❌ Erreur non gérée:", err);
  res.status(500).json({ error: "Erreur interne", details: err.message });
});

// ===== START =====
if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ EscortHub v2 démarré sur http://localhost:${PORT}`);
    console.log(`✅ Supabase connecté: ${SUPABASE_URL}`);
    console.log(`✅ API santé: http://localhost:${PORT}/api/health`);
  });
}

module.exports = app;
