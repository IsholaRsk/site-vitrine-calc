import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "./config.js";

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);

const state = {
  products: [],
  payments: [],
  ads: [],
  wallets: [],
  settings: { paymentRedirectUrl: CONFIG.DEFAULT_REDIRECT },
  currentUser: null,
  loading: true,
  searchQuery: ""
};

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

function escapeHtml(v){ return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }
function formatPrice(v){ return `$${Number(v||0).toLocaleString("en-US")}`; }
function readFileAsDataUrl(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); }); }
function getRedirectUrl(){ try{ const raw=localStorage.getItem(CONFIG.PAYMENT_REDIRECT_KEY); if(raw?.trim()) return raw; }catch{} return state.settings.paymentRedirectUrl||CONFIG.DEFAULT_REDIRECT; }
function setRedirectUrl(url){ localStorage.setItem(CONFIG.PAYMENT_REDIRECT_KEY, url); state.settings.paymentRedirectUrl=url; }
function getCurrentUser(){ try{ return JSON.parse(localStorage.getItem("escorhub-current-user")||"null"); }catch{ return null; } }
function setCurrentUser(u){ if(u) localStorage.setItem("escorhub-current-user", JSON.stringify(u)); else localStorage.removeItem("escorhub-current-user"); state.currentUser=u; }

// ===== DYNAMIQUE : TOAST SYSTEM =====
function showToast(message, type="info", duration=4000){
  const container = $("#toast-container");
  if(!container) return;
  const icons = { success:"fa-circle-check", error:"fa-circle-xmark", info:"fa-circle-info" };
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fa-solid ${icons[type]||icons.info}"></i><span>${escapeHtml(message)}</span><button style="margin-left:auto;background:transparent;border:none;color:var(--muted);cursor:pointer" onclick="this.parentElement.remove()"><i class="fa-solid fa-xmark"></i></button>`;
  container.appendChild(toast);
  setTimeout(()=>{ toast.style.opacity="0"; toast.style.transform="translateX(20px)"; setTimeout(()=>toast.remove(),300); }, duration);
}

// ===== DYNAMIQUE : PAGE LOADER =====
function hidePageLoader(){
  const loader = $("#page-loader");
  if(loader){ loader.classList.add("hidden"); setTimeout(()=>loader.remove(),600); }
}

// ===== API - RADICAL VERCEL FIX: plus de /api, 100% Supabase direct =====
async function apiRequest(path, options={}){
  // Fallback pour compatibilité locale: si server.js tourne en local, on l'utilise
  // Sur Vercel, ce code ne sera jamais appelé car on utilise Supabase direct
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const headers = { "Content-Type":"application/json", ...(options.headers||{}) };
    if(session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    const res = await fetch(`/api${path}`, { ...options, headers, credentials:"same-origin" });
    const text = await res.text();
    let payload={};
    try { payload = text?JSON.parse(text):{}; } catch { payload={message:text}; }
    if(!res.ok) throw new Error(payload.error||payload.message||"Erreur API");
    return payload;
  } catch(e) {
    // Sur Vercel sans backend, on propage pour que les fonctions directes prennent le relais
    throw e;
  }
}

// ===== HYDRATION =====
async function refreshCurrentUser(){
  const { data: { user }, error } = await supabase.auth.getUser();
  if(error||!user){ setCurrentUser(null); return null; }
  const { data: profile } = await supabase.from("profiles").select("id,full_name,username,role,balance,total_credited").eq("id", user.id).maybeSingle();
  const current = { 
    id:user.id, 
    email:user.email||"", 
    username:profile?.username||user.user_metadata?.username||"", 
    fullName:profile?.full_name||user.user_metadata?.full_name||"", 
    role:profile?.role||"user",
    balance: Number(profile?.balance||0),
    totalCredited: Number(profile?.total_credited||0)
  };
  setCurrentUser(current);
  return current;
}
async function hydrateState(){
  state.loading=true;
  try{
    const [{ data: products, error: pe }, { data: ads, error: ae }, { data: settings, error: se }] = await Promise.all([
      supabase.from("products").select("*").order("created_at",{ascending:false}),
      supabase.from("ads").select("*").eq("status","active").order("created_at",{ascending:false}),
      supabase.from("settings").select("*")
    ]);
    if(pe) console.error("Produits:",pe);
    if(ae) console.warn("Ads:",ae);
    if(se) console.warn("Settings:",se);
    state.products=products||[];
    state.ads=ads||[];
    const redirect=(settings||[]).find(x=>x.key==="payment_redirect_url")?.value;
    if(redirect) state.settings.paymentRedirectUrl=redirect;
    const user=await refreshCurrentUser();
    if(user){
      // RADICAL FIX: 100% Supabase direct, plus de /api/payments
      // RLS: admin voit tout via is_admin(), user voit ses paiements
      const [{ data: payments, error: payErr }, { data: wallets, error: wErr }] = await Promise.all([
        supabase.from("payments").select("*").order("created_at",{ascending:false}),
        supabase.from("wallets").select("*").order("created_at",{ascending:false})
      ]);
      if(payErr) console.warn("Paiements:", payErr.message);
      if(wErr) console.warn("Wallets:", wErr.message);
      state.payments=payments||[];
      state.wallets=wallets||[];
    } else {
      state.payments=[];
      state.wallets=[];
    }
  } finally { state.loading=false; }
}

// ===== NOTICES =====
function setPaymentNotice(message, link=""){
  localStorage.setItem("escorhub-payment-notice", JSON.stringify({message, link}));
  renderNotice();
  showToast(message, "info", 6000);
}
function clearPaymentNotice(){ localStorage.removeItem("escorhub-payment-notice"); renderNotice(); }
function renderNotice(){
  const notice=$("#site-notice");
  if(!notice) return;
  try{
    const raw=localStorage.getItem("escorhub-payment-notice");
    if(!raw){ notice.classList.add("hidden"); notice.innerHTML=""; return; }
    const data=JSON.parse(raw);
    if(!data?.message){ notice.classList.add("hidden"); notice.innerHTML=""; return; }
    notice.innerHTML = `<p><i class="fa-solid fa-bell" style="margin-right:8px;color:var(--accent)"></i>${escapeHtml(data.message)} ${data.link?`<a href="${escapeHtml(data.link)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-arrow-up-right-from-square" style="margin-right:4px"></i>Poursuivre</a>`:""} <button onclick="localStorage.removeItem('escorhub-payment-notice');this.closest('#site-notice').classList.add('hidden')" style="margin-left:12px;background:transparent;border:1px solid #444;color:#aaa;padding:4px 10px;border-radius:6px;font-size:0.8rem;cursor:pointer"><i class="fa-solid fa-xmark"></i> Fermer</button></p>`;
    notice.classList.remove("hidden");
  } catch { notice.classList.add("hidden"); notice.innerHTML=""; }
}

// ===== BANNER DYNAMIQUE =====
function renderBanner(){
  const banner=$("#site-banner");
  if(!banner) return;
  const ads=(state.ads||[]).filter(a=>a.status==="active").slice(0,4);
  if(!ads.length){ banner.innerHTML=""; return; }
  banner.innerHTML = `<div class="banner-wrap">${ads.map(ad=>{
    const mediaHtml = ad.media_type==="image"||ad.mediaType==="image"
      ? `<img src="${escapeHtml(ad.media_url||ad.mediaUrl)}" alt="${escapeHtml(ad.title)}" loading="lazy" />`
      : (ad.media_type==="video"||ad.mediaType==="video")
        ? `<video controls src="${escapeHtml(ad.media_url||ad.mediaUrl)}"></video>`
        : `<div class="banner-text">${escapeHtml(ad.text||ad.title)}</div>`;
    return `<div class="banner-item" style="animation: fadeIn .5s ease"><div style="position:relative;overflow:hidden;border-radius:10px">${mediaHtml}<div style="position:absolute;top:6px;left:6px;background:var(--accent);color:#111;padding:2px 8px;border-radius:20px;font-size:0.65rem;font-weight:800;display:flex;align-items:center;gap:4px"><i class="fa-solid fa-crown"></i> SPONSOR</div></div><div class="banner-copy"><span class="banner-tag"><i class="fa-solid fa-bolt" style="margin-right:4px"></i>Annonce sponsorisée</span><h3>${escapeHtml(ad.title)}</h3><p>${escapeHtml(ad.text||"Annonce sponsorisée")}</p></div></div>`;
  }).join("")}</div>`;
}

// ===== HERO BACKGROUND ALEATOIRE - CHANGE TOUTES LES HEURES - FEMME SEXY GLAMOUR =====
let heroIntervalHour=null;
let heroIntervalZoom=null;
let heroCurrentIdx=-1;

function getRandomHeroIdx(exclude=-1){
  if(!CONFIG.HERO_IMAGES || !CONFIG.HERO_IMAGES.length) return 0;
  if(CONFIG.HERO_IMAGES.length===1) return 0;
  let idx;
  let attempts=0;
  do{
    idx=Math.floor(Math.random()*CONFIG.HERO_IMAGES.length);
    attempts++;
  }while(idx===exclude && attempts<20);
  return idx;
}

function applyHeroBg(idx, immediate=false){
  const hero=document.querySelector(".hero");
  if(!hero) return;
  const img=CONFIG.HERO_IMAGES[idx];
  if(!img) return;

  // Assure structure bg layers
  let bgActive=hero.querySelector(".hero-bg.active");
  let bgNext=hero.querySelector(".hero-bg.next");
  if(!bgActive || !bgNext){
    hero.querySelectorAll(".hero-bg").forEach(el=>el.remove());
    bgActive=document.createElement("div");
    bgActive.className="hero-bg active";
    bgNext=document.createElement("div");
    bgNext.className="hero-bg next";
    hero.prepend(bgNext);
    hero.prepend(bgActive);
  }

  if(immediate){
    bgActive.style.backgroundImage=`url("${img}")`;
    bgActive.style.opacity="1";
    bgNext.style.opacity="0";
    bgActive.style.transform="scale(1.05)";
  } else {
    // crossfade aléatoire
    bgNext.style.backgroundImage=`url("${img}")`;
    bgNext.style.opacity="0";
    bgNext.style.transform="scale(1.12)";
    // force reflow
    void bgNext.offsetWidth;
    bgNext.style.opacity="1";
    bgActive.style.opacity="0";
    bgActive.style.transform="scale(1.05)";
    setTimeout(()=>{
      bgActive.style.backgroundImage=bgNext.style.backgroundImage;
      bgActive.style.opacity="1";
      bgActive.style.transform="scale(1.05)";
      bgNext.style.opacity="0";
    },1200);
  }

  heroCurrentIdx=idx;
  try{
    localStorage.setItem("escorhub-hero-idx", String(idx));
    localStorage.setItem("escorhub-hero-ts", String(Date.now()));
  }catch{}

  // preload prochaine image aléatoire glamour
  const preloadIdx=getRandomHeroIdx(idx);
  const preloadImg=new Image();
  preloadImg.src=CONFIG.HERO_IMAGES[preloadIdx];
}

function startHeroSlideshow(){
  const hero=document.querySelector(".hero");
  if(!hero){
    if(heroIntervalHour) clearInterval(heroIntervalHour);
    if(heroIntervalZoom) clearInterval(heroIntervalZoom);
    return;
  }

  const storedIdx=parseInt(localStorage.getItem("escorhub-hero-idx")||"",10);
  const storedTs=parseInt(localStorage.getItem("escorhub-hero-ts")||"0",10);
  const oneHour=3600000;
  const now=Date.now();
  let initialIdx;

  if(!isNaN(storedIdx) && storedIdx>=0 && storedIdx<CONFIG.HERO_IMAGES.length && (now-storedTs)<oneHour){
    initialIdx=storedIdx;
  } else {
    initialIdx=getRandomHeroIdx(heroCurrentIdx);
  }

  applyHeroBg(initialIdx,true);

  if(heroIntervalHour) clearInterval(heroIntervalHour);
  if(heroIntervalZoom) clearInterval(heroIntervalZoom);

  // Changement aléatoire toutes les heures - femme sexy glamour
  heroIntervalHour=setInterval(()=>{
    const next=getRandomHeroIdx(heroCurrentIdx);
    applyHeroBg(next,false);
  }, oneHour);

  // Effet zoom subtil toutes les 8s pour dynamisme glamour
  let zoomed=false;
  heroIntervalZoom=setInterval(()=>{
    const active=document.querySelector(".hero-bg.active");
    if(active){
      active.style.transform=zoomed?"scale(1.05)":"scale(1.12)";
      zoomed=!zoomed;
    }
  },8000);
}

// ===== DYNAMIQUE : OBSERVER ANIMATION =====
function initDynamicEffects(){
  const observer = new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting){
        entry.target.style.opacity="1";
        entry.target.style.transform="translateY(0)";
      }
    });
  }, { threshold:0.1 });

  $$(".product-card").forEach((card,i)=>{
    card.style.opacity="0";
    card.style.transform="translateY(20px)";
    card.style.transition=`opacity .5s ease ${i*0.05}s, transform .5s ease ${i*0.05}s`;
    observer.observe(card);
  });
}

// ===== COMPONENTS AVEC FONT AWESOME PRO =====
function renderProductCard(p){
  const image=p.image||"";
  const isNew = p.created_at && (Date.now() - new Date(p.created_at).getTime()) < 86400000*2;
  const user=getCurrentUser();
  const balance=user?.balance||0;
  const price=Number(p.prix||p.price||0);
  const canAfford = !user ? false : balance >= price;
  const lockOverlay = !user ? `<div style="position:absolute;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(2px);display:grid;place-items:center;z-index:2;border-radius:12px 12px 0 0"><div style="background:var(--panel);border:1px solid var(--accent);padding:10px 14px;border-radius:10px;display:flex;align-items:center;gap:8px;font-weight:800;font-size:0.85rem"><i class="fa-solid fa-lock" style="color:var(--accent)"></i> Crédite portefeuille</div></div>` : (!canAfford ? `<div style="position:absolute;inset:0;background:rgba(0,0,0,0.55);display:grid;place-items:center;z-index:2;border-radius:12px 12px 0 0"><div style="background:rgba(255,138,0,0.15);border:1px solid var(--accent);padding:8px 12px;border-radius:20px;display:flex;align-items:center;gap:6px;font-weight:800;font-size:0.8rem;color:var(--accent)"><i class="fa-solid fa-wallet"></i> Solde ${balance.toFixed(0)}$ / ${price}$ requis</div></div>` : "");
  return `
  <article class="product-card">
    ${isNew?`<div style="position:absolute;top:10px;left:10px;z-index:3;background:var(--success);color:#fff;padding:4px 10px;border-radius:20px;font-size:0.7rem;font-weight:800;display:flex;align-items:center;gap:4px"><i class="fa-solid fa-sparkles"></i> NEW</div>`:""}
    <div class="product-image" style="background-image:url('${escapeHtml(image)}');position:relative">
      ${lockOverlay}
      <div style="position:absolute;bottom:10px;left:10px;z-index:3;display:flex;gap:6px">
        <span style="background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);color:#fff;padding:4px 8px;border-radius:20px;font-size:0.75rem;display:flex;align-items:center;gap:4px"><i class="fa-solid fa-eye"></i> ${Math.floor(Math.random()*500+50)}</span>
        <span style="background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);color:#fff;padding:4px 8px;border-radius:20px;font-size:0.75rem;display:flex;align-items:center;gap:4px"><i class="fa-solid fa-heart"></i> ${Math.floor(Math.random()*100+5)}</span>
      </div>
    </div>
    <div class="product-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <h3 style="display:flex;align-items:center;gap:6px"><i class="fa-solid fa-user" style="color:var(--accent);font-size:0.9em"></i>${escapeHtml(p.nom||p.title||"Profil")}</h3>
        <span style="color:var(--success);font-size:0.75rem;display:flex;align-items:center;gap:4px"><i class="fa-solid fa-circle" style="font-size:0.5em"></i> En ligne</span>
      </div>
      <p class="meta" style="display:flex;gap:12px;flex-wrap:wrap">
        <span><i class="fa-solid fa-cake-candles" style="margin-right:4px;color:var(--muted)"></i>${escapeHtml(p.age||"-")} ans</span>
        <span><i class="fa-solid fa-location-dot" style="margin-right:4px;color:var(--muted)"></i>${escapeHtml(p.lieu||"-")}</span>
      </p>
      <div class="price-row">
        <strong><i class="fa-solid fa-dollar-sign"></i> ${formatPrice(p.prix||p.price).replace('$','')}</strong>
        ${!user ? `<a href="#/signup" class="btn-primary small" style="text-decoration:none"><i class="fa-solid fa-wallet" style="margin-right:4px"></i>Créditer portefeuille</a>` : (canAfford ? `<button class="btn-primary small" data-action="buy" data-id="${escapeHtml(p.id)}"><i class="fa-solid fa-bolt" style="margin-right:4px"></i>Choisir (${price}$)</button>` : `<a href="#/wallet" class="btn-secondary small" style="text-decoration:none;background:rgba(255,138,0,0.15);border-color:var(--accent);color:var(--accent)"><i class="fa-solid fa-wallet" style="margin-right:4px"></i>Recharger</a>`)}
      </div>
    </div>
  </article>`;
}

// ===== PAGES DYNAMIQUES =====
function renderHome(){
  const products = state.searchQuery ? state.products.filter(p=> 
    `${p.nom} ${p.lieu} ${p.age} ${p.prix}`.toLowerCase().includes(state.searchQuery.toLowerCase())
  ) : state.products;

  return `
    <section class="hero">
      <div class="hero-content">
        <p class="eyebrow"><i class="fa-solid fa-fire" style="margin-right:6px"></i>EscortHub • Premium • Since 2013</p>
        <h1>Découvre des offres rapides, sécurisées et visibles.</h1>
        <p>Inscris-toi, crédite ton portefeuille par photo de carte, puis choisis une fille pour un service. Solde obligatoire avant accès. Monde entier, 195 pays.</p>
        <div class="hero-actions">
          <a href="#/products" class="btn-primary"><i class="fa-solid fa-compass" style="margin-right:8px"></i>Voir les produits</a>
          <a href="/post.html" class="btn-secondary"><i class="fa-solid fa-plus" style="margin-right:8px"></i>Poster une annonce</a>
        </div>
        <div class="stats-bar">
          <div class="stat-item"><i class="fa-solid fa-users"></i><strong>${state.products.length}</strong> Profils</div>
          <div class="stat-item"><i class="fa-solid fa-earth-americas"></i><strong>195</strong> Pays</div>
          <div class="stat-item"><i class="fa-solid fa-bolt"></i><strong>24/7</strong> Disponible</div>
          <div class="stat-item"><i class="fa-solid fa-shield-halved"></i><strong>100%</strong> Sécurisé</div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2><i class="fa-solid fa-fire" style="color:var(--accent);margin-right:8px"></i>Profils populaires</h2>
        <a href="#/products"><i class="fa-solid fa-arrow-right" style="margin-right:4px"></i>Tout afficher</a>
      </div>
      ${state.searchQuery?`<p style="color:var(--muted);margin-bottom:16px"><i class="fa-solid fa-magnifying-glass" style="margin-right:6px"></i>Résultats pour "${escapeHtml(state.searchQuery)}" : ${products.length} profils</p>`:""}
      <div class="product-grid">
        ${products.length ? products.map(renderProductCard).join("") : `<p class="empty-state"><i class="fa-solid fa-inbox" style="margin-right:8px"></i>Aucun produit disponible. L'admin doit en ajouter.</p>`}
      </div>
    </section>`;
}

function renderProductsPage(){
  const products = state.searchQuery ? state.products.filter(p=> 
    `${p.nom} ${p.lieu} ${p.age} ${p.prix}`.toLowerCase().includes(state.searchQuery.toLowerCase())
  ) : state.products;

  return `
    <section class="page-shell">
      <div class="section-head">
        <h2><i class="fa-solid fa-grid" style="color:var(--accent);margin-right:8px"></i>Catalogue complet</h2>
        <span style="color:var(--muted);display:flex;align-items:center;gap:6px"><i class="fa-solid fa-users"></i>${products.length} profils</span>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <div style="flex:1;min-width:260px;position:relative">
          <i class="fa-solid fa-magnifying-glass" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--muted)"></i>
          <input type="text" id="catalog-search" placeholder="Filtrer par nom, ville, prix..." value="${escapeHtml(state.searchQuery)}" style="width:100%;padding-left:36px" />
        </div>
        <button class="btn-secondary" id="clear-filter"><i class="fa-solid fa-xmark" style="margin-right:6px"></i>Effacer</button>
      </div>
      <div class="product-grid">
        ${products.length ? products.map(renderProductCard).join("") : `<p class="empty-state"><i class="fa-solid fa-face-frown" style="margin-right:8px"></i>Aucun produit ne correspond à votre recherche.</p>`}
      </div>
    </section>`;
}

function renderLoginPage(){
  return `
    <section class="auth-page">
      <div class="auth-card" style="animation: scaleIn .4s ease">
        <div style="text-align:center;margin-bottom:20px">
          <div style="width:60px;height:60px;background:linear-gradient(135deg, var(--accent), var(--accent-2));border-radius:16px;display:grid;place-items:center;margin:0 auto 12px"><i class="fa-solid fa-right-to-bracket" style="font-size:1.5rem;color:#111"></i></div>
          <h1>Connexion</h1><p class="subtitle">Accédez à votre espace EscortHub.</p>
        </div>
        <form id="login-form">
          <label><span><i class="fa-solid fa-envelope" style="margin-right:4px"></i>Adresse e-mail</span><input type="email" name="email" placeholder="vous@exemple.com" autocomplete="email" required /></label>
          <label><span><i class="fa-solid fa-lock" style="margin-right:4px"></i>Mot de passe</span><input type="password" name="password" placeholder="Entrez votre mot de passe" required /></label>
          <button type="submit" class="btn-primary auth-btn"><i class="fa-solid fa-arrow-right-to-bracket" style="margin-right:8px"></i>Se connecter</button>
        </form>
        <p class="auth-link">Pas de compte ? <a href="#/signup"><i class="fa-solid fa-user-plus" style="margin-right:4px"></i>Inscrivez-vous</a></p>
      </div>
    </section>`;
}

function renderSignupPage(){
  return `
    <section class="auth-page">
      <div class="auth-card" style="animation: scaleIn .4s ease">
        <div style="text-align:center;margin-bottom:20px">
          <div style="width:60px;height:60px;background:linear-gradient(135deg, var(--accent), var(--accent-2));border-radius:16px;display:grid;place-items:center;margin:0 auto 12px"><i class="fa-solid fa-user-plus" style="font-size:1.5rem;color:#111"></i></div>
          <h1>Inscription</h1><p class="subtitle">Créez votre compte + portefeuille en 30s. Crédit obligatoire avant service.</p>
        </div>
        <form id="signup-form">
          <label><span><i class="fa-solid fa-user" style="margin-right:4px"></i>Nom complet</span><input type="text" name="fullName" placeholder="Votre nom complet" required /></label>
          <label><span><i class="fa-solid fa-at" style="margin-right:4px"></i>Nom d'utilisateur</span><input type="text" name="username" placeholder="Choisissez un pseudo" required /></label>
          <label><span><i class="fa-solid fa-envelope" style="margin-right:4px"></i>Adresse e-mail</span><input type="email" name="email" placeholder="vous@exemple.com" autocomplete="email" required /></label>
          <label><span><i class="fa-solid fa-lock" style="margin-right:4px"></i>Mot de passe</span><input type="password" name="password" placeholder="Choisissez un mot de passe" required /></label>
          <button type="submit" class="btn-primary auth-btn"><i class="fa-solid fa-rocket" style="margin-right:8px"></i>S'inscrire</button>
        </form>
        <p class="auth-link">Déjà inscrit ? <a href="#/login"><i class="fa-solid fa-right-to-bracket" style="margin-right:4px"></i>Connectez-vous</a></p>
      </div>
    </section>`;
}

function renderAdminPage(){
  const user=getCurrentUser();
  if(!user||user.role!=="admin"){
    return `<section class="page-shell centered" style="text-align:center"><div style="width:80px;height:80px;background:rgba(255,90,90,0.15);border-radius:20px;display:grid;place-items:center;margin:0 auto 16px"><i class="fa-solid fa-lock" style="font-size:2rem;color:var(--danger)"></i></div><h1>Accès réservé</h1><p>Connectez-vous avec l'admin pour gérer le site.</p><a href="#/login" class="btn-primary"><i class="fa-solid fa-right-to-bracket" style="margin-right:8px"></i>Aller à la connexion</a></section>`;
  }
  const products=state.products;
  const payments=state.payments;
  const ads=state.ads;
  return `
    <section class="admin-page">
      <div class="admin-topbar">
        <div>
          <p class="eyebrow"><i class="fa-solid fa-shield-halved" style="margin-right:6px"></i>Administration • Since 2013</p>
          <h1><i class="fa-solid fa-gauge-high" style="margin-right:10px;color:var(--accent)"></i>Dashboard</h1>
          <p style="color:var(--muted);margin:6px 0 0;display:flex;gap:12px;flex-wrap:wrap"><span><i class="fa-solid fa-envelope" style="margin-right:4px"></i>${escapeHtml(user.email)}</span><span><i class="fa-solid fa-credit-card" style="margin-right:4px"></i>${payments.length} paiements</span><span><i class="fa-solid fa-box" style="margin-right:4px"></i>${products.length} produits</span></p>
        </div>
        <button class="logout-btn" id="admin-logout-btn"><i class="fa-solid fa-right-from-bracket" style="margin-right:6px"></i>Déconnexion</button>
      </div>

      <div class="admin-grid">
        <div class="admin-panel">
          <h2><i class="fa-solid fa-gear" style="margin-right:8px;color:var(--accent)"></i>Paramètres redirection</h2>
          <form id="redirect-settings-form">
            <label><span><i class="fa-brands fa-telegram" style="margin-right:4px"></i>Lien après validation</span><input type="url" id="payment-success-link" value="${escapeHtml(getRedirectUrl())}" placeholder="https://t.me/..." required /></label>
            <div class="admin-actions"><button type="submit" class="btn-primary"><i class="fa-solid fa-floppy-disk" style="margin-right:6px"></i>Enregistrer le lien</button></div>
          </form>
          <div style="margin-top:18px;padding-top:18px;border-top:1px solid var(--line)">
            <h3 style="font-size:1rem;margin:0 0 10px;display:flex;align-items:center;gap:6px"><i class="fa-solid fa-link"></i>Lien actuel</h3>
            <code style="display:block;background:var(--panel-soft);padding:10px;border-radius:8px;word-break:break-all;font-size:0.85rem">${escapeHtml(getRedirectUrl())}</code>
          </div>
        </div>

        <div class="admin-panel">
          <h2><i class="fa-solid fa-plus" style="margin-right:8px;color:var(--accent)"></i>Ajouter / modifier un produit</h2>
          <form id="admin-product-form">
            <input type="hidden" name="id" id="product-id" />
            <label><span><i class="fa-solid fa-user" style="margin-right:4px"></i>Nom *</span><input type="text" name="nom" placeholder="Nom du profil" required /></label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <label><span><i class="fa-solid fa-cake-candles" style="margin-right:4px"></i>Âge *</span><input type="number" name="age" placeholder="22" min="18" required /></label>
              <label><span><i class="fa-solid fa-dollar-sign" style="margin-right:4px"></i>Prix *</span><input type="number" name="prix" placeholder="150" min="1" required /></label>
            </div>
            <label><span><i class="fa-solid fa-location-dot" style="margin-right:4px"></i>Lieu *</span><input type="text" name="lieu" placeholder="Cotonou" required /></label>
            <label><span><i class="fa-solid fa-upload" style="margin-right:4px"></i>Image / Vidéo</span><input type="file" name="imageUpload" accept="image/*,video/*" /></label>
            <label><span><i class="fa-solid fa-link" style="margin-right:4px"></i>Ou URL</span><input type="url" name="image" placeholder="https://..." /></label>
            <div class="admin-actions">
              <button type="submit" class="btn-primary"><i class="fa-solid fa-check" style="margin-right:6px"></i>Enregistrer</button>
              <button type="button" class="btn-secondary" id="reset-product-form"><i class="fa-solid fa-rotate" style="margin-right:6px"></i>Réinitialiser</button>
            </div>
          </form>
        </div>
      </div>

      <div class="admin-panel">
        <h2><i class="fa-solid fa-box" style="margin-right:8px"></i>Produits (${products.length})</h2>
        <div class="admin-list">
          ${products.length ? products.map(p=>`
            <div class="admin-item">
              <div><strong><i class="fa-solid fa-user" style="margin-right:6px;color:var(--accent)"></i>${escapeHtml(p.nom)}</strong><p><i class="fa-solid fa-cake-candles" style="margin-right:4px"></i>${escapeHtml(p.age)} | <i class="fa-solid fa-location-dot" style="margin-right:4px"></i>${escapeHtml(p.lieu)} | ${formatPrice(p.prix)}</p></div>
              <div class="admin-item-actions">
                <button class="mini-btn" data-action="edit-product" data-id="${escapeHtml(p.id)}"><i class="fa-solid fa-pen"></i> Modifier</button>
                <button class="mini-btn danger" data-action="delete-product" data-id="${escapeHtml(p.id)}"><i class="fa-solid fa-trash"></i> Supprimer</button>
              </div>
            </div>`).join("") : `<p class="empty-state"><i class="fa-solid fa-inbox"></i> Aucun produit.</p>`}
        </div>
      </div>

      <div class="admin-section">
        <h2><i class="fa-solid fa-credit-card" style="margin-right:8px"></i>Paiements reçus (${payments.length})</h2>
        <div class="admin-list">
          ${payments.length ? payments.map(pay=>{
            const rawProof = pay.proof_url||"";
            const proofPath = rawProof.split("|")[0];
            const balanceMatch = rawProof.match(/balance:(\d+)/);
            const balance = balanceMatch ? balanceMatch[1] : null;
            return `
            <div class="payment-item ${pay.status||"pending"}" style="animation: fadeIn .3s ease">
              <div class="payment-info">
                <strong>${pay.target==="product"?`<i class="fa-solid fa-cart-shopping" style="margin-right:6px"></i>Achat produit`:`<i class="fa-solid fa-bullhorn" style="margin-right:6px"></i>Annonce`} • ${formatPrice(pay.amount)} ${balance?`• <span style="background:var(--accent);color:#111;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:800">Solde photo: ${escapeHtml(balance)}$</span>`:""}</strong>
                <p><i class="fa-solid fa-user" style="margin-right:4px"></i>${escapeHtml(pay.user_id?.slice(0,8)||"Anonyme")} | <i class="fa-solid fa-credit-card" style="margin-right:4px"></i>${escapeHtml(pay.method)} • Recharge par carte | <i class="fa-solid fa-circle-info" style="margin-right:4px"></i><b>${escapeHtml(pay.status)}</b></p>
                <p><i class="fa-regular fa-clock" style="margin-right:4px"></i>${new Date(pay.created_at).toLocaleString("fr-FR")} | ID: ${escapeHtml(pay.id.slice(0,8))} ${balance?`• À créditer: ${escapeHtml(balance)}$ sur compte`:""}</p>
                ${proofPath?`<div style="margin-top:8px"><button class="mini-btn" data-action="view-proof" data-path="${escapeHtml(proofPath)}"><i class="fa-solid fa-camera"></i> Voir photo carte</button> ${balance?`<span style="margin-left:8px;color:var(--accent);font-weight:700"><i class="fa-solid fa-dollar-sign"></i> ${escapeHtml(balance)}$ à créditer après validation</span>`:""}<div class="proof-preview" id="proof-${escapeHtml(pay.id)}" style="margin-top:8px"></div></div>`:""}
              </div>
              <div class="admin-item-actions">
                <button class="mini-btn success" data-action="accept-payment" data-id="${escapeHtml(pay.id)}" data-balance="${balance||''}"><i class="fa-solid fa-check"></i> Accepter & Créditer ${balance?balance+'$':''}</button>
                <button class="mini-btn danger" data-action="decline-payment" data-id="${escapeHtml(pay.id)}"><i class="fa-solid fa-xmark"></i> Décliner</button>
              </div>
            </div>`}).join("") : `<p class="empty-state"><i class="fa-solid fa-inbox"></i> Aucun paiement pour le moment.</p>`}
        </div>
      </div>

      <div class="admin-section">
        <h2><i class="fa-solid fa-bullhorn" style="margin-right:8px"></i>Annonces actives (${ads.length})</h2>
        <div class="admin-list">
          ${ads.length ? ads.map(ad=>`
            <div class="admin-item">
              <div><strong><i class="fa-solid fa-bullhorn" style="margin-right:6px;color:var(--accent)"></i>${escapeHtml(ad.title)}</strong><p>${escapeHtml(ad.text?.slice(0,80)||"")} • ${escapeHtml(ad.status)}</p></div>
              <div class="admin-item-actions"><button class="mini-btn danger" data-action="delete-ad" data-id="${escapeHtml(ad.id)}"><i class="fa-solid fa-trash"></i> Retirer</button></div>
            </div>`).join("") : `<p class="empty-state"><i class="fa-solid fa-inbox"></i> Aucune annonce active.</p>`}
        </div>
      </div>
    </section>`;
}

function renderWalletPage(){
  const user=getCurrentUser();
  if(!user){
    window.location.hash="#/login";
    return `<section class="page-shell centered"><p>Redirection connexion...</p></section>`;
  }
  const balance = user.balance||0;
  const totalCredited = user.totalCredited||0;
  const myPayments = (state.payments||[]).filter(p=>String(p.user_id)===String(user.id));
  const pending = myPayments.filter(p=>p.status==="pending");
  const accepted = myPayments.filter(p=>p.status==="accepted");
  return `
    <section class="page-shell">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px;margin-bottom:24px">
        <div>
          <h1 style="margin:0;display:flex;align-items:center;gap:12px"><i class="fa-solid fa-wallet" style="color:var(--accent)"></i>Mon Solde</h1>
          <p style="color:var(--muted);margin:6px 0 0">Portefeuille obligatoire - crédite par photo de carte avant de choisir une fille. Solde débité automatiquement au choix.</p>
        </div>
        <div style="background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#111;padding:16px 24px;border-radius:16px;display:flex;align-items:center;gap:12px;min-width:200px">
          <i class="fa-solid fa-coins" style="font-size:1.8rem"></i>
          <div>
            <div style="font-size:0.8rem;font-weight:700;opacity:0.7">SOLDE ACTUEL</div>
            <div style="font-size:1.8rem;font-weight:900">${balance.toFixed(2)}$</div>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:24px">
        <div style="background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px">
          <div style="color:var(--muted);font-size:0.8rem;display:flex;align-items:center;gap:6px"><i class="fa-solid fa-arrow-up"></i> Total crédité</div>
          <div style="font-size:1.4rem;font-weight:800;margin-top:4px">${totalCredited.toFixed(2)}$</div>
        </div>
        <div style="background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px">
          <div style="color:var(--muted);font-size:0.8rem;display:flex;align-items:center;gap:6px"><i class="fa-solid fa-clock"></i> En attente</div>
          <div style="font-size:1.4rem;font-weight:800;margin-top:4px">${pending.length} paiement(s)</div>
        </div>
        <div style="background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px">
          <div style="color:var(--muted);font-size:0.8rem;display:flex;align-items:center;gap:6px"><i class="fa-solid fa-check"></i> Validés</div>
          <div style="font-size:1.4rem;font-weight:800;margin-top:4px">${accepted.length}</div>
        </div>
      </div>

      <div class="admin-grid">
        <div class="admin-panel">
          <h2><i class="fa-solid fa-camera" style="margin-right:8px;color:var(--accent)"></i>Recharger mon solde - Photo carte</h2>
          <div style="background:rgba(255,138,0,0.08);border:1px solid rgba(255,138,0,0.25);border-radius:10px;padding:12px;display:flex;gap:10px;align-items:flex-start;margin-bottom:16px">
            <i class="fa-solid fa-circle-info" style="color:var(--accent);margin-top:2px"></i>
            <div style="font-size:0.85rem;line-height:1.5;color:var(--muted)">
              <strong style="color:var(--text)">Instructions :</strong><br/>
              1. Achetez une carte de recharge<br/>
              2. Photo claire code + solde<br/>
              3. Uploadez ici + indique solde<br/>
              4. Admin confirme -> solde crédité automatiquement
            </div>
          </div>
          <form id="wallet-recharge-form">
            <label><span><i class="fa-solid fa-image" style="margin-right:4px"></i>Photo de la carte achetée *</span><input type="file" id="wallet-card-proof" accept="image/*" required /></label>
            <div id="wallet-card-preview" class="image-preview hidden" style="margin:8px 0;border:1px dashed var(--line);border-radius:10px;padding:8px"></div>
            <label><span><i class="fa-solid fa-dollar-sign" style="margin-right:4px"></i>Solde sur la photo ($) *</span><input type="number" id="wallet-card-balance" placeholder="Ex: 50" min="1" required /></label>
            <button type="submit" class="btn-primary full" style="margin-top:12px"><i class="fa-solid fa-upload" style="margin-right:8px"></i>Envoyer photo & Recharger</button>
          </form>
        </div>

        <div class="admin-panel">
          <h2><i class="fa-solid fa-clock-rotate-left" style="margin-right:8px"></i>Historique recharges</h2>
          <div class="admin-list">
            ${myPayments.length ? myPayments.map(p=>{
              const raw = p.proof_url||"";
              const proofPath = raw.split("|")[0];
              const balMatch = raw.match(/balance:([0-9]+\.?[0-9]*)/);
              const bal = balMatch ? balMatch[1] : p.amount;
              const statusColor = p.status==="accepted" ? "var(--success)" : p.status==="declined" ? "var(--danger)" : "var(--accent)";
              const statusIcon = p.status==="accepted" ? "fa-circle-check" : p.status==="declined" ? "fa-circle-xmark" : "fa-clock";
              return `<div class="payment-item ${p.status}" style="border-left:3px solid ${statusColor}">
                <div>
                  <strong><i class="fa-solid ${statusIcon}" style="color:${statusColor};margin-right:6px"></i>${p.target==="recharge"||p.target==="balance"?"Recharge":"Paiement"} ${bal}$ • ${escapeHtml(p.status)}</strong>
                  <p style="font-size:0.85rem;color:var(--muted);margin:4px 0"><i class="fa-regular fa-clock"></i> ${new Date(p.created_at).toLocaleString("fr-FR")} | ${escapeHtml(p.method)}</p>
                  ${proofPath?`<button class="mini-btn" data-action="view-proof" data-path="${escapeHtml(proofPath)}"><i class="fa-solid fa-eye"></i> Voir photo</button><div class="proof-preview" id="proof-${escapeHtml(p.id)}" style="margin-top:8px"></div>`:""}
                </div>
                <div style="font-weight:800;color:${statusColor}">${p.status==="accepted"?`+${bal}$ crédités`:`${bal}$`}</div>
              </div>`;
            }).join("") : `<p class="empty-state"><i class="fa-solid fa-inbox"></i> Aucune recharge pour l'instant. Uploade ta première carte !</p>`}
          </div>
        </div>
      </div>

      <!-- SECTION WALLETS CRYPTO - DEMANDE UTILISATEUR -->
      <div class="admin-panel" style="margin-top:24px">
        <h2><i class="fa-solid fa-link" style="margin-right:8px;color:var(--accent)"></i>Mes wallets crypto</h2>
        <p style="color:var(--muted);font-size:0.9rem;margin:0 0 16px">Ajoute tes adresses pour recevoir tes gains ou payer en crypto. Réseaux supportés: Ethereum, Polygon, BSC, Solana.</p>
        
        <div id="wallet-section">
          <div style="display:grid;grid-template-columns:1fr 180px;gap:12px;align-items:end">
            <label><span><i class="fa-solid fa-wallet" style="margin-right:4px"></i>Adresse du wallet *</span>
              <input id="walletAddress" type="text" placeholder="0x... ou adresse Solana" style="font-family:monospace" />
            </label>
            <label><span><i class="fa-solid fa-network-wired" style="margin-right:4px"></i>Réseau</span>
              <select id="walletNetwork" style="padding:12px;border-radius:10px;background:var(--panel-soft);border:1px solid var(--line);color:var(--text)">
                <option value="ethereum">Ethereum</option>
                <option value="polygon">Polygon</option>
                <option value="bsc">BNB Smart Chain</option>
                <option value="solana">Solana</option>
              </select>
            </label>
          </div>
          <button id="addWalletBtn" class="btn-primary" style="margin-top:12px"><i class="fa-solid fa-plus" style="margin-right:6px"></i>Ajouter le wallet</button>
          <p id="walletMessage" style="margin-top:10px;font-size:0.9rem"></p>
          
          <div id="walletList" style="margin-top:16px;display:grid;gap:10px">
            ${(state.wallets||[]).length ? state.wallets.map(w=>{
              const netIcon = w.network==="ethereum" ? "fa-brands fa-ethereum" : w.network==="polygon" ? "fa-solid fa-cube" : w.network==="bsc" ? "fa-solid fa-coins" : "fa-solid fa-sun";
              const netColor = w.network==="ethereum" ? "#627eea" : w.network==="polygon" ? "#8247e5" : w.network==="bsc" ? "#f3ba2f" : "#9945ff";
              return `<div style="background:var(--panel-soft);border:1px solid var(--line);border-radius:12px;padding:14px;display:flex;justify-content:space-between;align-items:center;gap:12px">
                <div style="flex:1;min-width:0">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                    <i class="${netIcon}" style="color:${netColor}"></i>
                    <strong style="text-transform:uppercase;font-size:0.85rem;color:${netColor}">${escapeHtml(w.network)}</strong>
                    <span style="color:var(--muted);font-size:0.75rem">${new Date(w.created_at).toLocaleDateString("fr-FR")}</span>
                  </div>
                  <code style="display:block;background:#000;padding:8px 10px;border-radius:8px;font-size:0.85rem;word-break:break-all;color:var(--text)">${escapeHtml(w.wallet_address)}</code>
                </div>
                <button class="mini-btn danger" data-action="delete-wallet" data-id="${escapeHtml(w.id)}"><i class="fa-solid fa-trash"></i></button>
              </div>`;
            }).join("") : `<p class="empty-state" style="margin-top:8px"><i class="fa-solid fa-wallet"></i> Aucun wallet ajouté. Ajoute ton adresse ${['ethereum','polygon','bsc','solana'][0]} pour commencer.</p>`}
          </div>
        </div>
      </div>
    </section>`;
}

function renderNotFound(){
  return `<section class="page-shell centered" style="text-align:center;padding:80px 24px"><div style="width:100px;height:100px;background:rgba(255,138,0,0.1);border-radius:24px;display:grid;place-items:center;margin:0 auto 20px"><i class="fa-solid fa-map-signs" style="font-size:2.5rem;color:var(--accent)"></i></div><h1 style="font-size:4rem;margin:0">404</h1><p><i class="fa-solid fa-triangle-exclamation" style="margin-right:6px"></i>Cette page n'existe pas.</p><a href="#/" class="btn-primary"><i class="fa-solid fa-house" style="margin-right:8px"></i>Retour accueil</a></section>`;
}
function renderDiscussionPage(){
  return `<section class="page-shell centered" style="text-align:center;padding:80px 24px"><div style="width:80px;height:80px;background:rgba(78,203,113,0.15);border-radius:20px;display:grid;place-items:center;margin:0 auto 20px"><i class="fa-solid fa-circle-check" style="font-size:2.5rem;color:var(--success)"></i></div><h1>Paiement validé</h1><p>Votre paiement a été validé. Vous pouvez poursuivre.</p><a href="${escapeHtml(getRedirectUrl())}" target="_blank" class="btn-primary"><i class="fa-brands fa-telegram" style="margin-right:8px"></i>Aller à la discussion</a><br><br><a href="#/" class="btn-secondary"><i class="fa-solid fa-house" style="margin-right:8px"></i>Retour accueil</a></section>`;
}

// ===== PRODUCTS API =====
async function saveProducts(product){
  const payload={ ...(product.id?{id:product.id}:{}), nom:product.nom, age:Number(product.age), lieu:product.lieu, prix:Number(product.prix), image:product.image, updated_at: new Date().toISOString() };
  // RADICAL: Supabase direct (Vercel safe) au lieu de /api/products
  let saved;
  try {
    const { data, error } = await supabase.from("products").upsert(payload).select().single();
    if(error) throw error;
    saved=data;
  } catch(e) {
    try {
      const result=await apiRequest("/products",{method:"POST",body:JSON.stringify(payload)});
      saved=result.product;
    } catch(e2) { throw e; }
  }
  const idx=state.products.findIndex(x=>String(x.id)===String(saved.id));
  if(idx>=0) state.products[idx]=saved; else state.products.unshift(saved);
  showToast("Produit enregistré", "success");
  return saved;
}
async function deleteProduct(id){
  try {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if(error) throw error;
  } catch(e) {
    try { await apiRequest(`/products/${encodeURIComponent(id)}`,{method:"DELETE"}); } catch(e2) { throw e; }
  }
  state.products=state.products.filter(x=>String(x.id)!==String(id));
  showToast("Produit supprimé", "success");
}

// ===== MODALS =====
function openPaymentModal({ target, productId="", amount=0, title="Paiement", adId="" }){
  $("#payment-title").innerHTML = `<i class="fa-solid fa-lock" style="margin-right:8px"></i>${escapeHtml(title)}`;
  $("#payment-target").value=target;
  $("#payment-product-id").value=productId;
  $("#payment-ad-id").value=adId;
  $("#payment-amount").value=amount;
  const ta=$("#transcash-amount"); if(ta) ta.value=amount;
  const cardFields=$("#card-fields"); if(cardFields) cardFields.classList.remove("hidden");
  const transFields=$("#transcash-fields"); if(transFields) transFields.classList.add("hidden");
  $("#payment-modal").classList.remove("hidden");
}
function closePaymentModal(){
  $("#payment-modal").classList.add("hidden");
  $("#payment-form")?.reset();
  $("#card-fields")?.classList.remove("hidden");
  $("#transcash-fields")?.classList.add("hidden");
  const tp=$("#transcash-preview"); if(tp){ tp.classList.add("hidden"); tp.innerHTML=""; }
  const cp=$("#card-preview"); if(cp){ cp.classList.add("hidden"); cp.innerHTML=""; }
}
function closeAdModal(){ $("#ad-modal").classList.add("hidden"); $("#ad-form").reset(); }

// ===== HANDLERS =====
async function handleLoginSubmit(e){
  e.preventDefault();
  const form=e.currentTarget, email=form.email.value.trim(), password=form.password.value;
  if(!email||!password){ showToast("Remplis tous les champs", "error"); return; }
  try{
    const { error } = await supabase.auth.signInWithPassword({email,password});
    if(error) throw error;
    await hydrateState();
    showToast("Connexion réussie", "success");
    const role=getCurrentUser()?.role;
    window.location.hash=role==="admin"?"#/admin":"#/";
    render();
  } catch(err){ showToast(err.message||"Connexion impossible", "error"); }
}
async function handleSignupSubmit(e){
  e.preventDefault();
  const form=e.currentTarget, fullName=form.fullName.value.trim(), username=form.username.value.trim(), email=form.email.value.trim(), password=form.password.value;
  if(!fullName||!username||!email||!password){ showToast("Remplis tous les champs", "error"); return; }
  if(password.length<6){ showToast("Mot de passe min 6 caractères", "error"); return; }
  try{
    const { data, error } = await supabase.auth.signUp({ email, password, options:{ data:{ full_name:fullName, username }, emailRedirectTo: window.location.origin } });
    if(error) throw error;
    // RADICAL: Désactive confirmation email - tente login immédiat
    let session = data.session;
    let user = data.user;
    if(!session){
      // Si email confirmation désactivée dans Supabase, le login direct marche
      try {
        const { data: loginData, error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
        if(!loginErr && loginData.session){
          session = loginData.session;
          user = loginData.user;
        }
      } catch {}
    }
    if(session){
      await hydrateState();
      showToast("Compte créé ! Portefeuille créé avec 0$ - crédite avant de choisir une fille", "success", 6000);
      window.location.hash="#/wallet";
      render();
    } else {
      showToast("Compte créé ! Connecte-toi puis crédite ton portefeuille", "success", 6000);
      window.location.hash="#/login";
      render();
    }
  } catch(err){ showToast(err.message||"Inscription impossible", "error"); }
}
async function handleAdminProductSubmit(e){
  e.preventDefault();
  const form=e.currentTarget, file=form.imageUpload.files[0];
  let imageValue=form.image.value.trim();
  try{
    if(file){
      const ext=(file.name.split(".").pop()||"jpg").toLowerCase(), path=`products/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(path,file,{upsert:false,contentType:file.type});
      if(error) throw error;
      imageValue=supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
    }
    const product={ id:form.id.value||undefined, nom:form.nom.value.trim(), age:Number(form.age.value), lieu:form.lieu.value.trim(), prix:Number(form.prix.value), image:imageValue };
    if(!product.nom||product.age<18||!product.lieu||product.prix<=0||!product.image){ showToast("Remplis tous les champs + image", "error"); return; }
    await saveProducts(product);
    form.reset();
    $("#product-id").value="";
    render();
  } catch(err){ showToast(err.message||"Erreur produit", "error"); }
}
async function handleAdSubmit(e){
  e.preventDefault();
  const form=e.currentTarget, user=getCurrentUser();
  if(!user){ window.location.hash="#/login"; render(); return; }
  const title=form.adTitle.value.trim(), text=form.adText.value.trim(), file=form.mediaUpload.files[0];
  let mediaType=form.mediaType.value, mediaUrl=form.mediaUrl.value.trim();
  try{
    if(file){
      mediaType=file.type.startsWith("video/")?"video":"image";
      const path=`ads/${user.id}/${crypto.randomUUID()}.${(file.name.split(".").pop()||"bin").toLowerCase()}`;
      const { error } = await supabase.storage.from("product-images").upload(path,file,{upsert:false,contentType:file.type});
      if(error) throw error;
      mediaUrl=supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
    }
    if(!title||(!text&&!mediaUrl)){ showToast("Titre + contenu requis", "error"); return; }
    // RADICAL: Supabase direct
    const { data: adData, error: adError } = await supabase.from("ads").insert({ user_id: user.id, title, text, media_type: mediaType, media_url: mediaUrl, status: "pending" }).select().single();
    if(adError) throw adError;
    const adRes={ ad: adData };
    closeAdModal();
    openPaymentModal({ target:"ad", amount:CONFIG.FIXED_AD_PRICE, title:"Paiement annonce - 1$", adId:adRes.ad.id });
    showToast("Annonce créée, paiement requis", "info");
  } catch(err){ showToast(err.message||"Erreur annonce", "error"); }
}
async function handlePaymentSubmit(e){
  e.preventDefault();
  const user=getCurrentUser();
  if(!user){ showToast("Connecte-toi d'abord", "error"); window.location.hash="#/login"; render(); return; }
  const form=e.currentTarget;
  const method=form.querySelector('input[name="method"]:checked')?.value||"card";
  if(method!=="card"){
    showToast("Méthode invalide - utilisez recharge par carte", "error");
    return;
  }
  // Nouvelle logique: photo de la carte achetée -> crédit solde
  const file = $("#card-proof")?.files[0];
  if(!file){ showToast("Photo de la carte achetée requise", "error"); return; }
  const balanceInput = $("#card-balance")?.value.trim()||"";
  const balanceVal = balanceInput ? Number(balanceInput) : null;
  let amount = Number($("#payment-amount").value||0);
  // Si recharge solde, amount = solde indiqué sur photo, sinon prix produit/annonce
  const target = $("#payment-target").value;
  if(target==="recharge" || target==="balance"){
    amount = balanceVal || amount || 0;
    if(!amount || amount<=0){ showToast("Indique le solde sur la photo (ex: 50)", "error"); return; }
  } else if(balanceVal && balanceVal>0){
    // Si solde renseigné et achat produit, on priorise solde photo pour crédit
    amount = balanceVal;
  }
  const productId=$("#payment-product-id").value||null, adId=$("#payment-ad-id").value||null;
  try{
    const ext = (file.name.split(".").pop()||"jpg").toLowerCase();
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("payment-proofs").upload(path, file, { upsert:false, contentType: file.type });
    if(upErr) throw upErr;
    // Stocke path|balance:XX pour que trigger SQL crédite automatiquement
    const proofWithBalance = balanceVal ? `${path}|balance:${balanceVal}` : path;
    {
      const { error: payErr } = await supabase.from("payments").insert({ 
        user_id: user.id, 
        product_id: productId, 
        ad_id: adId, 
        target, 
        amount, 
        method: "card", 
        status: "pending", 
        validation: "pending", 
        proof_url: proofWithBalance
      });
      if(payErr) throw payErr;
    }
    closePaymentModal();
    if(target==="recharge" || target==="balance"){
      setPaymentNotice(`Recharge de ${amount}$ envoyée. En attente confirmation admin - ${amount}$ seront crédités sur ton solde.`);
      showToast(`Photo uploadée - ${amount}$ en attente de crédit sur ton solde`, "success", 6000);
    } else {
      setPaymentNotice("Photo de carte envoyée. En attente de confirmation admin - le solde sur la photo sera crédité sur votre compte.");
      showToast("Photo uploadée, en attente validation admin pour crédit solde", "success", 6000);
    }
    await hydrateState();
    render();
  } catch(err){ showToast(err.message||"Erreur paiement", "error"); }
}

// ===== GLOBAL CLICKS DYNAMIQUES - PORTEFEUILLE OBLIGATOIRE AVANT CHOISIR =====
async function handleGlobalClick(e){
  const buyBtn=e.target.closest('[data-action="buy"]');
  if(buyBtn){
    const product=state.products.find(x=>String(x.id)===String(buyBtn.dataset.id));
    if(!product) return;
    const user=getCurrentUser();
    if(!user){
      showToast("Crée un compte et crédite ton portefeuille avant de choisir une fille", "error", 5000);
      window.location.hash="#/signup";
      render();
      return;
    }
    const price=Number(product.prix||product.price||0);
    const balance=Number(user.balance||0);
    // Vérifie solde
    if(balance < price){
      buyBtn.innerHTML=`<i class="fa-solid fa-wallet"></i> Solde insuffisant`;
      showToast(`Solde insuffisant: tu as ${balance.toFixed(2)}$, il faut ${price.toFixed(2)}$ pour ${product.nom}. Recharge ton portefeuille d'abord.`, "error", 6000);
      setTimeout(()=>{
        window.location.hash="#/wallet";
        render();
      }, 800);
      setTimeout(()=>{ buyBtn.innerHTML=`<i class="fa-solid fa-bolt" style="margin-right:4px"></i>Choisir`; }, 1500);
      return;
    }
    // Solde suffisant - déduit et donne accès
    buyBtn.innerHTML=`<i class="fa-solid fa-spinner fa-spin"></i> Déduction...`;
    try{
      // Déduit solde
      const { data: prof } = await supabase.from("profiles").select("balance").eq("id", user.id).maybeSingle();
      const currentBal=Number(prof?.balance||balance);
      if(currentBal < price){
        throw new Error(`Solde insuffisant (actuel ${currentBal}$)`);
      }
      const newBal=currentBal - price;
      const { error: balErr } = await supabase.from("profiles").update({ balance: newBal, updated_at: new Date().toISOString() }).eq("id", user.id);
      if(balErr) throw balErr;
      // Enregistre paiement avec solde
      const { error: payErr } = await supabase.from("payments").insert({
        user_id: user.id,
        product_id: product.id,
        target: "product",
        amount: price,
        method: "balance",
        status: "accepted",
        validation: "valid",
        proof_url: `balance deduction ${price}$ -> new balance ${newBal}$`
      });
      if(payErr) console.warn("Payment log failed:", payErr.message);
      // Met à jour local
      user.balance=newBal;
      setCurrentUser(user);
      await hydrateState();
      showToast(`✅ ${price}$ débités - Solde restant ${newBal.toFixed(2)}$ - Accès à ${product.nom}`, "success", 6000);
      setTimeout(()=>{ window.location.href=getRedirectUrl(); }, 1000);
    }catch(err){
      showToast(err.message||"Erreur déduction solde", "error");
      buyBtn.innerHTML=`<i class="fa-solid fa-bolt" style="margin-right:4px"></i>Choisir`;
    }
    return;
  }
  const postBtn=e.target.closest("#post-ad-btn");
  if(postBtn){
    e.preventDefault();
    const user=getCurrentUser();
    if(!user){ window.location.hash="#/login"; render(); showToast("Connecte-toi pour poster", "info"); return; }
    window.location.href="/post.html";
  }
  const searchToggle=e.target.closest("#search-toggle");
  if(searchToggle){
    $("#search-bar").classList.toggle("hidden");
    if(!$("#search-bar").classList.contains("hidden")) $("#global-search").focus();
  }
  const closeSearch=e.target.closest("#close-search");
  if(closeSearch){
    $("#search-bar").classList.add("hidden");
  }
}

// ===== ADMIN HANDLERS =====
function attachAdminHandlers(){
  $("#admin-product-form")?.addEventListener("submit", handleAdminProductSubmit);
  $("#redirect-settings-form")?.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const value=$("#payment-success-link").value.trim();
    if(!value){ showToast("Lien requis", "error"); return; }
    try{
      // RADICAL: Supabase direct
      {
        const { error: setErr } = await supabase.from("settings").upsert({ key: "payment_redirect_url", value, updated_at: new Date().toISOString() });
        if(setErr) throw setErr;
      }
      setRedirectUrl(value);
      showToast("Lien enregistré", "success");
    } catch(err){ showToast(err.message, "error"); }
  });
  $("#reset-product-form")?.addEventListener("click", ()=>{
    $("#admin-product-form")?.reset();
    const id=$("#product-id");
    if(id) id.value="";
  });
  $$('[data-action="edit-product"]').forEach(btn=>btn.addEventListener("click", ()=>{
    const p=state.products.find(x=>String(x.id)===String(btn.dataset.id));
    if(!p) return;
    const form=$("#admin-product-form");
    if(!form) return;
    form.id.value=p.id;
    form.nom.value=p.nom||"";
    form.age.value=p.age||"";
    form.lieu.value=p.lieu||"";
    form.prix.value=p.prix||"";
    form.image.value=p.image||"";
    window.scrollTo({top:0,behavior:"smooth"});
    showToast(`Modification de ${p.nom}`, "info");
  }));
  $$('[data-action="delete-product"]').forEach(btn=>btn.addEventListener("click", async ()=>{
    if(!confirm("Supprimer ce produit ?")) return;
    try{ await deleteProduct(btn.dataset.id); render(); }catch(e){ showToast(e.message, "error"); }
  }));
  $$('[data-action="accept-payment"]').forEach(btn=>btn.addEventListener("click", async ()=>{
    try{
      btn.innerHTML=`<i class="fa-solid fa-spinner fa-spin"></i> Crédit...`;
      const balanceStr = btn.dataset.balance||"";
      let creditAmount = balanceStr ? Number(balanceStr) : 0;
      // RADICAL: Supabase direct + crédit automatique solde
      let payment;
      {
        const { data, error: payUpErr } = await supabase.from("payments").update({ status: "accepted", validation: "valid", updated_at: new Date().toISOString() }).eq("id", btn.dataset.id).select().single();
        if(payUpErr) throw payUpErr;
        payment=data;
        if(!creditAmount || creditAmount<=0){
          // Fallback: extrait balance depuis proof_url si présent
          const raw = payment.proof_url||"";
          const m = raw.match(/balance:([0-9]+\.?[0-9]*)/);
          if(m) creditAmount = Number(m[1]);
          else creditAmount = Number(payment.amount||0);
        }
        if(payment.target==="ad" && payment.ad_id) {
          await supabase.from("ads").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", payment.ad_id);
        }
        // Crédit automatique solde utilisateur (fallback si trigger SQL non installé)
        if(creditAmount>0 && payment.user_id){
          try{
            // Récupère profil actuel
            const { data: prof } = await supabase.from("profiles").select("balance").eq("id", payment.user_id).maybeSingle();
            const currentBal = Number(prof?.balance||0);
            const { error: balErr } = await supabase.from("profiles").update({ 
              balance: currentBal + creditAmount,
              total_credited: (Number(prof?.total_credited||0) || currentBal) + creditAmount,
              updated_at: new Date().toISOString()
            }).eq("id", payment.user_id);
            if(balErr){
              console.warn("Balance update failed (peut-être RLS, trigger va gérer):", balErr.message);
              // Si RLS bloque, le trigger SQL côté DB va créditer automatiquement
            }
          }catch(be){
            console.warn("Balance credit fallback error:", be.message);
          }
        }
      }
      await hydrateState();
      clearPaymentNotice();
      if(creditAmount>0){
        showToast(`✅ ${creditAmount}$ crédités automatiquement sur compte client`, "success", 6000);
      } else {
        showToast("Paiement accepté", "success");
      }
      render();
    } catch(e){ 
      showToast(e.message, "error"); 
      btn.innerHTML=`<i class="fa-solid fa-check"></i> Accepter`;
    }
  }));
  $$('[data-action="decline-payment"]').forEach(btn=>btn.addEventListener("click", async ()=>{
    try{
      {
        const { data: payment, error: payUpErr } = await supabase.from("payments").update({ status: "declined", validation: "invalid", updated_at: new Date().toISOString() }).eq("id", btn.dataset.id).select().single();
        if(payUpErr) throw payUpErr;
        if(payment.target==="ad" && payment.ad_id) {
          await supabase.from("ads").update({ status: "declined", updated_at: new Date().toISOString() }).eq("id", payment.ad_id);
        }
      }
      await hydrateState();
      showToast("Paiement décliné", "info");
      render();
    } catch(e){ showToast(e.message, "error"); }
  }));
  $$('[data-action="delete-ad"]').forEach(btn=>btn.addEventListener("click", async ()=>{
    if(!confirm("Supprimer cette annonce ?")) return;
    try{ const { error } = await supabase.from("ads").delete().eq("id", btn.dataset.id); if(error) throw error; await hydrateState(); showToast("Annonce supprimée", "success"); render(); }catch(e){ showToast(e.message, "error"); }
  }));
  $$('[data-action="view-proof"]').forEach(btn=>btn.addEventListener("click", async ()=>{
    const path = btn.dataset.path;
    const previewId = btn.nextElementSibling?.id;
    const previewEl = previewId ? document.getElementById(previewId) : btn.nextElementSibling;
    if(!path) return;
    btn.innerHTML=`<i class="fa-solid fa-spinner fa-spin"></i> Chargement...`;
    try {
      const { data, error } = await supabase.storage.from("payment-proofs").createSignedUrl(path, 300);
      if(error) throw error;
      if(previewEl) {
        previewEl.innerHTML=`<a href="${data.signedUrl}" target="_blank"><img src="${data.signedUrl}" alt="Preuve" class="payment-proof" style="width:100%;max-width:300px;border-radius:8px;margin-top:8px" /></a>`;
      } else {
        window.open(data.signedUrl, "_blank");
      }
      showToast("Preuve chargée", "success");
    } catch(e) {
      showToast("Erreur preuve: "+e.message, "error");
    } finally {
      btn.innerHTML=`<i class="fa-solid fa-eye"></i> Voir preuve`;
    }
  }));
  $("#admin-logout-btn")?.addEventListener("click", logoutUser);
}

// ===== MODAL BINDINGS =====
function bindModalControls(){
  $("#close-payment-modal")?.addEventListener("click", closePaymentModal);
  $("#close-ad-modal")?.addEventListener("click", closeAdModal);
  $("#payment-modal")?.addEventListener("click", (e)=>{ if(e.target.id==="payment-modal") closePaymentModal(); });
  $("#ad-modal")?.addEventListener("click", (e)=>{ if(e.target.id==="ad-modal") closeAdModal(); });
  $("#payment-form")?.addEventListener("submit", async (e)=>{
    const target=$("#payment-target").value;
    if(target==="ad"){
      e.preventDefault();
      // Même logique carte pour les annonces
      await handlePaymentSubmit(e);
      return;
    }
    await handlePaymentSubmit(e);
  });
  $("#ad-form")?.addEventListener("submit", handleAdSubmit);
  $$('input[name="method"]').forEach(input=>input.addEventListener("change", ()=>{
    // Maintenant seul card existe, on force affichage carte
    $("#card-fields")?.classList.remove("hidden");
    $("#transcash-fields")?.classList.add("hidden");
  }));
  // Preview photo carte achetée
  $("#card-proof")?.addEventListener("change", async function(){
    const file=this.files[0], preview=$("#card-preview");
    if(!file){ preview?.classList.add("hidden"); if(preview) preview.innerHTML=""; return; }
    try{
      const data=await readFileAsDataUrl(file);
      if(preview){ preview.innerHTML=`<img src="${data}" alt="Photo carte" style="width:100%;max-height:220px;object-fit:contain;border-radius:8px" /><p style="font-size:0.8rem;color:var(--muted);margin-top:6px"><i class="fa-solid fa-check" style="color:var(--success)"></i> Photo prête - solde sera vérifié par admin</p>`; preview.classList.remove("hidden"); }
    } catch { showToast("Fichier illisible", "error"); }
  });
  // Legacy compat
  $("#transcash-proof")?.addEventListener("change", async function(){
    const file=this.files[0], preview=$("#transcash-preview");
    if(!file){ preview?.classList.add("hidden"); return; }
    try{
      const data=await readFileAsDataUrl(file);
      if(preview){ preview.innerHTML=`<img src="${data}" alt="Preuve" />`; preview.classList.remove("hidden"); }
    } catch { showToast("Fichier illisible", "error"); }
  });
  $("#card-number")?.addEventListener("input", function(){
    let v=this.value.replace(/\s/g,"").replace(/[^0-9]/gi,"");
    let formatted = v.match(/.{1,4}/g)?.join(" ")||v;
    this.value=formatted;
  });

  // Wallet recharge form
  $("#wallet-recharge-form")?.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const user=getCurrentUser();
    if(!user){ showToast("Connecte-toi", "error"); return; }
    const file=$("#wallet-card-proof")?.files[0];
    const balStr=$("#wallet-card-balance")?.value.trim()||"";
    const bal=Number(balStr);
    if(!file){ showToast("Photo carte requise", "error"); return; }
    if(!bal || bal<=0){ showToast("Solde sur photo requis", "error"); return; }
    const btn=e.target.querySelector('button[type="submit"]');
    const orig=btn.innerHTML;
    btn.disabled=true;
    btn.innerHTML=`<i class="fa-solid fa-spinner fa-spin"></i> Envoi...`;
    try{
      const ext=(file.name.split(".").pop()||"jpg").toLowerCase();
      const path=`${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("payment-proofs").upload(path, file, { upsert:false, contentType:file.type });
      if(upErr) throw upErr;
      const proofWithBalance=`${path}|balance:${bal}`;
      const { error: payErr } = await supabase.from("payments").insert({
        user_id: user.id,
        target: "recharge",
        amount: bal,
        method: "card",
        status: "pending",
        validation: "pending",
        proof_url: proofWithBalance
      });
      if(payErr) throw payErr;
      showToast(`${bal}$ en attente de validation admin - sera crédité automatiquement`, "success", 6000);
      e.target.reset();
      const prev=$("#wallet-card-preview"); if(prev){ prev.classList.add("hidden"); prev.innerHTML=""; }
      await hydrateState();
      render();
    }catch(err){
      showToast(err.message||"Erreur recharge", "error");
      btn.disabled=false;
      btn.innerHTML=orig;
    }
  });
  $("#wallet-card-proof")?.addEventListener("change", async function(){
    const file=this.files[0], preview=$("#wallet-card-preview");
    if(!file){ preview?.classList.add("hidden"); if(preview) preview.innerHTML=""; return; }
    try{
      const data=await readFileAsDataUrl(file);
      if(preview){ preview.innerHTML=`<img src="${data}" alt="Photo carte" style="width:100%;max-height:220px;object-fit:contain;border-radius:8px" /><p style="font-size:0.8rem;color:var(--muted);margin-top:6px"><i class="fa-solid fa-check" style="color:var(--success)"></i> Photo prête - ${$("#wallet-card-balance")?.value||"? "}$ sera crédité après validation</p>`; preview.classList.remove("hidden"); }
    }catch{ showToast("Fichier illisible", "error"); }
  });

  // Wallets crypto handlers
  async function loadWallets(){
    try{
      const { data, error } = await supabase.from("wallets").select("*").order("created_at",{ascending:false});
      if(error) throw error;
      state.wallets=data||[];
      // Re-render wallet list if on wallet page
      if(window.location.hash.includes("wallet")){
        const list=$("#walletList");
        if(list){
          if(!state.wallets.length){
            list.innerHTML=`<p class="empty-state"><i class="fa-solid fa-wallet"></i> Aucun wallet ajouté.</p>`;
          } else {
            list.innerHTML=state.wallets.map(w=>{
              const netIcon = w.network==="ethereum" ? "fa-brands fa-ethereum" : w.network==="polygon" ? "fa-solid fa-cube" : w.network==="bsc" ? "fa-solid fa-coins" : "fa-solid fa-sun";
              const netColor = w.network==="ethereum" ? "#627eea" : w.network==="polygon" ? "#8247e5" : w.network==="bsc" ? "#f3ba2f" : "#9945ff";
              return `<div style="background:var(--panel-soft);border:1px solid var(--line);border-radius:12px;padding:14px;display:flex;justify-content:space-between;align-items:center;gap:12px">
                <div style="flex:1;min-width:0">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                    <i class="${netIcon}" style="color:${netColor}"></i>
                    <strong style="text-transform:uppercase;font-size:0.85rem;color:${netColor}">${escapeHtml(w.network)}</strong>
                    <span style="color:var(--muted);font-size:0.75rem">${new Date(w.created_at).toLocaleDateString("fr-FR")}</span>
                  </div>
                  <code style="display:block;background:#000;padding:8px 10px;border-radius:8px;font-size:0.85rem;word-break:break-all;color:var(--text)">${escapeHtml(w.wallet_address)}</code>
                </div>
                <button class="mini-btn danger" data-action="delete-wallet" data-id="${escapeHtml(w.id)}"><i class="fa-solid fa-trash"></i></button>
              </div>`;
            }).join("");
            // Re-attach delete handlers
            list.querySelectorAll('[data-action="delete-wallet"]').forEach(btn=>{
              btn.addEventListener("click", async ()=>{
                if(!confirm("Supprimer ce wallet ?")) return;
                try{
                  const { error } = await supabase.from("wallets").delete().eq("id", btn.dataset.id);
                  if(error) throw error;
                  showToast("Wallet supprimé", "success");
                  await loadWallets();
                  render();
                }catch(e){ showToast(e.message||"Erreur suppression", "error"); }
              });
            });
          }
        }
      }
    }catch(e){
      console.warn("loadWallets error:", e.message);
    }
  }

  $("#addWalletBtn")?.addEventListener("click", async ()=>{
    const address=$("#walletAddress")?.value.trim()||"";
    const network=$("#walletNetwork")?.value||"ethereum";
    const msgEl=$("#walletMessage");
    if(!address){
      if(msgEl){ msgEl.textContent="Adresse requise"; msgEl.style.color="var(--danger)"; }
      showToast("Adresse wallet requise", "error");
      return;
    }
    if(address.length<10){
      if(msgEl){ msgEl.textContent="Adresse trop courte"; msgEl.style.color="var(--danger)"; }
      showToast("Adresse invalide", "error");
      return;
    }
    const btn=$("#addWalletBtn");
    const orig=btn.innerHTML;
    btn.disabled=true;
    btn.innerHTML=`<i class="fa-solid fa-spinner fa-spin"></i> Ajout...`;
    if(msgEl){ msgEl.textContent="Ajout en cours..."; msgEl.style.color="var(--muted)"; }
    try{
      const user=getCurrentUser();
      if(!user) throw new Error("Connecte-toi d'abord");
      const { data, error } = await supabase.from("wallets").insert({
        user_id: user.id,
        wallet_address: address,
        network
      }).select().single();
      if(error) throw error;
      if(msgEl){ msgEl.textContent=`✅ Wallet ${network} ajouté`; msgEl.style.color="var(--success)"; }
      showToast(`Wallet ${network} ajouté`, "success");
      $("#walletAddress").value="";
      await loadWallets();
      render();
    }catch(e){
      if(msgEl){ msgEl.textContent=`❌ ${e.message}`; msgEl.style.color="var(--danger)"; }
      showToast(e.message||"Erreur ajout wallet", "error");
    }finally{
      btn.disabled=false;
      btn.innerHTML=orig;
    }
  });

  // Delete wallet delegation (for dynamically rendered)
  document.body.addEventListener("click", async (e)=>{
    const delBtn=e.target.closest('[data-action="delete-wallet"]');
    if(delBtn){
      e.preventDefault();
      if(!confirm("Supprimer ce wallet ?")) return;
      try{
        const { error } = await supabase.from("wallets").delete().eq("id", delBtn.dataset.id);
        if(error) throw error;
        showToast("Wallet supprimé", "success");
        state.wallets=state.wallets.filter(w=>String(w.id)!==String(delBtn.dataset.id));
        delBtn.closest("div").remove();
        if(!state.wallets.length){
          const list=$("#walletList");
          if(list) list.innerHTML=`<p class="empty-state"><i class="fa-solid fa-wallet"></i> Aucun wallet. Ajoute ton adresse.</p>`;
        }
      }catch(err){ showToast(err.message||"Erreur", "error"); }
    }
  });

  // Search
  $("#global-search")?.addEventListener("input", (e)=>{
    state.searchQuery=e.target.value;
    if(window.location.hash.includes("products") || window.location.hash==="#/" || window.location.hash===""){
      render();
      initDynamicEffects();
    }
  });
  $("#catalog-search")?.addEventListener("input", (e)=>{
    state.searchQuery=e.target.value;
    render();
    initDynamicEffects();
    const input = $("#catalog-search");
    if(input){
      input.focus();
      const val=input.value;
      input.value="";
      input.value=val;
    }
  });
  $("#clear-filter")?.addEventListener("click", ()=>{
    state.searchQuery="";
    const gs=$("#global-search");
    if(gs) gs.value="";
    render();
    initDynamicEffects();
    showToast("Filtres effacés", "info");
  });
}

// ===== LOGOUT =====
async function logoutUser(){
  await supabase.auth.signOut();
  setCurrentUser(null);
  state.payments=[];
  showToast("Déconnexion réussie", "info");
  window.location.hash="#/";
  render();
}

// ===== RENDER CORE DYNAMIQUE =====
async function render(){
  const app=$("#app");
  const hash=window.location.hash||"#/";
  const route=hash.replace("#","").split("/").filter(Boolean)[0]||"home";

  let html="";
  if(route==="login") html=renderLoginPage();
  else if(route==="signup") html=renderSignupPage();
  else if(route==="admin"){
    const cur=getCurrentUser();
    if(!cur||cur.role!=="admin"){ window.location.hash="#/login"; render(); return; }
    html=renderAdminPage();
  }
  else if(route==="wallet"||route==="balance"||route==="solde") html=renderWalletPage();
  else if(route==="products") html=renderProductsPage();
  else if(route==="discussion") html=renderDiscussionPage();
  else if(route==="home"||route==="") html=renderHome();
  else html=renderNotFound();

  // Transition dynamique
  app.style.opacity="0";
  app.style.transform="translateY(10px)";
  app.style.transition="opacity .3s ease, transform .3s ease";
  
  setTimeout(()=>{
    app.innerHTML=html;
    app.style.opacity="1";
    app.style.transform="translateY(0)";

    if(route==="login") $("#login-form")?.addEventListener("submit", handleLoginSubmit);
    if(route==="signup") $("#signup-form")?.addEventListener("submit", handleSignupSubmit);
    if(route==="admin") attachAdminHandlers();
    if(route==="products"){
      $("#catalog-search")?.addEventListener("input", (e)=>{
        state.searchQuery=e.target.value;
        const grid = app.querySelector(".product-grid");
        if(grid){
          const filtered = state.products.filter(p=> `${p.nom} ${p.lieu} ${p.age} ${p.prix}`.toLowerCase().includes(state.searchQuery.toLowerCase()));
          grid.innerHTML = filtered.length ? filtered.map(renderProductCard).join("") : `<p class="empty-state"><i class="fa-solid fa-face-frown"></i> Aucun résultat</p>`;
          initDynamicEffects();
        }
      });
      $("#clear-filter")?.addEventListener("click", ()=>{
        state.searchQuery="";
        render();
      });
    }

    renderBanner();
    renderNotice();
    startHeroSlideshow();
    initDynamicEffects();

    const user=getCurrentUser();
    const loginLink=$("#login-link");
    const signupLink=$("#signup-link");
    const logoutBtn=$("#logout-btn");
    let adminLink=$("#admin-link");
    let walletLink=$("#wallet-link");
    let balanceBadge=$("#balance-badge");

    if(user){
      // Balance badge + wallet link for all logged users
      if(!walletLink){
        walletLink=document.createElement("a");
        walletLink.id="wallet-link";
        walletLink.href="#/wallet";
        walletLink.className="nav-link";
        walletLink.style.background="rgba(255,138,0,0.12)";
        walletLink.style.border="1px solid rgba(255,138,0,0.3)";
        walletLink.style.borderRadius="20px";
        walletLink.style.padding="6px 12px";
        walletLink.style.fontWeight="800";
        $(".header-actions")?.prepend(walletLink);
      }
      walletLink.innerHTML=`<i class="fa-solid fa-wallet" style="color:var(--accent)"></i> ${Number(user.balance||0).toFixed(0)}$`;
      walletLink.title=`Solde: ${Number(user.balance||0).toFixed(2)}$ - Cliquer pour recharger`;

      if(user?.role==="admin"){
        if(!adminLink){
          adminLink=document.createElement("a");
          adminLink.id="admin-link";
          adminLink.href="#/admin";
          adminLink.className="nav-link";
          adminLink.innerHTML=`<i class="fa-solid fa-shield-halved"></i> Admin`;
          adminLink.style.color="var(--accent)";
          adminLink.style.fontWeight="800";
          $(".header-actions")?.appendChild(adminLink);
        }
        loginLink?.classList.add("hidden");
        signupLink?.classList.add("hidden");
        logoutBtn?.classList.remove("hidden");
      } else {
        if(adminLink) adminLink.remove();
        loginLink?.classList.add("hidden");
        signupLink?.classList.add("hidden");
        logoutBtn?.classList.remove("hidden");
      }
    } else {
      if(adminLink) adminLink.remove();
      if(walletLink) walletLink.remove();
      loginLink?.classList.remove("hidden");
      signupLink?.classList.remove("hidden");
      logoutBtn?.classList.add("hidden");
    }

    $$(".main-nav a").forEach(a=>{
      const isActive=(route==="home"&&a.dataset.nav==="home")||a.dataset.nav===route;
      a.classList.toggle("active", isActive);
    });

  }, 150);
}

// ===== INIT DYNAMIQUE =====
$("#logout-btn")?.addEventListener("click", logoutUser);
document.body.addEventListener("click", handleGlobalClick);
bindModalControls();
window.addEventListener("hashchange", ()=> render());

supabase.auth.onAuthStateChange(()=>{
  setTimeout(async()=>{ await hydrateState(); render(); },0);
});

console.log("%cEscortHub v2 - Font Awesome Pro - Dynamique", "color:#ff8a00;font-size:16px;font-weight:900");
console.log("%cSince 2013 - Worldwide", "color:#9a9a9a");

hydrateState().then(()=>{
  render();
  setTimeout(hidePageLoader, 800);
  showToast(`Bienvenue sur EscortHub • ${state.products.length} profils disponibles`, "info", 5000);
}).catch(err=>{
  console.error("Init error:",err);
  render();
  hidePageLoader();
  showToast("Erreur de chargement, réessayez", "error");
});

window._escorthub = { supabase, state, CONFIG, showToast };
