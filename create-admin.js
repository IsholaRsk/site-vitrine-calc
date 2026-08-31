"use strict";
require("dotenv").config();
try { global.WebSocket = require("ws"); } catch {}
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("❌ SUPABASE_URL et SUPABASE_SECRET_KEY requis dans .env");
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function createAdmin(email, password, username) {
  console.log(`Création admin: ${email} ...`);

  // 1. Créer user via Admin API
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: username, username, role: "admin" }
  });

  if (error) {
    // Si existe déjà, essayer de le récupérer
    if (error.message.includes("already exists") || error.message.includes("already registered")) {
      console.log("Utilisateur existe déjà, recherche...");
      const { data: list } = await supabaseAdmin.auth.admin.listUsers();
      const existing = list.users.find(u => u.email === email);
      if (!existing) throw error;
      console.log(`Utilisateur trouvé: ${existing.id}`);
      // Mettre à jour le profil en admin
      const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
        id: existing.id,
        full_name: username,
        username,
        role: "admin",
        updated_at: new Date().toISOString()
      });
      if (profileError) throw profileError;
      console.log(`✅ Profil ${email} promu admin`);
      return existing;
    }
    throw error;
  }

  console.log(`Utilisateur créé: ${data.user.id}`);

  // 2. Mettre role admin dans profiles (trigger a déjà créé profil user, on l'update)
  const { error: profileError } = await supabaseAdmin.from("profiles").update({ role: "admin", full_name: username, username }).eq("id", data.user.id);
  if (profileError) {
    console.error("Erreur update profil:", profileError.message);
    // Try upsert
    await supabaseAdmin.from("profiles").upsert({ id: data.user.id, role: "admin", full_name: username, username });
  }

  console.log(`✅ Admin créé: ${email} / ${password}`);
  return data.user;
}

(async () => {
  try {
    const email = process.argv[2] || "ijlalradji3@email.com";
    const password = process.argv[3] || "Ijlal1234";
    const username = process.argv[4] || "admin";

    await createAdmin(email, password, username);
    console.log("\nTu peux te connecter sur /#/login avec ces identifiants, puis aller sur /#/admin");
    process.exit(0);
  } catch (e) {
    console.error("❌ Erreur:", e.message);
    process.exit(1);
  }
})();
