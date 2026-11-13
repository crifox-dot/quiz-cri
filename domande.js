// Se la pagina viene incorniciata da un altro sito (clickjacking), nasconde tutto e si ferma.
if (window.top !== window.self) { document.documentElement.style.display = "none"; throw new Error("pagina incorniciata"); }

const API = "https://steep-haze-2da0.cloudflare-vbmev.workers.dev";
const $ = (id) => document.getElementById(id);

// Il browser ricorda solo un "gettone" di sessione (2 ore), mai la password, e solo finche' la scheda resta aperta
// (sessionStorage): chiudendo la scheda bisogna rifare l'accesso.
const saved = {
  get() { try { return sessionStorage.getItem("editorToken") || ""; } catch { return ""; } },
  set(v) { try { sessionStorage.setItem("editorToken", v); } catch {} },
  clear() { try { sessionStorage.removeItem("editorToken"); localStorage.removeItem("editorToken"); } catch {} }
};
let token = saved.get();
let quiz = null;   // copia di lavoro: { version, pass, questions: [{ id?, q, o: [], a }] }
let dirty = false; // true = ci sono modifiche non ancora pubblicate
let hunt = null;   // caccia al tesoro: { enabled, tokens: [] }

const api = (path, body) => fetch(API + path, {
  method: body ? "POST" : "GET",
  headers: Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}),
  body: body ? JSON.stringify(body) : undefined });
const show = (el, cls, text) => { el.innerHTML = '<p class="msg ' + cls + '"></p>'; el.firstChild.textContent = text; };
const forget = () => { token = ""; saved.clear(); };

// piccolo costruttore di elementi: tutto il testo passa da textContent/value, mai da innerHTML
function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props || {});
  kids.forEach((k) => e.append(k));
  return e;
}
function btn(text, fn, cls, disabled, label) {
  const b = el("button", { type: "button", textContent: text, className: cls || "", onclick: fn, disabled: !!disabled });
  if (label) b.setAttribute("aria-label", label);
  return b;
}

async function denied(r) {
  const d = await r.json().catch(() => ({}));
  const min = Math.max(1, Math.ceil((d.retryAfter || 0) / 60));
  if (r.status === 503) return d.error === "Accesso non configurato"
    ? "L'editor non è ancora configurato sul server: manca la password EDITOR_PASSWORD."
    : (d.error || "Accesso non disponibile.");
  if (r.status === 429) return "Troppi tentativi errati: accesso bloccato. Riprova tra circa " + min + " minuti.";
  if (d.left === 0) return "Password errata. Accesso bloccato per circa " + min + " minuti.";
  return "Password errata. Tentativi rimasti: " + d.left + ".";
}

// ---------- bozza ----------
function markDirty() {
  dirty = true;
  $("save").disabled = false;
  $("state").textContent = "Modifiche non ancora pubblicate";
  $("state").className = "state dirty";
  $("saveMsg").innerHTML = "";
}
function markClean() {
  dirty = false;
  $("save").disabled = true;
  $("state").textContent = "Versione pubblicata: " + quiz.version;
  $("state").className = "state";
}
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

// ---------- disegno dell'editor ----------
function render() {
  const y = window.scrollY;
  $("title").value = quiz.title || "";
  $("subtitle").value = quiz.subtitle || "";
  $("headline").value = quiz.headline || "";
  $("sticker1").value = quiz.sticker1 || "";
  $("sticker2").value = quiz.sticker2 || "";
  $("pass").value = Number.isNaN(quiz.pass) ? "" : quiz.pass;
  $("pass").max = quiz.questions.length;
  $("passInfo").textContent = "su " + quiz.questions.length + (quiz.questions.length === 1 ? " domanda" : " domande");
  const list = $("list"); list.innerHTML = "";
  quiz.questions.forEach((x, i) => list.append(card(x, i)));
  window.scrollTo(0, y);
}

function card(x, i) {
  const n = i + 1, N = quiz.questions.length;
  const f = el("fieldset", { className: "qcard" });
  const tools = el("div", { className: "qtools" },
    btn("Su", () => move(i, -1), "ghost small", i === 0),
    btn("Giù", () => move(i, 1), "ghost small", i === N - 1),
    btn("Elimina", () => removeQuestion(i), "danger small", N <= 1));
  f.append(el("div", { className: "qhead" }, el("strong", { textContent: "Domanda " + n }), tools));

  const ta = el("textarea", { value: x.q, rows: 2, maxLength: 300, oninput: () => { x.q = ta.value; markDirty(); } });
  ta.setAttribute("aria-label", "Testo della domanda " + n);
  f.append(ta);
  f.append(el("p", { className: "hint", textContent: "Scrivi le risposte e seleziona il cerchio accanto a quella giusta." }));

  x.o.forEach((t, j) => {
    const radio = el("input", { type: "radio", name: "giusta" + i, checked: x.a === j, onchange: () => { x.a = j; markDirty(); } });
    radio.setAttribute("aria-label", "Risposta " + (j + 1) + " della domanda " + n + ": è quella giusta");
    const txt = el("input", { type: "text", value: t, maxLength: 200, placeholder: "Risposta " + (j + 1),
      oninput: () => { x.o[j] = txt.value; markDirty(); } });
    txt.setAttribute("aria-label", "Testo della risposta " + (j + 1) + " della domanda " + n);
    f.append(el("div", { className: "optrow" }, radio, txt,
      btn("✕", () => removeOption(x, j), "ghost small", x.o.length <= 2, "Rimuovi la risposta " + (j + 1) + " della domanda " + n)));
  });
  f.append(btn("Aggiungi risposta", () => { x.o.push(""); markDirty(); render(); }, "ghost small", x.o.length >= 6));
  return f;
}

function move(i, d) {
  const qs = quiz.questions, k = i + d;
  if (k < 0 || k >= qs.length) return;
  [qs[i], qs[k]] = [qs[k], qs[i]];
  markDirty(); render();
}
function removeQuestion(i) {
  if (!confirm("Eliminare la domanda " + (i + 1) + "?")) return;
  quiz.questions.splice(i, 1);
  if (quiz.pass > quiz.questions.length) quiz.pass = quiz.questions.length;
  markDirty(); render();
}
function removeOption(x, j) {
  x.o.splice(j, 1);
  if (x.a === j) x.a = null; else if (x.a !== null && x.a > j) x.a--;
  markDirty(); render();
}

$("addq").onclick = () => {
  quiz.questions.push({ q: "", o: ["", ""], a: null });
  markDirty(); render();
  const areas = document.querySelectorAll("#list textarea");
  const last = areas[areas.length - 1];
  last.scrollIntoView({ block: "center" }); last.focus();
};
$("title").oninput = () => { quiz.title = $("title").value; markDirty(); };
$("subtitle").oninput = () => { quiz.subtitle = $("subtitle").value; markDirty(); };
["headline", "sticker1", "sticker2"].forEach((k) => { $(k).oninput = () => { quiz[k] = $(k).value; markDirty(); }; });
$("pass").oninput = () => { quiz.pass = $("pass").value === "" ? NaN : Number($("pass").value); markDirty(); };

// ---------- accesso e salvataggio ----------
function showLogin(msg) {
  $("editor").hidden = true; $("hunt").hidden = true; $("login").hidden = false;
  if (msg) show($("loginMsg"), "ko", msg);
}
function showEditor() { $("login").hidden = true; $("editor").hidden = false; $("hunt").hidden = false; loadUsage(); nickWordCall(null); }

// ---------- richieste di oggi a Cloudflare ----------
// Il piano gratuito consente 100.000 richieste al giorno (per tutto l'account Cloudflare), azzerate a
// mezzanotte UTC. Il numero arriva dalle statistiche di Cloudflare tramite il Worker, con qualche minuto
// di ritardo. Si aggiorna SOLO aprendo la pagina e col pulsante Aggiorna (niente aggiornamenti automatici:
// ogni lettura e' a sua volta una richiesta al Worker, anche se una sola su 100.000).
const fmt = (n) => Number(n).toLocaleString("it-IT");
const hhmm = (iso) => new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
function showUsage(d) {
  const limit = d.limit || 100000;
  const has = typeof d.requests === "number";
  const pct = has ? Math.min(100, d.requests / limit * 100) : 0;
  $("usageBar").style.width = pct + "%";
  $("usageDot").style.left = pct + "%";
  $("usageProgress").setAttribute("aria-valuemax", String(limit));
  if (has) $("usageProgress").setAttribute("aria-valuenow", String(d.requests)); else $("usageProgress").removeAttribute("aria-valuenow");
  $("usageCount").textContent = (has ? fmt(d.requests) : "—") + " / " + fmt(limit);
  const box = $("usageCount").closest(".usage");
  box.classList.toggle("high", has && pct >= 80);
  const reset = d.resetAt ? " Si azzera ogni giorno alle " + hhmm(d.resetAt) + "." : "";
  let info;
  if (!d.configured) info = "Statistica non ancora attivata: su Cloudflare vanno aggiunte le impostazioni CF_ACCOUNT_ID e CF_API_TOKEN (istruzioni nel README).";
  else if (d.error === "token") info = "Cloudflare ha rifiutato il token: controlla che CF_API_TOKEN abbia il permesso «Account Analytics: Read».";
  else if (d.error === "account") info = "Account non trovato: controlla che CF_ACCOUNT_ID sia l'ID giusto.";
  else if (d.error) info = "Statistiche di Cloudflare non raggiungibili in questo momento: riprova tra poco.";
  else {
    const p = pct < 0.1 && d.requests > 0 ? "meno dello 0,1" : pct.toLocaleString("it-IT", { maximumFractionDigits: 1 });
    info = (pct >= 100 ? "Limite giornaliero raggiunto: fino all'azzeramento il sito potrebbe non funzionare. " : pct >= 80 ? "Attenzione, ci si avvicina al limite giornaliero. " : "") +
      "Usato il " + p + "% del limite gratuito di oggi." + reset +
      (d.updated ? " Dati delle " + hhmm(d.updated) + ", con qualche minuto di ritardo." : "");
  }
  $("usageInfo").textContent = info;
}
async function loadUsage() {
  $("usageRefresh").disabled = true;
  try {
    const r = await api("/api/editor/usage");
    if (r.status === 401) { forget(); return showLogin("Sessione scaduta: accedi di nuovo."); }
    showUsage(await r.json());
  } catch {
    $("usageInfo").textContent = "Server non raggiungibile: riprova tra poco.";
  } finally { $("usageRefresh").disabled = false; }
}
$("usageRefresh").onclick = loadUsage;

// ---------- grafica del sito (nuova o classica) ----------
// Vale per tutto il sito. Scegliere una voce non cambia ancora nulla: serve premere "Conferma grafica"
// (cosi' un tocco per sbaglio non cambia l'aspetto del sito a chi sta facendo il quiz).
let graficaAttuale = null;
const graficaScelta = () => (document.querySelector('input[name="grafica"]:checked') || {}).value || null;
function showGraficaChoice(g) {
  graficaAttuale = g;
  document.querySelectorAll('input[name="grafica"]').forEach((r) => { r.checked = r.value === g; });
  $("graficaApply").disabled = true;
}
// Impostazioni del sito (pubbliche): grafica, manutenzione e colori dei QR. "settings" serve anche
// ai QR delle tappe, che vanno disegnati coi colori giusti fin dalla prima volta.
const settings = fetch(API + "/api/grafica").then((r) => r.json()).then((d) => {
  if (window.setSticker && d.sticker) window.setSticker(d.sticker);
  if (typeof d.maintenance === "boolean") showMaint(d.maintenance);
  if (d.qr) showQrColors(d.qr);
  if (typeof d.classifica === "boolean") showClassifica(d);
  if (d.grafica) {
    if (window.setGrafica) window.setGrafica(d.grafica);
    showGraficaChoice(d.grafica);
  }
  return d;
}).catch(() => {
  $("maintState").textContent = "Stato non disponibile: server non raggiungibile. Ricarica la pagina.";
  return {};
});

// ---------- modalita' manutenzione ----------
// Accesa: la pagina del quiz e il pannello admin mostrano solo l'avviso (lo decide il server).
// Questa pagina resta sempre accessibile, altrimenti non si potrebbe piu' spegnerla.
let maintOn = null;
function showMaint(on) {
  maintOn = on;
  $("maintState").textContent = on
    ? "Il sito è in manutenzione: quiz e pannello admin sono chiusi."
    : "Il sito è aperto: quiz e pannello admin funzionano normalmente.";
  $("maintState").className = "maint-state " + (on ? "on" : "off");
  $("maintToggle").textContent = on ? "Riapri il sito" : "Metti il sito in manutenzione";
  $("maintToggle").disabled = false;
}
$("maintToggle").onclick = async () => {
  if (maintOn === null) return;
  const next = !maintOn;
  if (next && !confirm("Mettere il sito in manutenzione?\nChi sta facendo il quiz o usando il pannello admin verrà bloccato finché non riapri il sito.")) return;
  $("maintToggle").disabled = true;
  try {
    const r = await api("/api/editor/maintenance", { maintenance: next });
    if (r.status === 401) { showMaint(maintOn); forget(); return showLogin("Sessione scaduta: accedi di nuovo."); }
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "errore");
    showMaint(d.maintenance);
  } catch {
    showMaint(maintOn);
    $("maintState").textContent = "Non salvato: server non raggiungibile, riprova.";
  }
};

// ---------- modalita' classifica ----------
// La classifica e, solo con la classifica attiva, il biglietto e il timer (con i secondi per domanda).
// Valgono dopo "Conferma".
let lbSaved = null; // { classifica, ticket, timer, timerSec } salvati sul server
function showClassifica(d) {
  lbSaved = { classifica: d.classifica === true, ticket: d.ticketOption !== false, timer: d.timerOption === true, timerSec: d.timerSec || 20 };
  $("lbOn").checked = lbSaved.classifica; $("lbTicket").checked = lbSaved.ticket;
  $("lbTimer").checked = lbSaved.timer; $("lbTimerSec").value = lbSaved.timerSec;
  lbChanged();
}
// secondi scritti nel campo: un numero intero tra 5 e 120, altrimenti null
function lbSeconds() { const v = Number($("lbTimerSec").value); return Number.isInteger(v) && v >= 5 && v <= 120 ? v : null; }
function lbChanged() {
  const on = $("lbOn").checked, timer = $("lbTimer").checked, sec = lbSeconds();
  $("lbTicket").disabled = !on; // senza classifica il biglietto c'e' sempre
  $("lbTimer").disabled = !on;  // ...e il timer non esiste
  $("lbTimerSec").disabled = !on || !timer;
  $("lbTimerSec").classList.toggle("bad", sec === null);
  const changed = !!lbSaved && (on !== lbSaved.classifica || $("lbTicket").checked !== lbSaved.ticket || timer !== lbSaved.timer || sec !== lbSaved.timerSec);
  $("lbSave").disabled = !changed || sec === null;
  const st = $("lbState");
  if (sec === null) { st.textContent = "Il tempo deve essere un numero intero tra 5 e 120 secondi"; st.className = "state dirty"; }
  else if (changed) { st.textContent = "Non ancora applicata: premi Conferma"; st.className = "state dirty"; }
  else if (lbSaved) {
    st.textContent = !lbSaved.classifica ? "Classifica spenta (biglietto come sempre)"
      : "Classifica attiva, " + (lbSaved.ticket ? "con" : "senza") + " biglietto, " + (lbSaved.timer ? "timer di " + lbSaved.timerSec + " secondi" : "senza timer");
    st.className = "state";
  }
}
$("lbOn").onchange = lbChanged;
$("lbTicket").onchange = lbChanged;
$("lbTimer").onchange = lbChanged;
$("lbTimerSec").oninput = lbChanged;
$("lbSave").onclick = async () => {
  const sec = lbSeconds(); if (sec === null) return;
  const want = { classifica: $("lbOn").checked, ticket: $("lbTicket").checked, timer: $("lbTimer").checked, timerSec: sec };
  const st = $("lbState");
  $("lbSave").disabled = true; st.textContent = "Salvataggio…"; st.className = "state";
  try {
    const r = await api("/api/editor/classifica", want);
    if (r.status === 401) { lbChanged(); forget(); return showLogin("Sessione scaduta: accedi di nuovo."); }
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "errore");
    showClassifica(d);
  } catch {
    lbChanged();
    st.textContent = "Non salvata: server non raggiungibile, riprova."; st.className = "state dirty";
  }
};

// ---------- parole bloccate nei nickname ----------
// Oltre alle liste fisse del server, l'editor puo' aggiungerne altre: "anche dentro ad altre parole" oppure
// solo come parola esatta. Se una parola e' gia' bloccata (dalle liste fisse o da un'aggiunta) il server lo dice.
function showNickWords(words) {
  const ul = $("nwList"); ul.innerHTML = "";
  // il titolo dell'elenco (che lo apre e lo chiude) dice quante sono, cosi' anche da chiuso si sa se ce ne sono
  $("nwSummary").textContent = "Parole aggiunte (" + words.length + ")";
  if (!words.length) { const li = document.createElement("li"); li.className = "hint"; li.textContent = "Nessuna parola aggiunta."; ul.append(li); return; }
  for (const c of words) {
    const li = document.createElement("li");
    const w = document.createElement("b"); w.textContent = c.w;
    const how = document.createElement("span"); how.className = "how"; how.textContent = c.inside ? "anche dentro ad altre parole" : "solo parola esatta";
    const del = document.createElement("button"); del.type = "button"; del.className = "ghost small"; del.textContent = "Togli";
    del.setAttribute("aria-label", "Togli " + c.w + " dalle parole bloccate");
    del.onclick = () => nickWordCall({ remove: c.w }, "«" + c.w + "» non è più bloccata.");
    li.append(w, how, del); ul.append(li);
  }
}
const nwMsg = (cls, text) => { const m = $("nwMsg"); m.innerHTML = ""; if (!text) return; const p = document.createElement("p"); p.className = "msg " + cls; p.textContent = text; m.append(p); };
async function nickWordCall(body, okText) {
  $("nwAdd").disabled = true;
  try {
    const r = await api("/api/editor/nickwords", body);
    if (r.status === 401) { forget(); return showLogin("Sessione scaduta: accedi di nuovo."); }
    const d = await r.json();
    if (!r.ok) return nwMsg("ko", d.error || "Non salvata."); // es. "è già bloccata"
    showNickWords(d.words);
    if (body && body.add) { $("nwBox").open = true; $("nwWord").value = ""; okText = "«" + d.added + "» ora è bloccata" + (d.inside ? ", anche dentro ad altre parole." : " (solo come parola esatta)."); }
    nwMsg("ok", okText || "");
  } catch { nwMsg("ko", "Server non raggiungibile: riprova."); }
  finally { $("nwAdd").disabled = false; }
}
$("nwAdd").onclick = () => {
  const w = $("nwWord").value.trim().toLowerCase();
  if (!/^[a-z]{2,20}$/.test(w)) return nwMsg("ko", "Scrivi una parola di sole lettere (dalla A alla Z), da 2 a 20.");
  nickWordCall({ add: w, inside: $("nwInside").checked });
};
$("nwWord").onkeydown = (e) => { if (e.key === "Enter") $("nwAdd").click(); };

// ---------- colori dei QR code ----------
// Valgono per il QR del biglietto e per quelli delle tappe. Si scrivono come codice (#191919) oppure si
// scelgono col selettore; l'anteprima mostra subito il risultato. Si salvano solo con "Salva colori".
let qrSaved = { dark: "#000000", light: "#ffffff" };
// "#191919", "191919" o "#abc" -> "#191919" / "#aabbcc"; qualsiasi altra cosa -> null
function normHex(v) {
  let s = String(v || "").trim().toLowerCase();
  if (!s.startsWith("#")) s = "#" + s;
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  return null;
}
// luminosita' relativa e contrasto (formula WCAG, la stessa usata dal server)
function luminance(h) {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
function showQrColors(qr) {
  qrSaved = { dark: qr.dark, light: qr.light };
  if (window.qrSetColors) qrSetColors(qrSaved);
  $("qrDark").value = qr.dark.toUpperCase(); $("qrLight").value = qr.light.toUpperCase();
  qrColorsChanged();
}
let previewSeq = 0;
function qrColorsChanged() {
  const dark = normHex($("qrDark").value), light = normHex($("qrLight").value);
  const msg = $("qrColorMsg");
  $("qrDark").classList.toggle("bad", !dark); $("qrLight").classList.toggle("bad", !light);
  let ok = !!(dark && light);
  if (!ok) {
    msg.textContent = "Colore non valido: scrivi # seguito da 6 cifre o lettere da A a F, ad esempio #191919.";
  } else {
    $("qrDarkPick").value = dark; $("qrLightPick").value = light;
    const ratio = contrast(dark, light);
    if (ratio < 3) { ok = false; msg.textContent = "I due colori sono troppo simili: il QR non si leggerebbe. Scegli quadratini più scuri o uno sfondo più chiaro."; }
    else if (luminance(dark) > luminance(light)) msg.textContent = "Attenzione: i quadratini sono più chiari dello sfondo. Molte fotocamere non riconoscono i QR \"al contrario\": meglio quadratini scuri su sfondo chiaro.";
    else if (ratio < 4.5) msg.textContent = "Contrasto un po' basso: prova a scansionare l'anteprima col telefono prima di stampare.";
    else msg.textContent = "";
    const seq = ++previewSeq;
    qrPng(new URL("index.html", location.href).href, 5, 2, { dark, light })
      .then((src) => { if (seq === previewSeq) $("qrPreview").src = src; }).catch(() => {});
  }
  $("qrPreview").classList.toggle("bad", !ok);
  const changed = ok && (dark !== qrSaved.dark || light !== qrSaved.light);
  $("qrColorSave").disabled = !changed;
  $("qrColorState").textContent = changed ? "Non ancora salvati" : "";
  $("qrColorState").className = changed ? "state dirty" : "state";
}
$("qrDark").oninput = qrColorsChanged;
$("qrLight").oninput = qrColorsChanged;
$("qrDarkPick").oninput = () => { $("qrDark").value = $("qrDarkPick").value.toUpperCase(); qrColorsChanged(); };
$("qrLightPick").oninput = () => { $("qrLight").value = $("qrLightPick").value.toUpperCase(); qrColorsChanged(); };
$("qrColorReset").onclick = () => { $("qrDark").value = "#000000"; $("qrLight").value = "#FFFFFF"; qrColorsChanged(); };
$("qrColorSave").onclick = async () => {
  const dark = normHex($("qrDark").value), light = normHex($("qrLight").value);
  if (!dark || !light) return;
  const st = $("qrColorState");
  $("qrColorSave").disabled = true;
  st.textContent = "Salvataggio…"; st.className = "state";
  try {
    const r = await api("/api/editor/qrcolors", { dark, light });
    if (r.status === 401) { st.textContent = ""; $("qrColorSave").disabled = false; forget(); return showLogin("Sessione scaduta: accedi di nuovo."); }
    const d = await r.json();
    if (!r.ok) { st.textContent = d.error || "Non salvati."; st.className = "state dirty"; $("qrColorSave").disabled = false; return; }
    showQrColors(d.qr);
    st.textContent = "Salvati"; st.className = "state";
    if (hunt) await renderHunt(); // i QR delle tappe qui sotto si ridisegnano coi nuovi colori
  } catch {
    st.textContent = "Non salvati: server non raggiungibile, riprova."; st.className = "state dirty";
    $("qrColorSave").disabled = false;
  }
};
document.querySelectorAll('input[name="grafica"]').forEach((radio) => {
  radio.onchange = () => {
    const changed = graficaScelta() !== graficaAttuale;
    $("graficaApply").disabled = !changed;
    $("graficaState").textContent = changed ? "Non ancora applicata: premi Conferma grafica" : "";
    $("graficaState").className = changed ? "state dirty" : "state";
  };
});
{
  $("graficaApply").onclick = async () => {
    const g = graficaScelta();
    if (!g || g === graficaAttuale) return;
    const st = $("graficaState");
    $("graficaApply").disabled = true;
    st.textContent = "Salvataggio…"; st.className = "state";
    try {
      const r = await api("/api/editor/grafica", { grafica: g });
      if (r.status === 401) { st.textContent = ""; forget(); return showLogin("Sessione scaduta: accedi di nuovo."); }
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "errore");
      if (window.setGrafica) window.setGrafica(d.grafica);
      showGraficaChoice(d.grafica);
      st.textContent = d.grafica === "nuova" ? "Salvata: grafica nuova" : "Salvata: grafica classica";
    } catch {
      st.textContent = "Non salvata: server non raggiungibile, riprova."; st.className = "state dirty";
      $("graficaApply").disabled = false;
    }
  };
}

async function loadQuiz() {
  const r = await api("/api/editor/quiz");
  if (r.status === 401) { forget(); showLogin("Sessione scaduta: accedi di nuovo."); return false; }
  quiz = await r.json(); render(); markClean(); $("saveMsg").innerHTML = "";
  return true;
}

// ---------- caccia al tesoro (facoltativa, indipendente dalle domande) ----------
async function loadHunt() {
  const r = await api("/api/editor/hunt");
  if (r.status === 401) { forget(); showLogin("Sessione scaduta: accedi di nuovo."); return false; }
  hunt = await r.json(); await renderHunt();
  return true;
}

function huntUrl(t) { return new URL("index.html#tappa=" + t, location.href).href; }

// "Dividi le domande tra le tappe" ha senso solo se la caccia al tesoro e' attiva: si puo' selezionare
// solo quando "Attiva caccia al tesoro" e' spuntata (anche solo in anteprima, prima di premere Salva).
function syncHuntDistributeEnabled() { $("huntDistribute").disabled = !$("huntEnabled").checked; }
$("huntEnabled").onchange = syncHuntDistributeEnabled;

let huntRenderSeq = 0;
async function renderHunt() {
  $("huntEnabled").checked = !!hunt.enabled;
  $("huntDistribute").checked = !!hunt.distribute;
  syncHuntDistributeEnabled();
  $("huntState").textContent = hunt.enabled ? "Attiva" : "Non attiva";
  const grid = $("huntGrid");
  const tokens = hunt.tokens || [];
  $("huntHint").hidden = !tokens.length;
  // Immagini PNG vere (non SVG incorporati): solo cosi' si possono salvare come foto da telefono o PC.
  await settings; // colori dei QR scelti qui sopra
  const seq = ++huntRenderSeq;
  const pngs = await Promise.all(tokens.map((t) => qrPng(huntUrl(t), 8, 1)));
  if (seq !== huntRenderSeq) return; // nel frattempo e' partito un disegno piu' recente
  grid.innerHTML = "";
  tokens.forEach((t, i) => {
    const kids = [el("img", { src: pngs[i], alt: "QR della tappa " + (i + 1) }), el("p", { textContent: "Tappa " + (i + 1) })];
    if (hunt.distribute && Array.isArray(hunt.counts)) {
      const n = hunt.counts[i];
      kids.push(el("p", { className: "qcount", textContent: n === 1 ? "1 domanda" : n + " domande" }));
    }
    kids.push(el("span", { textContent: t }));
    grid.append(el("div", { className: "hunt-item" }, ...kids));
  });
}

$("huntSave").onclick = async () => {
  try {
    const r = await api("/api/editor/hunt/save", { enabled: $("huntEnabled").checked, distribute: $("huntDistribute").checked });
    if (r.status === 401) { forget(); showLogin("Sessione scaduta: accedi di nuovo."); return; }
    const d = await r.json();
    if (!r.ok) { show($("huntMsg"), "ko", d.error || "Salvataggio non riuscito."); return; }
    await loadHunt(); // ricarico dal server: solo cosi' arriva anche "counts" se la divisione e' attiva
    show($("huntMsg"), "ok", hunt.enabled ? "Caccia al tesoro attiva." : "Caccia al tesoro non attiva.");
  } catch { show($("huntMsg"), "ko", "Server non raggiungibile."); }
};

$("huntGenerate").onclick = async () => {
  const count = Number($("huntCount").value);
  if (!Number.isInteger(count) || count < 1 || count > 20) return show($("huntMsg"), "ko", "Scegli da 1 a 20 tappe.");
  const distribute = $("huntDistribute").checked;
  let warn = hunt && hunt.tokens && hunt.tokens.length
    ? "Generare " + count + " nuovi QR delle tappe?\nI " + hunt.tokens.length + " QR già stampati smetteranno di funzionare e chi stava già cercando le tappe dovrà ripartire con quelli nuovi."
    : "Generare " + count + " nuovi QR delle tappe?";
  if (distribute && quiz && count > quiz.questions.length) {
    warn = "Attenzione: ci sono più tappe (" + count + ") che domande (" + quiz.questions.length + "): alcune tappe non avranno nessuna domanda.\n\n" + warn;
  }
  if (!confirm(warn)) return;
  $("huntGenerate").disabled = true;
  try {
    const r = await api("/api/editor/hunt/generate", { count, distribute });
    if (r.status === 401) { forget(); showLogin("Sessione scaduta: accedi di nuovo."); return; }
    const d = await r.json();
    if (!r.ok) { show($("huntMsg"), "ko", d.error || "Generazione non riuscita."); return; }
    await loadHunt(); // ricarico dal server: solo cosi' arriva anche "counts" se la divisione e' attiva
    show($("huntMsg"), "ok", "Generati " + hunt.tokens.length + " nuovi QR. Salvali come foto e posizionali in giro, in qualsiasi ordine.");
  } catch { show($("huntMsg"), "ko", "Server non raggiungibile."); }
  finally { $("huntGenerate").disabled = false; }
};

$("enter").onclick = async () => {
  try {
    const r = await api("/api/editor/login", { password: $("pw").value });
    if (!r.ok) return show($("loginMsg"), "ko", await denied(r));
    token = (await r.json()).token; saved.set(token); $("pw").value = ""; $("loginMsg").innerHTML = "";
    await loadHunt();
    if (quiz) showEditor(); // sessione scaduta mentre c'erano modifiche: la bozza e' ancora qui
    else if (await loadQuiz()) showEditor();
  } catch { show($("loginMsg"), "ko", "Server non raggiungibile."); }
};
$("pw").onkeydown = (e) => { if (e.key === "Enter") $("enter").click(); };

$("save").onclick = async () => {
  if (!confirm("Pubblicare le modifiche?\nChi sta facendo il quiz in questo momento dovrà ricominciare.")) return;
  $("save").disabled = true;
  try {
    const r = await api("/api/editor/save", { baseVersion: quiz.version, title: quiz.title, subtitle: quiz.subtitle || "", headline: quiz.headline || "", sticker1: quiz.sticker1 || "", sticker2: quiz.sticker2 || "", pass: quiz.pass, questions: quiz.questions });
    if (r.status === 401) { forget(); showLogin("Sessione scaduta: accedi di nuovo. Le tue modifiche non sono andate perse."); return; }
    const d = await r.json();
    if (!r.ok) { show($("saveMsg"), "ko", d.error || "Pubblicazione non riuscita."); $("save").disabled = false; return; }
    quiz = d; render(); markClean();
    // le scritte del logo possono essere cambiate: si aggiornano subito anche in questa pagina
    fetch(API + "/api/grafica").then((x) => x.json()).then((x) => { if (window.setSticker && x.sticker) window.setSticker(x.sticker); }).catch(() => {});
    show($("saveMsg"), "ok", "Pubblicato. Il quiz usa subito queste domande (versione " + d.version + ").");
  } catch { show($("saveMsg"), "ko", "Server non raggiungibile."); $("save").disabled = false; }
};

$("revert").onclick = async () => {
  if (dirty && !confirm("Annullare le modifiche non pubblicate e ricaricare le domande attuali?")) return;
  try { await loadQuiz(); } catch { show($("saveMsg"), "ko", "Server non raggiungibile."); }
};
// Uscita: il gettone va invalidato SUL SERVER. Se il server non risponde non lo cancello in silenzio.
let logoutFailed = false;
$("logout").onclick = async () => {
  if (dirty && !confirm("Hai modifiche non pubblicate. Uscire e perderle?")) return;
  {
    try {
      const r = await api("/api/editor/logout", {});
      if (!r.ok) throw new Error("logout");
    } catch {
      if (logoutFailed) { /* secondo tentativo fallito: esco solo in locale */ } else {
      logoutFailed = true;
      $("logout").textContent = "Esci comunque";
      show($("saveMsg"), "ko", "Non sono riuscito a chiudere la sessione sul server (connessione assente?). Riprova. Se premi di nuovo, esci solo da questo browser e la sessione scade da sola entro 2 ore.");
      return;
      }
    }
  }
  dirty = false;
  forget(); location.reload();
};

(async () => {
  if (token) {
    try {
      const d = await (await api("/api/editor/session")).json();
      if (d.ok) { await loadHunt(); if (await loadQuiz()) showEditor(); return; }
      forget(); // sessione scaduta o chiusa
    } catch { /* server non raggiungibile: tengo il gettone */ }
  }
  showLogin();
})();
