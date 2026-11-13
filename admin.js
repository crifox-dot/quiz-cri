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
// Sito in manutenzione (acceso dal pannello domande): il server rifiuta accesso e convalide, e qui
// si mostra solo l'avviso. Vale anche se la manutenzione inizia con la pagina gia' aperta.
function showMaintenance() {
  ["status", "login", "panel"].forEach((id) => { $(id).hidden = true; });
  clearInterval(clearTimer); clearTimeout(clearTimer);
  $("adminTitle").innerHTML = "Sito in <em>manutenzione</em>";
  $("maint").hidden = false;
}
// Risposta del server che dice "manutenzione": si mostra l'avviso e ci si ferma
async function inMaintenance(r) {
  if (r.status !== 503) return false;
  const d = await r.clone().json().catch(() => ({}));
  if (!d.maintenance) return false;
  showMaintenance();
  return true;
}
// grafica del sito scelta dall'editor (nuova o classica) e manutenzione: richiesta pubblica, senza password
const settings = fetch(API + "/api/grafica").then((r) => r.json()).then((d) => {
  if (window.setGrafica && d.grafica) window.setGrafica(d.grafica);
  if (window.setSticker && d.sticker) window.setSticker(d.sticker);
  return d;
}).catch(() => ({}));
// Modalita' classifica (decisa nel pannello domande): "ticketOn" = si convalidano i codici come sempre;
// "classifica" = nel pannello c'e' anche la classifica. Senza biglietto la convalida sparisce del tutto.
let classifica = false, ticketOn = true;
settings.then((d) => {
  classifica = d.classifica === true; ticketOn = d.ticket !== false;
  if (!ticketOn) $("loginLead").textContent = "Sei del Comitato? Accedi per vedere la classifica.";
});
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

// Chi non e' collegato puo' controllare lo stato del codice (senza consumarlo), ma solo
// premendo il pulsante: arrivando da un QR non si vede nulla finche' non lo si chiede.
$("statusCheck").onclick = async () => {
  $("statusCheck").disabled = true;
  try {
    const r = await api("/api/status", { code: pendingCode });
    if (await inMaintenance(r)) return;
    showCode($("statusMsg"), await r.json(), false);
  }
  catch { show($("statusMsg"), "ko", "Server non raggiungibile."); }
  finally { $("statusCheck").disabled = false; }
};

function showLogin(msg) {
  $("panel").hidden = true; $("login").hidden = false;
  if (msg) show($("loginMsg"), "ko", msg);
  if (pendingCode && ticketOn) { $("status").hidden = false; $("statusMsg").innerHTML = ""; }
}

async function verify(code) {
  try {
    const r = await api("/api/admin/verify", { code });
    if (await inMaintenance(r)) return;
    if (r.status === 401) { forget(); pendingCode = code; return showLogin("Sessione scaduta: accedi di nuovo."); }
    showCode($("res"), await r.json(), true);
  } catch { show($("res"), "ko", "Server non raggiungibile."); }
}

function enterPanel() {
  $("login").hidden = true; $("status").hidden = true; $("panel").hidden = false;
  $("verifyBox").hidden = !ticketOn;
  $("boardBox").hidden = !classifica;
  if (classifica) { $("boardLead").hidden = ticketOn; loadBoard(); }
  if (pendingCode && ticketOn) { // scansione del QR: il codice arriva scritto, ma va confermato a mano
    const c = pendingCode; $("code").value = c; clearHash();
    $("res").innerHTML = '<p class="hint"></p>';
    $("res").firstChild.textContent = "Hai scansionato il codice " + c + ": premi Convalida per confermarlo.";
  }
}

$("enter").onclick = async () => {
  try {
    const r = await api("/api/admin/login", { password: $("pw").value });
    if (await inMaintenance(r)) return;
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
      show($("res2"), "ko", "Non sono riuscito a chiudere la sessione sul server (connessione assente?). Riprova. Se premi di nuovo, esci solo da questo telefono e la sessione scade da sola entro 12 ore.");
      return;
      }
    }
  }
  forget(); location.reload();
};

// ---------- classifica (modalita' classifica) ----------
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
// Risposta "sessione scaduta" o "manutenzione": si gestisce e si dice di fermarsi
async function stopped(r) {
  if (await inMaintenance(r)) return true;
  if (r.status === 401) { forget(); showLogin("Sessione scaduta: accedi di nuovo."); return true; }
  return false;
}
async function loadBoard() {
  $("boardRefresh").disabled = true;
  try {
    const r = await api("/api/admin/leaderboard");
    if (await stopped(r)) return;
    const d = await r.json();
    const box = $("adminBoard"); box.innerHTML = "";
    box.append(el("h2", null, "Classifica"));
    if (!d.players.length) box.append(el("p", "hint", "Nessuno ha ancora giocato."));
    else {
      const ol = el("ol");
      d.players.forEach((p, i) => {
        const li = el("li");
        const who = el("span", "who", p.nick);
        who.title = p.correct + " giuste su " + p.total + " · " + new Date(p.played).toLocaleString("it-IT");
        li.append(el("span", "pos", (i + 1) + "°"), who);
        if (p.streak >= 3) {
          const f = el("span", "flame"); const ic = el("i"); ic.setAttribute("aria-hidden", "true");
          f.append(ic, String(p.streak), el("span", "vh", " risposte giuste di fila")); li.append(f);
        }
        li.append(el("span", "pts", String(p.score)), removeButton(p.nick));
        ol.append(li);
      });
      box.append(ol);
      box.append(el("p", "hint", d.count + (d.count === 1 ? " giocatore" : " giocatori") + " in classifica" +
        (d.count > d.players.length ? " (qui i primi " + d.players.length + ")" : "") + "."));
    }
    if (d.waiting.length) {
      box.append(el("h2", null, "Hanno scelto un nickname ma non hanno ancora giocato"));
      const ol = el("ol");
      d.waiting.forEach((nick) => { const li = el("li"); li.append(el("span", "who", nick), removeButton(nick)); ol.append(li); });
      box.append(ol);
    }
  } catch { show($("boardMsg"), "ko", "Classifica non raggiungibile: riprova."); }
  finally { $("boardRefresh").disabled = false; }
}
// Cancella un solo nickname: il pulsante chiede conferma con un secondo tocco
function removeButton(nick) {
  const b = el("button", "ghost small del", "Cancella"); b.type = "button";
  b.setAttribute("aria-label", "Cancella " + nick + " dalla classifica");
  let armed = false, timer = null;
  b.onclick = async () => {
    if (!armed) {
      armed = true; b.textContent = "Sicuro?"; b.classList.add("danger"); b.classList.remove("ghost");
      timer = setTimeout(() => { armed = false; b.textContent = "Cancella"; b.classList.remove("danger"); b.classList.add("ghost"); }, 4000);
      return;
    }
    clearTimeout(timer); b.disabled = true;
    try {
      const r = await api("/api/admin/leaderboard/remove", { nick });
      if (await stopped(r)) return;
      $("boardMsg").innerHTML = "";
      await loadBoard();
    } catch { b.disabled = false; show($("boardMsg"), "ko", "Non cancellato: server non raggiungibile."); }
  };
  return b;
}
$("boardRefresh").onclick = () => { $("boardMsg").innerHTML = ""; loadBoard(); };
// Elimina tutto: dopo il primo tocco bisogna aspettare 3 secondi prima di poter confermare (niente tocchi
// per sbaglio); poi la conferma resta disponibile per 10 secondi, dopo di che il pulsante torna com'era.
const CLEAR_LABEL = "Elimina tutta la classifica";
let clearStage = 0, clearTimer = null;
function resetClear() { clearInterval(clearTimer); clearTimeout(clearTimer); clearStage = 0; const b = $("boardClear"); b.textContent = CLEAR_LABEL; b.disabled = false; }
$("boardClear").onclick = async () => {
  const b = $("boardClear");
  if (clearStage === 0) {
    clearStage = 1; b.disabled = true;
    let left = 3; b.textContent = "Attendi " + left + "…";
    show($("boardMsg"), "ko", "Stai per eliminare tutta la classifica: nickname e punti di tutti, per sempre. Tra 3 secondi potrai confermare.");
    clearTimer = setInterval(() => {
      left--;
      if (left > 0) { b.textContent = "Attendi " + left + "…"; return; }
      clearInterval(clearTimer);
      clearStage = 2; b.disabled = false; b.textContent = "Conferma: elimina tutto";
      clearTimer = setTimeout(() => { resetClear(); $("boardMsg").innerHTML = ""; }, 10000);
    }, 1000);
    return;
  }
  if (clearStage !== 2) return;
  clearTimeout(clearTimer); b.disabled = true;
  try {
    const r = await api("/api/admin/leaderboard/clear", { confirm: true });
    if (await stopped(r)) return resetClear();
    const d = await r.json();
    resetClear();
    show($("boardMsg"), "ok", "Classifica eliminata (" + d.removed + (d.removed === 1 ? " giocatore" : " giocatori") + ").");
    await loadBoard();
  } catch { resetClear(); show($("boardMsg"), "ko", "Non eliminata: server non raggiungibile."); }
};

// Se la pagina e' gia' aperta e scansioni un altro QR, il nuovo codice arriva solo nell'indirizzo: ricarico.
window.addEventListener("hashchange", () => { if (location.hash.length > 1) location.reload(); });

(async () => {
  if ((await settings).maintenance) return showMaintenance();
  if (token) {
    try {
      const r = await api("/api/session");
      if (await inMaintenance(r)) return;
      const d = await r.json();
      if (d.ok) return enterPanel();
      forget(); // sessione scaduta o chiusa
    } catch { /* server non raggiungibile: tengo il gettone */ }
  }
  showLogin();
})();
