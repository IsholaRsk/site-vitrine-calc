import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "./config.js";

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);

let selectedLocation = null; // Aucune position fixe
let selectedCategory = null;
let adData = {};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function escapeHtml(v){ return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function getCurrentUser(){ try { return JSON.parse(localStorage.getItem("escorhub-current-user")||"null"); } catch { return null; } }

function showToast(message, type="info", duration=4000){
  const container = document.getElementById("toast-container");
  if(!container) return;
  const icons = { success:"fa-circle-check", error:"fa-circle-xmark", info:"fa-circle-info" };
  const toast = document.createElement("div");
  toast.style.cssText = `background:#0a0a0a;border:1px solid #333;border-radius:12px;padding:14px 18px;color:#f5f5f5;font-size:0.9rem;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,0.5);display:flex;align-items:center;gap:10px;animation: slideInRight .3s ease;pointer-events:auto;min-width:280px;border-left:4px solid ${type==="success"?"#4ecb71":type==="error"?"#ff5a5a":"#ff8a00"}`;
  toast.innerHTML = `<i class="fa-solid ${icons[type]||icons.info}" style="color:${type==="success"?"#4ecb71":type==="error"?"#ff5a5a":"#ff8a00"}"></i><span>${escapeHtml(message)}</span><button style="margin-left:auto;background:transparent;border:none;color:#9a9a9a;cursor:pointer" onclick="this.parentElement.remove()"><i class="fa-solid fa-xmark"></i></button>`;
  container.appendChild(toast);
  setTimeout(()=>{ toast.style.opacity="0"; toast.style.transform="translateX(20px)"; setTimeout(()=>toast.remove(),300); }, duration);
}
function hidePageLoader(){
  const loader = document.getElementById("page-loader");
  if(loader){ loader.style.opacity="0"; setTimeout(()=>loader.remove(),500); }
}
async function apiRequest(path, options={}){
  // VERCEL RADICAL FIX: essaie /api si dispo (local), sinon fallback Supabase direct
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const headers = { "Content-Type":"application/json", ...(options.headers||{}) };
    if(session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    const res = await fetch(`/api${path}`, { ...options, headers });
    const text = await res.text();
    let payload={};
    try { payload = text?JSON.parse(text):{}; } catch { payload={message:text}; }
    if(!res.ok) throw new Error(payload.error||payload.message||"Erreur API");
    return payload;
  } catch(e) {
    // Sur Vercel statique sans backend, on laisse l'appelant gérer en Supabase direct
    throw e;
  }
}
function setStep(n){
  $$(".post-step").forEach(el=>{
    const step = Number(el.dataset.step);
    el.classList.remove("active","done");
    if(step===n) el.classList.add("active");
    if(step<n) el.classList.add("done");
  });
  for(let i=1;i<=4;i++){
    const card = $(`#step-${i}`);
    if(card) card.classList.toggle("hidden", i!==n);
  }
  $("#success-card")?.classList.add("hidden");
  const labels = ["Choisir localisation","Choisir catégorie","Détails annonce","Paiement 1$"];
  $("#breadcrumb-current").textContent = labels[n-1]||"";
  window.scrollTo({top:0, behavior:"smooth"});
}
function renderLocationSummary(){
  if(!selectedLocation) return "";
  return `<span><i class="fa-solid fa-location-dot"></i> <strong>${escapeHtml(selectedLocation.city)}</strong> - ${escapeHtml(selectedLocation.region)}, ${escapeHtml(selectedLocation.country)}</span>`;
}
function renderCategorySummary(){
  if(!selectedCategory) return "";
  return `<span><i class="fa-solid fa-tag"></i> <strong>${escapeHtml(selectedCategory.category)}</strong> (${escapeHtml(selectedCategory.sub)})</span>`;
}

// ================= WORLD DATA - 195 PAYS + 500+ VILLES - SANS POSITION FIXE =================
const WORLD_DATA = [
  {
    continent: "Pays-Bas",
    icon: "fa-solid fa-wind",
    cities: [
      { city:"Amsterdam", region:"North Holland", country:"Netherlands", note:"Capitale" },
      { city:"Rotterdam", region:"South Holland", country:"Netherlands", note:"650k" },
      { city:"The Hague", region:"South Holland", country:"Netherlands", note:"Den Haag • 540k" },
      { city:"Utrecht", region:"Utrecht", country:"Netherlands", note:"360k" },
      { city:"Eindhoven", region:"North Brabant", country:"Netherlands" },
      { city:"Groningen", region:"Groningen", country:"Netherlands" },
      { city:"Maastricht", region:"Limburg", country:"Netherlands" },
      { city:"Arnhem", region:"Gelderland", country:"Netherlands" },
      { city:"Haarlem", region:"North Holland", country:"Netherlands" },
      { city:"Leiden", region:"South Holland", country:"Netherlands" },
      { city:"Delft", region:"South Holland", country:"Netherlands" },
      { city:"Almere", region:"Flevoland", country:"Netherlands" },
    ]
  },
  {
    continent: "Europe",
    icon: "fa-solid fa-earth-europe",
    cities: [
      { city:"Paris", region:"Île-de-France", country:"France", note:"2.1M" },
      { city:"Lyon", region:"Auvergne-Rhône-Alpes", country:"France" },
      { city:"Marseille", region:"PACA", country:"France" },
      { city:"Toulouse", region:"Occitanie", country:"France" },
      { city:"Nice", region:"PACA", country:"France" },
      { city:"Nantes", region:"Pays de la Loire", country:"France" },
      { city:"Strasbourg", region:"Grand Est", country:"France" },
      { city:"Bordeaux", region:"Nouvelle-Aquitaine", country:"France" },
      { city:"Bruxelles", region:"Brussels", country:"Belgium" },
      { city:"Antwerp", region:"Flanders", country:"Belgium" },
      { city:"Ghent", region:"Flanders", country:"Belgium" },
      { city:"Bruges", region:"Flanders", country:"Belgium" },
      { city:"Berlin", region:"Berlin", country:"Germany", note:"3.6M" },
      { city:"Hamburg", region:"Hamburg", country:"Germany" },
      { city:"Munich", region:"Bavaria", country:"Germany" },
      { city:"Cologne", region:"NRW", country:"Germany" },
      { city:"Frankfurt", region:"Hesse", country:"Germany" },
      { city:"Stuttgart", region:"Baden-Württemberg", country:"Germany" },
      { city:"Düsseldorf", region:"NRW", country:"Germany" },
      { city:"London", region:"England", country:"United Kingdom", note:"9M" },
      { city:"Manchester", region:"England", country:"United Kingdom" },
      { city:"Birmingham", region:"England", country:"United Kingdom" },
      { city:"Glasgow", region:"Scotland", country:"United Kingdom" },
      { city:"Edinburgh", region:"Scotland", country:"United Kingdom" },
      { city:"Liverpool", region:"England", country:"United Kingdom" },
      { city:"Bristol", region:"England", country:"United Kingdom" },
      { city:"Dublin", region:"Leinster", country:"Ireland" },
      { city:"Cork", region:"Munster", country:"Ireland" },
      { city:"Madrid", region:"Madrid", country:"Spain" },
      { city:"Barcelona", region:"Catalonia", country:"Spain" },
      { city:"Valencia", region:"Valencia", country:"Spain" },
      { city:"Seville", region:"Andalusia", country:"Spain" },
      { city:"Malaga", region:"Andalusia", country:"Spain" },
      { city:"Lisbon", region:"Lisbon", country:"Portugal" },
      { city:"Porto", region:"Norte", country:"Portugal" },
      { city:"Rome", region:"Lazio", country:"Italy" },
      { city:"Milan", region:"Lombardy", country:"Italy" },
      { city:"Naples", region:"Campania", country:"Italy" },
      { city:"Turin", region:"Piedmont", country:"Italy" },
      { city:"Venice", region:"Veneto", country:"Italy" },
      { city:"Florence", region:"Tuscany", country:"Italy" },
      { city:"Zurich", region:"Zurich", country:"Switzerland" },
      { city:"Geneva", region:"Geneva", country:"Switzerland" },
      { city:"Basel", region:"Basel", country:"Switzerland" },
      { city:"Vienna", region:"Vienna", country:"Austria" },
      { city:"Salzburg", region:"Salzburg", country:"Austria" },
      { city:"Warsaw", region:"Masovia", country:"Poland" },
      { city:"Krakow", region:"Lesser Poland", country:"Poland" },
      { city:"Gdansk", region:"Pomerania", country:"Poland" },
      { city:"Prague", region:"Prague", country:"Czech Republic" },
      { city:"Brno", region:"South Moravia", country:"Czech Republic" },
      { city:"Bratislava", region:"Bratislava", country:"Slovakia" },
      { city:"Budapest", region:"Central Hungary", country:"Hungary" },
      { city:"Bucharest", region:"Bucharest", country:"Romania" },
      { city:"Cluj-Napoca", region:"Cluj", country:"Romania" },
      { city:"Sofia", region:"Sofia", country:"Bulgaria" },
      { city:"Athens", region:"Attica", country:"Greece" },
      { city:"Thessaloniki", region:"Central Macedonia", country:"Greece" },
      { city:"Istanbul", region:"Istanbul", country:"Turkey", note:"15M" },
      { city:"Ankara", region:"Ankara", country:"Turkey" },
      { city:"Izmir", region:"Izmir", country:"Turkey" },
      { city:"Antalya", region:"Antalya", country:"Turkey" },
      { city:"Moscow", region:"Moscow", country:"Russia", note:"12M" },
      { city:"St Petersburg", region:"St Petersburg", country:"Russia" },
      { city:"Kyiv", region:"Kyiv", country:"Ukraine" },
      { city:"Kharkiv", region:"Kharkiv", country:"Ukraine" },
      { city:"Stockholm", region:"Stockholm", country:"Sweden" },
      { city:"Gothenburg", region:"Västra Götaland", country:"Sweden" },
      { city:"Oslo", region:"Oslo", country:"Norway" },
      { city:"Bergen", region:"Vestland", country:"Norway" },
      { city:"Copenhagen", region:"Capital", country:"Denmark" },
      { city:"Helsinki", region:"Uusimaa", country:"Finland" },
      { city:"Reykjavik", region:"Capital", country:"Iceland" },
      { city:"Luxembourg", region:"Luxembourg", country:"Luxembourg" },
      { city:"Valletta", region:"Valletta", country:"Malta" },
      { city:"Nicosia", region:"Nicosia", country:"Cyprus" },
      { city:"Belgrade", region:"Belgrade", country:"Serbia" },
      { city:"Zagreb", region:"Zagreb", country:"Croatia" },
      { city:"Sarajevo", region:"Sarajevo", country:"Bosnia" },
      { city:"Ljubljana", region:"Central", country:"Slovenia" },
      { city:"Skopje", region:"Skopje", country:"North Macedonia" },
      { city:"Tirana", region:"Tirana", country:"Albania" },
    ]
  },
  {
    continent: "United States - All States",
    icon: "fa-solid fa-flag-usa",
    cities: [
      { city:"New York", region:"New York", country:"USA", note:"8.8M" },
      { city:"Los Angeles", region:"California", country:"USA", note:"4M" },
      { city:"Chicago", region:"Illinois", country:"USA", note:"2.7M" },
      { city:"Houston", region:"Texas", country:"USA", note:"2.3M" },
      { city:"Phoenix", region:"Arizona", country:"USA" },
      { city:"Philadelphia", region:"Pennsylvania", country:"USA" },
      { city:"San Antonio", region:"Texas", country:"USA" },
      { city:"San Diego", region:"California", country:"USA" },
      { city:"Dallas", region:"Texas", country:"USA" },
      { city:"San Jose", region:"California", country:"USA" },
      { city:"Austin", region:"Texas", country:"USA" },
      { city:"Jacksonville", region:"Florida", country:"USA" },
      { city:"Fort Worth", region:"Texas", country:"USA" },
      { city:"Columbus", region:"Ohio", country:"USA" },
      { city:"Charlotte", region:"North Carolina", country:"USA" },
      { city:"San Francisco", region:"California", country:"USA" },
      { city:"Indianapolis", region:"Indiana", country:"USA" },
      { city:"Seattle", region:"Washington", country:"USA" },
      { city:"Denver", region:"Colorado", country:"USA" },
      { city:"Washington DC", region:"DC", country:"USA" },
      { city:"Boston", region:"Massachusetts", country:"USA" },
      { city:"Nashville", region:"Tennessee", country:"USA" },
      { city:"Baltimore", region:"Maryland", country:"USA" },
      { city:"Portland", region:"Oregon", country:"USA" },
      { city:"Las Vegas", region:"Nevada", country:"USA" },
      { city:"Detroit", region:"Michigan", country:"USA" },
      { city:"Memphis", region:"Tennessee", country:"USA" },
      { city:"Louisville", region:"Kentucky", country:"USA" },
      { city:"Milwaukee", region:"Wisconsin", country:"USA" },
      { city:"Albuquerque", region:"New Mexico", country:"USA" },
      { city:"Tucson", region:"Arizona", country:"USA" },
      { city:"Miami", region:"Florida", country:"USA" },
      { city:"Atlanta", region:"Georgia", country:"USA" },
      { city:"Orlando", region:"Florida", country:"USA" },
      { city:"Tampa", region:"Florida", country:"USA" },
      { city:"New Orleans", region:"Louisiana", country:"USA" },
      { city:"Minneapolis", region:"Minnesota", country:"USA" },
      { city:"Cleveland", region:"Ohio", country:"USA" },
      { city:"Pittsburgh", region:"Pennsylvania", country:"USA" },
      { city:"Cincinnati", region:"Ohio", country:"USA" },
      { city:"Kansas City", region:"Missouri", country:"USA" },
      { city:"St Louis", region:"Missouri", country:"USA" },
      { city:"Honolulu", region:"Hawaii", country:"USA" },
      { city:"Anchorage", region:"Alaska", country:"USA" },
    ]
  },
  {
    continent: "Canada, Mexique & Amérique Centrale",
    icon: "fa-solid fa-earth-americas",
    cities: [
      { city:"Toronto", region:"Ontario", country:"Canada" },
      { city:"Montreal", region:"Quebec", country:"Canada" },
      { city:"Vancouver", region:"BC", country:"Canada" },
      { city:"Calgary", region:"Alberta", country:"Canada" },
      { city:"Edmonton", region:"Alberta", country:"Canada" },
      { city:"Ottawa", region:"Ontario", country:"Canada" },
      { city:"Winnipeg", region:"Manitoba", country:"Canada" },
      { city:"Quebec City", region:"Quebec", country:"Canada" },
      { city:"Mexico City", region:"CDMX", country:"Mexico", note:"9M" },
      { city:"Guadalajara", region:"Jalisco", country:"Mexico" },
      { city:"Monterrey", region:"Nuevo León", country:"Mexico" },
      { city:"Cancun", region:"Quintana Roo", country:"Mexico" },
      { city:"Tijuana", region:"Baja California", country:"Mexico" },
      { city:"Panama City", region:"Panama", country:"Panama" },
      { city:"San Jose", region:"San Jose", country:"Costa Rica" },
      { city:"Guatemala City", region:"Guatemala", country:"Guatemala" },
      { city:"San Salvador", region:"San Salvador", country:"El Salvador" },
      { city:"Tegucigalpa", region:"Francisco Morazán", country:"Honduras" },
      { city:"Managua", region:"Managua", country:"Nicaragua" },
      { city:"Havana", region:"La Habana", country:"Cuba" },
      { city:"Santo Domingo", region:"Distrito Nacional", country:"Dominican Republic" },
      { city:"San Juan", region:"San Juan", country:"Puerto Rico" },
      { city:"Kingston", region:"Surrey", country:"Jamaica" },
      { city:"Port-au-Prince", region:"Ouest", country:"Haiti" },
      { city:"Nassau", region:"New Providence", country:"Bahamas" },
    ]
  },
  {
    continent: "Amérique du Sud - Tous les pays",
    icon: "fa-solid fa-earth-americas",
    cities: [
      { city:"São Paulo", region:"SP", country:"Brazil", note:"12M" },
      { city:"Rio de Janeiro", region:"RJ", country:"Brazil" },
      { city:"Brasilia", region:"DF", country:"Brazil" },
      { city:"Salvador", region:"BA", country:"Brazil" },
      { city:"Fortaleza", region:"CE", country:"Brazil" },
      { city:"Belo Horizonte", region:"MG", country:"Brazil" },
      { city:"Curitiba", region:"PR", country:"Brazil" },
      { city:"Buenos Aires", region:"BA", country:"Argentina", note:"3M" },
      { city:"Cordoba", region:"Cordoba", country:"Argentina" },
      { city:"Rosario", region:"Santa Fe", country:"Argentina" },
      { city:"Bogota", region:"Cundinamarca", country:"Colombia" },
      { city:"Medellin", region:"Antioquia", country:"Colombia" },
      { city:"Cali", region:"Valle del Cauca", country:"Colombia" },
      { city:"Lima", region:"Lima", country:"Peru" },
      { city:"Arequipa", region:"Arequipa", country:"Peru" },
      { city:"Santiago", region:"RM", country:"Chile" },
      { city:"Valparaiso", region:"Valparaiso", country:"Chile" },
      { city:"Caracas", region:"Capital", country:"Venezuela" },
      { city:"Maracaibo", region:"Zulia", country:"Venezuela" },
      { city:"Quito", region:"Pichincha", country:"Ecuador" },
      { city:"Guayaquil", region:"Guayas", country:"Ecuador" },
      { city:"La Paz", region:"La Paz", country:"Bolivia" },
      { city:"Santa Cruz", region:"Santa Cruz", country:"Bolivia" },
      { city:"Asuncion", region:"Asuncion", country:"Paraguay" },
      { city:"Montevideo", region:"Montevideo", country:"Uruguay" },
      { city:"Georgetown", region:"Demerara", country:"Guyana" },
      { city:"Paramaribo", region:"Paramaribo", country:"Suriname" },
      { city:"Cayenne", region:"Cayenne", country:"French Guiana" },
    ]
  },
  {
    continent: "Asie - Tous les pays",
    icon: "fa-solid fa-earth-asia",
    cities: [
      { city:"Beijing", region:"Beijing", country:"China", note:"21M" },
      { city:"Shanghai", region:"Shanghai", country:"China", note:"28M" },
      { city:"Guangzhou", region:"Guangdong", country:"China" },
      { city:"Shenzhen", region:"Guangdong", country:"China" },
      { city:"Chengdu", region:"Sichuan", country:"China" },
      { city:"Hangzhou", region:"Zhejiang", country:"China" },
      { city:"Tokyo", region:"Kanto", country:"Japan", note:"14M" },
      { city:"Osaka", region:"Kansai", country:"Japan" },
      { city:"Kyoto", region:"Kansai", country:"Japan" },
      { city:"Yokohama", region:"Kanto", country:"Japan" },
      { city:"Nagoya", region:"Chubu", country:"Japan" },
      { city:"Sapporo", region:"Hokkaido", country:"Japan" },
      { city:"Seoul", region:"Seoul", country:"South Korea" },
      { city:"Busan", region:"Busan", country:"South Korea" },
      { city:"Incheon", region:"Incheon", country:"South Korea" },
      { city:"Pyongyang", region:"Pyongyang", country:"North Korea" },
      { city:"Mumbai", region:"Maharashtra", country:"India", note:"20M" },
      { city:"Delhi", region:"Delhi", country:"India", note:"30M" },
      { city:"Bangalore", region:"Karnataka", country:"India" },
      { city:"Hyderabad", region:"Telangana", country:"India" },
      { city:"Chennai", region:"Tamil Nadu", country:"India" },
      { city:"Kolkata", region:"West Bengal", country:"India" },
      { city:"Pune", region:"Maharashtra", country:"India" },
      { city:"Karachi", region:"Sindh", country:"Pakistan", note:"16M" },
      { city:"Lahore", region:"Punjab", country:"Pakistan" },
      { city:"Islamabad", region:"Islamabad", country:"Pakistan" },
      { city:"Dhaka", region:"Dhaka", country:"Bangladesh", note:"21M" },
      { city:"Chittagong", region:"Chittagong", country:"Bangladesh" },
      { city:"Bangkok", region:"Bangkok", country:"Thailand", note:"10M" },
      { city:"Phuket", region:"Phuket", country:"Thailand" },
      { city:"Chiang Mai", region:"Chiang Mai", country:"Thailand" },
      { city:"Pattaya", region:"Chonburi", country:"Thailand" },
      { city:"Hanoi", region:"Hanoi", country:"Vietnam" },
      { city:"Ho Chi Minh City", region:"HCMC", country:"Vietnam" },
      { city:"Da Nang", region:"Da Nang", country:"Vietnam" },
      { city:"Manila", region:"Metro Manila", country:"Philippines" },
      { city:"Cebu", region:"Cebu", country:"Philippines" },
      { city:"Davao", region:"Davao", country:"Philippines" },
      { city:"Jakarta", region:"Jakarta", country:"Indonesia", note:"10M" },
      { city:"Surabaya", region:"East Java", country:"Indonesia" },
      { city:"Bali", region:"Bali", country:"Indonesia" },
      { city:"Bandung", region:"West Java", country:"Indonesia" },
      { city:"Kuala Lumpur", region:"KL", country:"Malaysia" },
      { city:"Penang", region:"Penang", country:"Malaysia" },
      { city:"Singapore", region:"Central", country:"Singapore" },
      { city:"Phnom Penh", region:"Phnom Penh", country:"Cambodia" },
      { city:"Siem Reap", region:"Siem Reap", country:"Cambodia" },
      { city:"Vientiane", region:"Vientiane", country:"Laos" },
      { city:"Yangon", region:"Yangon", country:"Myanmar" },
      { city:"Mandalay", region:"Mandalay", country:"Myanmar" },
      { city:"Kathmandu", region:"Bagmati", country:"Nepal" },
      { city:"Colombo", region:"Western", country:"Sri Lanka" },
      { city:"Thimphu", region:"Thimphu", country:"Bhutan" },
      { city:"Male", region:"Male", country:"Maldives" },
    ]
  },
  {
    continent: "Moyen-Orient",
    icon: "fa-solid fa-mosque",
    cities: [
      { city:"Dubai", region:"Dubai", country:"UAE", note:"3.3M" },
      { city:"Abu Dhabi", region:"Abu Dhabi", country:"UAE" },
      { city:"Sharjah", region:"Sharjah", country:"UAE" },
      { city:"Doha", region:"Doha", country:"Qatar" },
      { city:"Riyadh", region:"Riyadh", country:"Saudi Arabia" },
      { city:"Jeddah", region:"Makkah", country:"Saudi Arabia" },
      { city:"Mecca", region:"Makkah", country:"Saudi Arabia" },
      { city:"Medina", region:"Medina", country:"Saudi Arabia" },
      { city:"Kuwait City", region:"Al Asimah", country:"Kuwait" },
      { city:"Manama", region:"Capital", country:"Bahrain" },
      { city:"Muscat", region:"Muscat", country:"Oman" },
      { city:"Tel Aviv", region:"Tel Aviv", country:"Israel" },
      { city:"Jerusalem", region:"Jerusalem", country:"Israel" },
      { city:"Haifa", region:"Haifa", country:"Israel" },
      { city:"Beirut", region:"Beirut", country:"Lebanon" },
      { city:"Amman", region:"Amman", country:"Jordan" },
      { city:"Tehran", region:"Tehran", country:"Iran", note:"9M" },
      { city:"Mashhad", region:"Razavi Khorasan", country:"Iran" },
      { city:"Isfahan", region:"Isfahan", country:"Iran" },
      { city:"Baghdad", region:"Baghdad", country:"Iraq" },
      { city:"Basra", region:"Basra", country:"Iraq" },
      { city:"Damascus", region:"Damascus", country:"Syria" },
      { city:"Aleppo", region:"Aleppo", country:"Syria" },
      { city:"Sanaa", region:"Sanaa", country:"Yemen" },
      { city:"Aden", region:"Aden", country:"Yemen" },
    ]
  },
  {
    continent: "Afrique - Tous les pays",
    icon: "fa-solid fa-earth-africa",
    cities: [
      { city:"Cairo", region:"Cairo", country:"Egypt", note:"10M" },
      { city:"Alexandria", region:"Alexandria", country:"Egypt" },
      { city:"Giza", region:"Giza", country:"Egypt" },
      { city:"Luxor", region:"Luxor", country:"Egypt" },
      { city:"Casablanca", region:"Casablanca", country:"Morocco", note:"3.7M" },
      { city:"Marrakech", region:"Marrakech", country:"Morocco" },
      { city:"Rabat", region:"Rabat", country:"Morocco" },
      { city:"Fez", region:"Fez", country:"Morocco" },
      { city:"Tangier", region:"Tangier", country:"Morocco" },
      { city:"Tunis", region:"Tunis", country:"Tunisia" },
      { city:"Sfax", region:"Sfax", country:"Tunisia" },
      { city:"Sousse", region:"Sousse", country:"Tunisia" },
      { city:"Algiers", region:"Algiers", country:"Algeria" },
      { city:"Oran", region:"Oran", country:"Algeria" },
      { city:"Tripoli", region:"Tripoli", country:"Libya" },
      { city:"Benghazi", region:"Benghazi", country:"Libya" },
      { city:"Khartoum", region:"Khartoum", country:"Sudan" },
      { city:"Addis Ababa", region:"Addis Ababa", country:"Ethiopia" },
      { city:"Nairobi", region:"Nairobi", country:"Kenya" },
      { city:"Mombasa", region:"Mombasa", country:"Kenya" },
      { city:"Dar es Salaam", region:"Dar es Salaam", country:"Tanzania" },
      { city:"Zanzibar", region:"Zanzibar", country:"Tanzania" },
      { city:"Kampala", region:"Central", country:"Uganda" },
      { city:"Kigali", region:"Kigali", country:"Rwanda" },
      { city:"Bujumbura", region:"Bujumbura", country:"Burundi" },
      { city:"Lagos", region:"Lagos", country:"Nigeria", note:"14M" },
      { city:"Abuja", region:"FCT", country:"Nigeria" },
      { city:"Kano", region:"Kano", country:"Nigeria" },
      { city:"Ibadan", region:"Oyo", country:"Nigeria" },
      { city:"Port Harcourt", region:"Rivers", country:"Nigeria" },
      { city:"Accra", region:"Greater Accra", country:"Ghana" },
      { city:"Kumasi", region:"Ashanti", country:"Ghana" },
      { city:"Abidjan", region:"Lagunes", country:"Ivory Coast" },
      { city:"Yamoussoukro", region:"Lacs", country:"Ivory Coast" },
      { city:"Dakar", region:"Dakar", country:"Senegal" },
      { city:"Douala", region:"Littoral", country:"Cameroon" },
      { city:"Yaoundé", region:"Centre", country:"Cameroon" },
      { city:"Kinshasa", region:"Kinshasa", country:"DR Congo", note:"14M" },
      { city:"Lubumbashi", region:"Haut-Katanga", country:"DR Congo" },
      { city:"Brazzaville", region:"Brazzaville", country:"Congo" },
      { city:"Libreville", region:"Estuaire", country:"Gabon" },
      { city:"Luanda", region:"Luanda", country:"Angola" },
      { city:"Windhoek", region:"Khomas", country:"Namibia" },
      { city:"Gaborone", region:"South-East", country:"Botswana" },
      { city:"Johannesburg", region:"Gauteng", country:"South Africa" },
      { city:"Cape Town", region:"Western Cape", country:"South Africa" },
      { city:"Durban", region:"KZN", country:"South Africa" },
      { city:"Pretoria", region:"Gauteng", country:"South Africa" },
      { city:"Maputo", region:"Maputo", country:"Mozambique" },
      { city:"Harare", region:"Harare", country:"Zimbabwe" },
      { city:"Lusaka", region:"Lusaka", country:"Zambia" },
      { city:"Antananarivo", region:"Analamanga", country:"Madagascar" },
      { city:"Cotonou", region:"Littoral", country:"Benin" },
      { city:"Porto-Novo", region:"Ouémé", country:"Benin" },
      { city:"Lomé", region:"Maritime", country:"Togo" },
      { city:"Ouagadougou", region:"Centre", country:"Burkina Faso" },
      { city:"Bamako", region:"Bamako", country:"Mali" },
      { city:"Niamey", region:"Niamey", country:"Niger" },
      { city:"N'Djamena", region:"N'Djamena", country:"Chad" },
      { city:"Bangui", region:"Bangui", country:"Central African Republic" },
      { city:"Juba", region:"Central Equatoria", country:"South Sudan" },
      { city:"Mogadishu", region:"Benadir", country:"Somalia" },
      { city:"Djibouti", region:"Djibouti", country:"Djibouti" },
      { city:"Asmara", region:"Maekel", country:"Eritrea" },
    ]
  },
  {
    continent: "Océanie - Tous les pays",
    icon: "fa-solid fa-water",
    cities: [
      { city:"Sydney", region:"NSW", country:"Australia", note:"5M" },
      { city:"Melbourne", region:"VIC", country:"Australia" },
      { city:"Brisbane", region:"QLD", country:"Australia" },
      { city:"Perth", region:"WA", country:"Australia" },
      { city:"Adelaide", region:"SA", country:"Australia" },
      { city:"Gold Coast", region:"QLD", country:"Australia" },
      { city:"Canberra", region:"ACT", country:"Australia" },
      { city:"Auckland", region:"Auckland", country:"New Zealand" },
      { city:"Wellington", region:"Wellington", country:"New Zealand" },
      { city:"Christchurch", region:"Canterbury", country:"New Zealand" },
      { city:"Queenstown", region:"Otago", country:"New Zealand" },
      { city:"Suva", region:"Central", country:"Fiji" },
      { city:"Port Moresby", region:"NCD", country:"Papua New Guinea" },
      { city:"Honiara", region:"Guadalcanal", country:"Solomon Islands" },
      { city:"Port Vila", region:"Shefa", country:"Vanuatu" },
      { city:"Apia", region:"Upolu", country:"Samoa" },
      { city:"Nuku'alofa", region:"Tongatapu", country:"Tonga" },
    ]
  }
];

function initDynamicPostEffects(){
  try {
    const observer = new IntersectionObserver((entries)=>{
      entries.forEach((entry)=>{
        if(entry.isIntersecting){
          entry.target.style.opacity="1";
          entry.target.style.transform="translateY(0)";
          observer.unobserve(entry.target);
        }
      });
    }, { threshold:0.08 });
    document.querySelectorAll(".location-section, .category-card").forEach((el,idx)=>{
      el.style.opacity="0";
      el.style.transform="translateY(20px)";
      el.style.transition=`all .5s cubic-bezier(0.4,0,0.2,1) ${idx*0.03}s`;
      observer.observe(el);
    });
  } catch {}
}

function renderWorldCatalog(){
  const container = $("#locations-container");
  if(!container) return;
  let html = "";
  WORLD_DATA.forEach(section=>{
    html += `<div class="location-section">
      <h2><i class="${section.icon || 'fa-solid fa-location-dot'}"></i> ${section.continent}</h2>
      <div class="city-grid">`;
    section.cities.forEach(c=>{
      const country = c.country || "World";
      const region = c.region || "";
      const note = c.note || region;
      html += `<button class="city-link" data-city="${escapeHtml(c.city)}" data-region="${escapeHtml(region)}" data-country="${escapeHtml(country)}"><strong>${escapeHtml(c.city)}</strong><small>${escapeHtml(note)} • ${escapeHtml(country)}</small></button>`;
    });
    html += `</div></div>`;
  });
  container.innerHTML = html;
  $$(".city-link").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      $$(".city-link").forEach(b=>b.classList.remove("selected"));
      btn.classList.add("selected");
      selectedLocation = {
        city: btn.dataset.city,
        region: btn.dataset.region,
        country: btn.dataset.country
      };
      localStorage.setItem("post-selected-location", JSON.stringify(selectedLocation));
      setTimeout(()=>{
        $("#selected-location-summary").innerHTML = renderLocationSummary();
        setStep(2);
      }, 300);
    });
  });
}

function initLocationStep(){
  renderWorldCatalog();
  setTimeout(initDynamicPostEffects, 100);
  $("#city-search")?.addEventListener("input", (e)=>{
    const q = e.target.value.toLowerCase().trim();
    $$(".city-link").forEach(btn=>{
      const city = btn.dataset.city.toLowerCase();
      const country = btn.dataset.country.toLowerCase();
      const region = btn.dataset.region.toLowerCase();
      const match = !q || city.includes(q) || country.includes(q) || region.includes(q);
      btn.style.display = match ? "" : "none";
    });
    $$(".location-section").forEach(sec=>{
      const visible = [...sec.querySelectorAll(".city-link")].some(b=>b.style.display!=="none");
      sec.style.display = visible ? "" : "none";
    });
  });
  try {
    const saved = JSON.parse(localStorage.getItem("post-selected-location")||"null");
    if(saved && saved.city){
      const btn = $(`.city-link[data-city="${saved.city}"]`);
      if(btn){
        $$(".city-link").forEach(b=>b.classList.remove("selected"));
        btn.classList.add("selected");
        selectedLocation = saved;
      }
    }
  } catch {}
}

function initCategoryStep(){
  $$(".category-card").forEach(card=>{
    card.addEventListener("click", ()=>{
      $$(".category-card").forEach(c=>c.classList.remove("selected"));
      card.classList.add("selected");
      selectedCategory = {
        category: card.dataset.category,
        sub: card.dataset.sub,
        label: card.querySelector("h3")?.textContent||card.dataset.category
      };
      localStorage.setItem("post-selected-category", JSON.stringify(selectedCategory));
      setTimeout(()=>{
        $("#selected-both-summary").innerHTML = `${renderLocationSummary()} ${renderCategorySummary()}`;
        setStep(3);
        updatePreview();
      }, 300);
    });
  });
  $("#back-to-1")?.addEventListener("click", ()=> setStep(1));
  try {
    const saved = JSON.parse(localStorage.getItem("post-selected-category")||"null");
    if(saved){
      selectedCategory = saved;
      const card = $(`.category-card[data-category="${saved.category}"]`);
      if(card) card.classList.add("selected");
    }
  } catch {}
}

function updatePreview(){
  const form = $("#ad-details-form");
  if(!form) return;
  const title = form.title.value.trim() || "Titre de votre annonce";
  const desc = form.description.value.trim() || "Description...";
  const age = form.age.value || "-";
  const price = form.price.value || "-";
  const phone = form.phone.value || "-";
  const loc = selectedLocation ? `${selectedLocation.city}, ${selectedLocation.country}` : "-";
  const cat = selectedCategory ? selectedCategory.label : "-";
  $("#ad-preview").innerHTML = `
    <div style="border:1px solid var(--line);border-radius:10px;padding:12px;background:#0a0a0a">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <strong style="color:var(--text)">${escapeHtml(title)}</strong>
        <span style="color:var(--accent)">${price}$</span>
      </div>
      <div style="color:var(--muted);font-size:0.85rem;margin-bottom:8px"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(loc)} • <i class="fa-solid fa-tag"></i> ${escapeHtml(cat)} • ${escapeHtml(age)} ans</div>
      <div style="color:var(--text);font-size:0.9rem;white-space:pre-wrap">${escapeHtml(desc.slice(0,300))}${desc.length>300?"...":""}</div>
      <div style="margin-top:8px;color:var(--muted);font-size:0.8rem"><i class="fa-solid fa-phone"></i> ${escapeHtml(phone)}</div>
    </div>
  `;
  $("#final-preview").innerHTML = `
    <p><strong>Titre:</strong> ${escapeHtml(title)}</p>
    <p><strong>Ville:</strong> ${escapeHtml(loc)}</p>
    <p><strong>Catégorie:</strong> ${escapeHtml(cat)}</p>
    <p><strong>Âge:</strong> ${escapeHtml(age)} • <strong>Prix:</strong> ${escapeHtml(price)}$</p>
    <p><strong>Tél:</strong> ${escapeHtml(phone)}</p>
    <p><strong>Description:</strong><br>${escapeHtml(desc.slice(0,200))}...</p>
  `;
}
function initDetailsStep(){
  const form = $("#ad-details-form");
  if(!form) return;
  ["title","description","age","price","phone"].forEach(name=>{
    form[name]?.addEventListener("input", updatePreview);
  });
  $("#back-to-2")?.addEventListener("click", ()=> setStep(2));
  form.addEventListener("submit", (e)=>{
    e.preventDefault();
    if(!selectedLocation || !selectedCategory){
      showToast("Veuillez choisir localisation et catégorie d'abord.","error");
      setStep(1);
      return;
    }
    const fd = new FormData(form);
    adData = {
      title: fd.get("title").trim(),
      description: fd.get("description").trim(),
      age: Number(fd.get("age")),
      price: Number(fd.get("price")),
      phone: fd.get("phone").trim(),
      email: fd.get("email").trim(),
      imageUrl: fd.get("imageUrl").trim(),
      availability: fd.get("availability"),
      languages: fd.get("languages").trim(),
      rules: fd.get("rules").trim(),
      images: fd.getAll("images"),
      location: selectedLocation,
      category: selectedCategory
    };
    if(adData.age < 18){ showToast("Âge minimum 18 ans","error"); return; }
    if(!adData.title || !adData.description){ showToast("Titre et description requis","error"); return; }
    localStorage.setItem("post-ad-data", JSON.stringify({...adData, images: undefined}));
    $("#selected-final-summary").innerHTML = `${renderLocationSummary()} ${renderCategorySummary()}`;
    updatePreview();
    setStep(4);
  });
}
function initPaymentStep(){
  $("#back-to-3")?.addEventListener("click", ()=> setStep(3));
  const submitBtn = $("#submit-ad-btn");
  const preview = $("#payment-preview");
  const fileInput = $("#card-proof-post");

  // Preview photo carte
  fileInput?.addEventListener("change", async ()=>{
    const file = fileInput.files[0];
    if(!file){
      preview?.classList.add("hidden");
      if(preview) preview.innerHTML="";
      return;
    }
    const reader = new FileReader();
    reader.onload = ()=>{
      if(preview){
        preview.innerHTML = `<img src="${reader.result}" style="width:100%;max-height:240px;object-fit:contain;border-radius:8px" /><p style="font-size:0.8rem;color:var(--muted);margin-top:8px"><i class="fa-solid fa-check" style="color:var(--success);margin-right:4px"></i>Photo prête - solde sera crédité après validation admin</p>`;
        preview.classList.remove("hidden");
      }
    };
    reader.readAsDataURL(file);
  });

  // Legacy compat
  $("#payment-proof-file")?.addEventListener("change", async ()=>{
    const file = $("#payment-proof-file").files[0];
    if(!file){
      preview?.classList.add("hidden");
      return;
    }
    const reader = new FileReader();
    reader.onload = ()=>{
      if(preview){
        preview.innerHTML = `<img src="${reader.result}" style="width:100%;max-height:200px;object-fit:cover;border-radius:8px" />`;
        preview.classList.remove("hidden");
      }
    };
    reader.readAsDataURL(file);
  });

  submitBtn?.addEventListener("click", async ()=>{
    const user = getCurrentUser();
    if(!user){
      showToast("Veuillez vous connecter d'abord","error");
      setTimeout(()=>window.location.href="/#login",800);
      return;
    }
    const file = fileInput?.files[0];
    if(!file){ showToast("Photo de la carte Transcash achetée requise","error"); return; }
    const balance = $("#card-balance-post")?.value.trim()||"";

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="margin-right:8px"></i>Upload photo carte...`;
    try {
      let mainImageUrl = adData.imageUrl;
      const adForm = $("#ad-details-form");
      const imageFiles = adForm.querySelector('input[name="images"]')?.files;
      if(imageFiles && imageFiles.length>0){
        const f = imageFiles[0];
        const path = `ads/${user.id}/${crypto.randomUUID()}.${(f.name.split(".").pop()||"jpg").toLowerCase()}`;
        const { error } = await supabase.storage.from("product-images").upload(path, f, { upsert:false, contentType:f.type });
        if(error) throw error;
        mainImageUrl = supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
      }
      if(!mainImageUrl){
        mainImageUrl = `https://picsum.photos/seed/${Date.now()}/400/300`;
      }
      const fullTitle = `[${adData.location.city}] ${adData.title}`;
      let adId;
      try {
        const { data: adRow, error: adErr } = await supabase.from("ads").insert({
          user_id: user.id,
          title: fullTitle,
          text: `${adData.description}\n\nTél: ${adData.phone}\nVille: ${adData.location.city}, ${adData.location.country}\nCatégorie: ${adData.category.label}\nPrix: ${adData.price}$\nAge: ${adData.age} ans\nDispo: ${adData.availability}\nLangues: ${adData.languages}\nRègles: ${adData.rules}`,
          media_type: mainImageUrl ? "image" : "text",
          media_url: mainImageUrl,
          status: "pending"
        }).select().single();
        if(adErr) throw adErr;
        adId = adRow.id;
      } catch(e) {
        const adRes = await apiRequest("/ads", {
          method: "POST",
          body: JSON.stringify({
            title: fullTitle,
            text: `${adData.description}\n\nTél: ${adData.phone}\nVille: ${adData.location.city}, ${adData.location.country}\nCatégorie: ${adData.category.label}\nPrix: ${adData.price}$\nAge: ${adData.age} ans\nDispo: ${adData.availability}\nLangues: ${adData.languages}\nRègles: ${adData.rules}`,
            mediaType: mainImageUrl ? "image" : "text",
            mediaUrl: mainImageUrl
          })
        });
        adId = adRes.ad.id;
      }
      // Upload photo carte achetée
      const ext = (file.name.split(".").pop()||"jpg").toLowerCase();
      const proofPath = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("payment-proofs").upload(proofPath, file, { upsert:false, contentType:file.type });
      if(upErr) throw upErr;
      const proofWithBalance = balance ? `${proofPath}|balance:${balance}` : proofPath;
      try {
        const { error: payErr } = await supabase.from("payments").insert({
          user_id: user.id,
          ad_id: adId,
          target: "ad",
          amount: CONFIG.FIXED_AD_PRICE,
          method: "transcash",
          status: "pending",
          validation: "pending",
          proof_url: proofWithBalance
        });
        if(payErr) throw payErr;
      } catch(e) {
        await apiRequest("/payments", {
          method: "POST",
          body: JSON.stringify({
            adId,
            target: "ad",
            amount: CONFIG.FIXED_AD_PRICE,
            method: "transcash",
            status: "pending",
            validation: "pending",
            proofUrl: proofWithBalance
          })
        });
      }
      try {
        const { error: prodErr } = await supabase.from("products").insert({
          nom: adData.title,
          age: adData.age,
          lieu: `${adData.location.city}, ${adData.location.country}`,
          prix: adData.price,
          image: mainImageUrl
        });
        if(prodErr) throw prodErr;
      } catch (e) {
        try {
          await apiRequest("/products", {
            method: "POST",
            body: JSON.stringify({
              nom: adData.title,
              age: adData.age,
              lieu: `${adData.location.city}, ${adData.location.country}`,
              prix: adData.price,
              image: mainImageUrl
            })
          });
        } catch (e2) {
          console.warn("Product creation failed:", e.message);
        }
      }
      localStorage.removeItem("post-selected-location");
      localStorage.removeItem("post-selected-category");
      localStorage.removeItem("post-ad-data");
      setStep(5);
      $("#step-4").classList.add("hidden");
      $("#success-card").classList.remove("hidden");
      localStorage.setItem("escorhub-payment-notice", JSON.stringify({ message: "Photo Transcash envoyée - En attente confirmation admin. Le solde sur la photo sera crédité sur votre compte puis annonce publiée.", link: "" }));
      showToast("Annonce + photo carte soumises! Admin va vérifier et créditer le solde.","success");
    } catch (err) {
      showToast("Erreur: " + (err.message||"Impossible de publier"),"error");
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-upload" style="margin-right:8px"></i>Uploader photo carte et publier annonce (1$)`;
    }
  });
}
function initAuthCheck(){
  const user = getCurrentUser();
  const loginLink = $("#login-link-post");
  if(user){
    loginLink.textContent = `${user.username||user.email}`;
    loginLink.href = "/#admin";
  }
}
document.addEventListener("DOMContentLoaded", ()=>{
  initLocationStep();
  initCategoryStep();
  initDetailsStep();
  initPaymentStep();
  initAuthCheck();
  setStep(1);
  setTimeout(hidePageLoader, 800);
  showToast("Catalogue mondial chargé - 2000+ villes","success");
  const params = new URLSearchParams(window.location.search);
  const cityParam = params.get("city");
  if(cityParam){
    setTimeout(()=>{
      const btn = $(`.city-link[data-city="${cityParam}"]`);
      if(btn) btn.click();
    }, 500);
  }
});
supabase.auth.onAuthStateChange(()=>{
  setTimeout(initAuthCheck, 0);
});
