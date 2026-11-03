// Se la pagina viene incorniciata da un altro sito (clickjacking), nasconde tutto e si ferma.
if (window.top !== window.self) { document.documentElement.style.display = "none"; throw new Error("pagina incorniciata"); }

const API = "https://steep-haze-2da0.cloudflare-vbmev.workers.dev";
const $ = (id) => document.getElementById(id);

// Il telefono ricorda solo un "gettone" di sessione (12 ore), mai la password.
const saved = {
  get() { try { return localStorage.getItem("adminToken") || ""; } catch { return ""; } },
  set(v) { try { localStorage.setItem("adminToken", v); } catch {} },
  clear() { try { localStorage.removeItem("adminToken"); } catch {} }
};
let token = saved.get();
let pendingCode = ""; // codice arrivato dal QR (#CODICE)
try { pendingCode = decodeURIComponent(location.hash.slice(1)); } catch {}

const api = (path, body) => fetch(API + path, {
  method: body ? "POST" : "GET",
  headers: Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}),
  body: body ? JSON.stringify(body) : undefined });
const show = (el, cls, text) => { el.innerHTML = '<p class="msg ' + cls + '"></p>'; el.firstChild.textContent = text; };
const forget = () => { token = ""; saved.clear(); };
const clearHash = () => { pendingCode = ""; history.replaceState(null, "", location.pathname + location.search); };

function showCode(el, d, asAdmin) {
  if (d.status === "valid")
    show(el, "ok", asAdmin ? "Codice valido (" + d.code + "). Ora è segnato come usato." : "Codice valido: non ancora utilizzato.");
  else if (d.status === "used")
    show(el, "ko", "Codice già utilizzato il " + new Date(d.used).toLocaleString("it-IT") + ".");
  else show(el, "ko", "Codice non valido.");
}

// Testo da mostrare quando il server rifiuta l'accesso (password errata o blocco temporaneo)
async function denied(r) {
  const d = await r.json().catch(() => ({}));
  const min = Math.max(1, Math.ceil((d.retryAfter || 0) / 60));
  if (r.status === 429) return "Troppi tentativi errati: accesso bloccato. Riprova tra circa " + min + " minuti.";
  if (d.left === 0) return "Password errata. Accesso bloccato per circa " + min + " minuti.";
  return "Password errata. Tentativi rimasti: " + d.left + ".";
}

// Chi non e' collegato vede solo lo stato del codice, senza consumarlo
async function publicStatus() {
  $("status").hidden = false;
  try { showCode($("statusMsg"), await (await api("/api/status", { code: pendingCode })).json(), false); }
  catch { show($("statusMsg"), "ko", "Server non raggiungibile."); }
}

function showLogin(msg) {
  $("panel").hidden = true; $("login").hidden = false;
  if (msg) show($("loginMsg"), "ko", msg);
  if (pendingCode) publicStatus();
}

async function verify(code) {
  try {
    const r = await api("/api/admin/verify", { code });
    if (r.status === 401) { forget(); pendingCode = code; return showLogin("Sessione scaduta: accedi di nuovo."); }
    showCode($("res"), await r.json(), true);
  } catch { show($("res"), "ko", "Server non raggiungibile."); }
}

function enterPanel() {
  $("login").hidden = true; $("status").hidden = true; $("panel").hidden = false;
  if (pendingCode) { // scansione del QR da un telefono collegato: convalida subito
    const c = pendingCode; $("code").value = c; clearHash(); verify(c);
  }
}

$("enter").onclick = async () => {
  try {
    const r = await api("/api/admin/login", { password: $("pw").value });
    if (!r.ok) return show($("loginMsg"), "ko", await denied(r));
    token = (await r.json()).token; saved.set(token); $("pw").value = "";
    enterPanel();
  } catch { show($("loginMsg"), "ko", "Server non raggiungibile."); }
};
$("pw").onkeydown = (e) => { if (e.key === "Enter") $("enter").click(); };
$("check").onclick = () => verify($("code").value);
$("code").onkeydown = (e) => { if (e.key === "Enter") $("check").click(); };
// Uscita: il gettone va invalidato SUL SERVER. Se il server non risponde non lo cancello in silenzio.
let logoutFailed = false;
$("logout").onclick = async () => {
  {
    try {
      const r = await api("/api/admin/logout", {});
      if (!r.ok) throw new Error("logout");
    } catch {
      if (logoutFailed) { /* secondo tentativo fallito: esco solo in locale */ } else {
      logoutFailed = true;
      $("logout").textContent = "Esci comunque";
      show($("res"), "ko", "Non sono riuscito a chiudere la sessione sul server (connessione assente?). Riprova. Se premi di nuovo, esci solo da questo telefono e la sessione scade da sola entro 12 ore.");
      return;
      }
    }
  }
  forget(); location.reload();
};

// Se la pagina e' gia' aperta e scansioni un altro QR, il nuovo codice arriva solo nell'indirizzo: ricarico.
window.addEventListener("hashchange", () => { if (location.hash.length > 1) location.reload(); });

(async () => {
  if (token) {
    try {
      const d = await (await api("/api/session")).json();
      if (d.ok) return enterPanel();
      forget(); // sessione scaduta o chiusa
    } catch { /* server non raggiungibile: tengo il gettone */ }
  }
  showLogin();
})();
