// ============================================
// 4. JS UTILISATEUR - Dépôt / Crédit compte
// Compatible avec config.js actuel
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
  d.innerHTML=`<i class="fa-solid ${type==="success"?"fa-circle-check":type==="error"?"fa-circle-xmark":"fa-circle-info"}"></i><span>${escapeHtml(msg)}</span><button style="margin-left:auto;background:transparent;border:none;color:#9a9a9a;cursor:pointer" onclick="this.parentElement.remove()"><i class="fa-solid fa-xmark"></i></button>`;
  c.appendChild(d);
  setTimeout(()=>{ d.style.opacity="0"; setTimeout(()=>d.remove(),300); }, duration);
}

function getCurrentUser(){
  try{ return JSON.parse(localStorage.getItem("escorhub-current-user")||"null"); }catch{ return null; }
}

async function refreshAuth(){
  const { data:{ user } } = await supabase.auth.getUser();
  if(!user){
    window.location.href="/#login";
    return null;
  }
  return user;
}

async function loadBalance(){
  try{
    // Essaie RPC sécurisé d'abord, puis direct
    let balance = 0;
    try{
      const { data, error } = await supabase.rpc("get_my_balance");
      if(!error && data!==null) balance = Number(data);
      else throw error||new Error("RPC failed");
    }catch{
      const { data: { user } } = await supabase.auth.getUser();
      if(user){
        const { data: prof } = await supabase.from("profiles").select("balance").eq("id", user.id).maybeSingle();
        balance = Number(prof?.balance||0);
      }
    }
    $("#currentBalance").textContent = `${balance.toFixed(2)}$`;
    const badge=$("#balance-badge");
    if(badge) badge.innerHTML=`<i class="fa-solid fa-wallet"></i> ${balance.toFixed(0)}$`;
    return balance;
  }catch(e){
    console.warn("loadBalance error:", e.message);
    return 0;
  }
}

async function loadHistory(){
  const container=$("#depositHistory");
  try{
    const { data, error } = await supabase.from("deposit_requests").select("*").order("created_at",{ascending:false});
    if(error) throw error;
    if(!data || !data.length){
      container.innerHTML=`<p class="empty"><i class="fa-solid fa-inbox"></i> Aucune demande pour l'instant. Clique "Créditer mon compte".</p>`;
      return;
    }
    container.innerHTML = data.map(req=>{
      const statusMap = { pending: { label:"En attente", color:"var(--accent)", icon:"fa-clock" }, approved:{ label:"Approuvée", color:"var(--success)", icon:"fa-circle-check" }, rejected:{ label:"Refusée", color:"var(--danger)", icon:"fa-circle-xmark" } };
      const st = statusMap[req.status] || statusMap.pending;
      const proofPath = (req.proof_url||"").split("|")[0];
      return `<div class="history-item ${req.status}" style="border-left-color:${st.color}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <strong><i class="fa-solid ${st.icon}" style="color:${st.color};margin-right:6px"></i>${Number(req.amount).toFixed(2)}$ • ${st.label}</strong>
          <span style="font-size:0.8rem;color:var(--muted)">${new Date(req.created_at).toLocaleString("fr-FR")}</span>
        </div>
        <div style="font-size:0.85rem;color:var(--muted);margin-top:6px;display:grid;gap:4px">
          <span><i class="fa-solid fa-credit-card" style="margin-right:4px"></i>Méthode: ${escapeHtml(req.payment_method)}</span>
          <span><i class="fa-solid fa-hashtag" style="margin-right:4px"></i>Réf: ${escapeHtml(req.transaction_reference)}</span>
          ${req.rejection_reason?`<span style="color:var(--danger)"><i class="fa-solid fa-circle-info"></i> Motif refus: ${escapeHtml(req.rejection_reason)}</span>`:""}
          ${req.processed_at?`<span><i class="fa-solid fa-check"></i> Traité le ${new Date(req.processed_at).toLocaleString("fr-FR")}</span>`:""}
        </div>
        ${proofPath?`<div style="margin-top:8px"><button class="mini-btn" data-proof="${escapeHtml(proofPath)}"><i class="fa-solid fa-eye"></i> Voir preuve</button><div class="proof-preview" id="proof-${req.id}" style="margin-top:8px"></div></div>`:""}
      </div>`;
    }).join("");

    // Preview proofs
    container.querySelectorAll("[data-proof]").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const path=btn.getAttribute("data-proof");
        const previewId=btn.nextElementSibling?.id;
        const previewEl=previewId?document.getElementById(previewId):btn.nextElementSibling;
        btn.innerHTML=`<i class="fa-solid fa-spinner fa-spin"></i> Chargement...`;
        try{
          const { data, error } = await supabase.storage.from("deposit-proofs").createSignedUrl(path, 300);
          if(error) throw error;
          if(previewEl){
            const isPdf = path.toLowerCase().endsWith(".pdf");
            if(isPdf){
              previewEl.innerHTML=`<a href="${data.signedUrl}" target="_blank" class="btn-secondary"><i class="fa-solid fa-file-pdf"></i> Ouvrir PDF</a>`;
            } else {
              previewEl.innerHTML=`<a href="${data.signedUrl}" target="_blank"><img src="${data.signedUrl}" style="width:100%;max-width:300px;border-radius:8px;margin-top:8px" /></a>`;
            }
          }
        }catch(e){
          showToast("Erreur preuve: "+e.message,"error");
        }finally{
          btn.innerHTML=`<i class="fa-solid fa-eye"></i> Voir preuve`;
        }
      });
    });

  }catch(e){
    container.innerHTML=`<p class="empty" style="color:var(--danger)">Erreur: ${escapeHtml(e.message)}</p>`;
  }
}

// Upload preuve
$("#proofFile")?.addEventListener("change", async function(){
  const file=this.files[0];
  const preview=$("#proofPreview");
  if(!file){ preview.classList.add("hidden"); preview.innerHTML=""; return; }
  if(file.size>10*1024*1024){ showToast("Fichier trop volumineux (max 10MB)","error"); this.value=""; return; }
  const reader=new FileReader();
  reader.onload=()=>{
    if(file.type==="application/pdf"){
      preview.innerHTML=`<p><i class="fa-solid fa-file-pdf" style="color:var(--danger)"></i> PDF prêt: ${escapeHtml(file.name)} (${(file.size/1024).toFixed(0)} KB)</p>`;
    } else {
      preview.innerHTML=`<img src="${reader.result}" style="width:100%;max-height:220px;object-fit:contain;border-radius:8px" /><p style="font-size:0.8rem;color:var(--muted);margin-top:6px">Photo prête - sera vérifiée par admin</p>`;
    }
    preview.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
});

// Soumission dépôt - NE PAS créditer immédiatement
$("#depositForm")?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  const user = await refreshAuth();
  if(!user) return;

  const amount = Number($("#amount").value);
  const paymentMethod = $("#paymentMethod").value.trim();
  const transactionRef = $("#transactionRef").value.trim();
  const file = $("#proofFile").files[0];

  if(!amount || amount<=0){ showToast("Montant invalide","error"); return; }
  if(!paymentMethod){ showToast("Méthode requise","error"); return; }
  if(!transactionRef || transactionRef.length<3){ showToast("Référence requise (min 3 chars)","error"); return; }

  const btn=e.target.querySelector('button[type="submit"]');
  const orig=btn.innerHTML;
  btn.disabled=true;
  btn.innerHTML=`<i class="fa-solid fa-spinner fa-spin"></i> Envoi...`;
  const msgEl=$("#depositMessage");
  if(msgEl){ msgEl.textContent=""; msgEl.className="message"; }

  try{
    let proofUrl = null;
    if(file){
      const ext=(file.name.split(".").pop()||"jpg").toLowerCase();
      const path=`${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("deposit-proofs").upload(path, file, { upsert:false, contentType:file.type });
      if(upErr) throw upErr;
      proofUrl = path;
    }

    // Crée demande avec status pending - NE PAS créditer solde
    const { data, error } = await supabase.from("deposit_requests").insert({
      user_id: user.id,
      amount,
      payment_method: paymentMethod,
      transaction_reference: transactionRef,
      proof_url: proofUrl,
      status: "pending"
    }).select().single();

    if(error){
      // Si duplicate reference
      if(error.message.includes("duplicate") || error.message.includes("unique")){
        throw new Error("Référence déjà utilisée - chaque transaction doit avoir une référence unique");
      }
      throw error;
    }

    if(msgEl){
      msgEl.textContent="✅ Votre demande a été envoyée. Votre solde sera crédité après validation par un administrateur.";
      msgEl.className="message success";
    }
    showToast("Demande envoyée - solde crédité après validation admin","success",6000);
    e.target.reset();
    $("#proofPreview").classList.add("hidden");
    $("#proofPreview").innerHTML="";
    await loadHistory();
  }catch(err){
    if(msgEl){
      msgEl.textContent=`❌ ${err.message}`;
      msgEl.className="message error";
    }
    showToast(err.message||"Erreur envoi","error");
  }finally{
    btn.disabled=false;
    btn.innerHTML=orig;
  }
});

// Init
(async ()=>{
  const user = await refreshAuth();
  if(!user) return;
  await loadBalance();
  await loadHistory();
  // Refresh balance via RPC
  supabase.auth.onAuthStateChange(async ()=>{
    await loadBalance();
    await loadHistory();
  });
})();
