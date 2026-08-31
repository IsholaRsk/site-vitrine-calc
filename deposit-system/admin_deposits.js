// ============================================
// 5. JS ADMIN - Approbation / Refus sécurisé via RPC
// ============================================
import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "../config.js";

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);

const $ = (s) => document.querySelector(s);

function escapeHtml(v){ return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function showToast(msg, type="info", duration=4000){
  const c=$("#toast-container");
  if(!c) return;
  const d=document.createElement("div");
  d.className=`toast ${type}`;
  d.innerHTML=`<i class="fa-solid ${type==="success"?"fa-circle-check":type==="error"?"fa-circle-xmark":"fa-circle-info"}"></i><span>${escapeHtml(msg)}</span>`;
  c.appendChild(d);
  setTimeout(()=>{ d.style.opacity="0"; setTimeout(()=>d.remove(),300); }, duration);
}

let currentFilter = "pending";
let pendingRejectId = null;
let allDeposits = [];

async function checkAdmin(){
  const { data:{ user } } = await supabase.auth.getUser();
  if(!user){
    window.location.href="/#login";
    return null;
  }
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if(!profile || profile.role!=="admin"){
    showToast("Accès admin requis","error");
    setTimeout(()=>window.location.href="/",1500);
    return null;
  }
  return user;
}

async function loadDeposits(){
  const container=$("#adminDepositList");
  const badge=$("#countBadge");
  try{
    const { data, error } = await supabase.from("deposit_requests").select(`
      *,
      profiles:user_id (username, full_name, email, balance)
    `).order("created_at",{ascending:false});
    if(error) throw error;
    allDeposits = data||[];
    renderDeposits();
    if(badge) badge.textContent = `${allDeposits.length} demandes • ${allDeposits.filter(d=>d.status==="pending").length} en attente`;
  }catch(e){
    container.innerHTML=`<p class="empty" style="color:var(--danger)">Erreur: ${escapeHtml(e.message)}</p>`;
  }
}

function renderDeposits(){
  const container=$("#adminDepositList");
  let filtered = allDeposits;
  if(currentFilter!=="all"){
    filtered = allDeposits.filter(d=>d.status===currentFilter);
  }
  if(!filtered.length){
    container.innerHTML=`<p class="empty"><i class="fa-solid fa-inbox"></i> Aucune demande ${currentFilter==="pending"?"en attente":currentFilter==="approved"?"approuvée":currentFilter==="rejected"?"refusée":""}.</p>`;
    return;
  }
  container.innerHTML = filtered.map(req=>{
    const user = req.profiles || {};
    const statusMap = {
      pending: { label:"En attente", color:"var(--accent)", icon:"fa-clock" },
      approved: { label:"Approuvée", color:"var(--success)", icon:"fa-circle-check" },
      rejected: { label:"Refusée", color:"var(--danger)", icon:"fa-circle-xmark" }
    };
    const st = statusMap[req.status] || statusMap.pending;
    const proofPath = (req.proof_url||"").split("|")[0];
    return `<div class="deposit-admin-card" style="border-left:3px solid ${st.color}">
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
          <strong style="font-size:1.1rem"><i class="fa-solid ${st.icon}" style="color:${st.color}"></i> ${Number(req.amount).toFixed(2)}$ • ${st.label}</strong>
          <span style="font-size:0.8rem;color:var(--muted)">${new Date(req.created_at).toLocaleString("fr-FR")}</span>
        </div>
        <div style="display:grid;gap:6px;font-size:0.9rem">
          <span><i class="fa-solid fa-user" style="color:var(--accent)"></i> <strong>${escapeHtml(user.username||"Utilisateur")}</strong> (${escapeHtml(user.full_name||"")}) - ${escapeHtml(user.email||req.user_id.slice(0,8))} | Solde actuel: <strong>${Number(user.balance||0).toFixed(2)}$</strong></span>
          <span><i class="fa-solid fa-credit-card"></i> Méthode: <strong>${escapeHtml(req.payment_method)}</strong></span>
          <span><i class="fa-solid fa-hashtag"></i> Référence: <code style="background:#000;padding:2px 6px;border-radius:4px">${escapeHtml(req.transaction_reference)}</code></span>
          ${req.rejection_reason?`<span style="color:var(--danger)"><i class="fa-solid fa-circle-info"></i> Motif refus: ${escapeHtml(req.rejection_reason)}</span>`:""}
          ${req.processed_at?`<span><i class="fa-solid fa-user-shield"></i> Traité le ${new Date(req.processed_at).toLocaleString("fr-FR")} par admin ${escapeHtml((req.admin_id||"").slice(0,8))}</span>`:""}
        </div>
        ${proofPath?`<div style="margin-top:12px"><button class="btn-secondary" data-proof="${escapeHtml(proofPath)}"><i class="fa-solid fa-eye"></i> Voir preuve Transcash</button><div class="proof-preview" id="proof-${req.id}" style="margin-top:8px"></div></div>`:`<p style="color:var(--muted);font-size:0.85rem;margin-top:8px"><i class="fa-solid fa-circle-info"></i> Pas de preuve jointe</p>`}
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;min-width:160px">
        ${req.status==="pending"?`
          <button class="btn-primary" data-approve="${req.id}" style="background:var(--success);color:#fff"><i class="fa-solid fa-check"></i> Approuver & Créditer ${Number(req.amount).toFixed(0)}$</button>
          <button class="btn-secondary" data-reject="${req.id}" style="border-color:var(--danger);color:var(--danger)"><i class="fa-solid fa-xmark"></i> Refuser</button>
          <small style="color:var(--muted);font-size:0.75rem;text-align:center">Crédit atomique sécurisé via RPC - anti double crédit</small>
        `:`
          <span style="padding:8px 12px;border-radius:20px;background:${st.color};color:${req.status==="rejected"?"#fff":"#111"};font-weight:800;text-align:center;font-size:0.85rem"><i class="fa-solid ${st.icon}"></i> ${st.label}</span>
          ${req.status==="approved"?`<small style="color:var(--success);font-size:0.75rem;text-align:center">✅ ${Number(req.amount).toFixed(2)}$ crédités</small>`:""}
        `}
      </div>
    </div>`;
  }).join("");

  // Bind proof buttons
  container.querySelectorAll("[data-proof]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const path=btn.getAttribute("data-proof");
      const preview=btn.nextElementSibling;
      btn.innerHTML=`<i class="fa-solid fa-spinner fa-spin"></i> Chargement...`;
      try{
        const { data, error } = await supabase.storage.from("deposit-proofs").createSignedUrl(path, 600);
        if(error) throw error;
        const isPdf = path.toLowerCase().endsWith(".pdf");
        if(isPdf){
          preview.innerHTML=`<a href="${data.signedUrl}" target="_blank" class="btn-primary" style="margin-top:8px"><i class="fa-solid fa-file-pdf"></i> Ouvrir PDF preuve</a>`;
        } else {
          preview.innerHTML=`<a href="${data.signedUrl}" target="_blank"><img src="${data.signedUrl}" style="width:100%;max-width:400px;border-radius:10px;margin-top:8px;border:1px solid var(--line)" /></a>`;
        }
      }catch(e){
        showToast("Erreur preuve: "+e.message,"error");
      }finally{
        btn.innerHTML=`<i class="fa-solid fa-eye"></i> Voir preuve Transcash`;
      }
    });
  });

  // Bind approve
  container.querySelectorAll("[data-approve]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id=btn.getAttribute("data-approve");
      if(!confirm(`Approuver cette demande et créditer ${btn.textContent.match(/[0-9]+/)?.[0]||"? "}$ ?\n\n⚠️ Opération atomique sécurisée côté serveur - anti double crédit.`)) return;
      btn.disabled=true;
      btn.innerHTML=`<i class="fa-solid fa-spinner fa-spin"></i> Crédit...`;
      try{
        // Appel RPC sécurisé approve_deposit - atomique serveur
        const { data, error } = await supabase.rpc("approve_deposit", { request_id: id });
        if(error) throw error;
        showToast(`✅ ${data.amount}$ crédités à l'utilisateur - Nouveau solde ${Number(data.new_balance).toFixed(2)}$`, "success", 6000);
        await loadDeposits();
      }catch(e){
        showToast("Erreur approbation: "+e.message,"error");
        btn.disabled=false;
        btn.innerHTML=`<i class="fa-solid fa-check"></i> Approuver`;
      }
    });
  });

  // Bind reject (ouvre modal)
  container.querySelectorAll("[data-reject]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      pendingRejectId = btn.getAttribute("data-reject");
      $("#rejectModal").classList.remove("hidden");
      $("#rejectReason").value="";
      $("#rejectReason").focus();
    });
  });
}

// Modal refus
$("#cancelReject")?.addEventListener("click", ()=>{
  $("#rejectModal").classList.add("hidden");
  pendingRejectId=null;
});
$("#rejectModal")?.addEventListener("click", (e)=>{
  if(e.target.id==="rejectModal") $("#rejectModal").classList.add("hidden");
});
$("#confirmReject")?.addEventListener("click", async ()=>{
  const reason=$("#rejectReason").value.trim();
  if(!reason || reason.length<3){
    showToast("Motif de refus requis (min 3 caractères)","error");
    return;
  }
  if(!pendingRejectId) return;
  const btn=$("#confirmReject");
  const orig=btn.innerHTML;
  btn.disabled=true;
  btn.innerHTML=`<i class="fa-solid fa-spinner fa-spin"></i> Refus...`;
  try{
    const { data, error } = await supabase.rpc("reject_deposit", { request_id: pendingRejectId, reason });
    if(error) throw error;
    showToast("Demande refusée - utilisateur informé","info");
    $("#rejectModal").classList.add("hidden");
    pendingRejectId=null;
    await loadDeposits();
  }catch(e){
    showToast("Erreur refus: "+e.message,"error");
  }finally{
    btn.disabled=false;
    btn.innerHTML=orig;
  }
});

// Filtres
document.querySelectorAll(".filter-btn").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".filter-btn").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter=btn.dataset.filter;
    renderDeposits();
  });
});

$("#logoutBtn")?.addEventListener("click", async ()=>{
  await supabase.auth.signOut();
  localStorage.removeItem("escorhub-current-user");
  window.location.href="/#login";
});

// Init
(async ()=>{
  const admin=await checkAdmin();
  if(!admin) return;
  await loadDeposits();
})();
