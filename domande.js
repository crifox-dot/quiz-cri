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
$("pass").oninput = () => { quiz.pass = $("pass").value === "" ? NaN : Number($("pass").value); markDirty(); };

// ---------- accesso e salvataggio ----------
function showLogin(msg) {
  $("editor").hidden = true; $("hunt").hidden = true; $("login").hidden = false;
  if (msg) show($("loginMsg"), "ko", msg);
}
function showEditor() { $("login").hidden = true; $("editor").hidden = false; $("hunt").hidden = false; }

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

async function renderHunt() {
  $("huntEnabled").checked = !!hunt.enabled;
  $("huntState").textContent = hunt.enabled ? "Attiva" : "Non attiva";
  const grid = $("huntGrid"); grid.innerHTML = "";
  const tokens = hunt.tokens || [];
  $("huntHint").hidden = !tokens.length;
  // Immagini PNG vere (non SVG incorporati): solo cosi' si possono salvare come foto da telefono o PC.
  const pngs = await Promise.all(tokens.map((t) => qrPng(huntUrl(t), 8, 1)));
  tokens.forEach((t, i) => {
    const item = el("div", { className: "hunt-item" },
      el("img", { src: pngs[i], alt: "QR della tappa " + (i + 1) }),
      el("p", { textContent: "Tappa " + (i + 1) }),
      el("span", { textContent: t }));
    grid.append(item);
  });
}

$("huntSave").onclick = async () => {
  try {
    const r = await api("/api/editor/hunt/save", { enabled: $("huntEnabled").checked });
    if (r.status === 401) { forget(); showLogin("Sessione scaduta: accedi di nuovo."); return; }
    const d = await r.json();
    if (!r.ok) { show($("huntMsg"), "ko", d.error || "Salvataggio non riuscito."); return; }
    hunt = d; await renderHunt();
    show($("huntMsg"), "ok", hunt.enabled ? "Caccia al tesoro attiva." : "Caccia al tesoro non attiva.");
  } catch { show($("huntMsg"), "ko", "Server non raggiungibile."); }
};

$("huntGenerate").onclick = async () => {
  const count = Number($("huntCount").value);
  if (!Number.isInteger(count) || count < 1 || count > 20) return show($("huntMsg"), "ko", "Scegli da 1 a 20 tappe.");
  const warn = hunt && hunt.tokens && hunt.tokens.length
    ? "Generare " + count + " nuovi QR delle tappe?\nI " + hunt.tokens.length + " QR già stampati smetteranno di funzionare e chi stava già cercando le tappe dovrà ripartire con quelli nuovi."
    : "Generare " + count + " nuovi QR delle tappe?";
  if (!confirm(warn)) return;
  $("huntGenerate").disabled = true;
  try {
    const r = await api("/api/editor/hunt/generate", { count });
    if (r.status === 401) { forget(); showLogin("Sessione scaduta: accedi di nuovo."); return; }
    const d = await r.json();
    if (!r.ok) { show($("huntMsg"), "ko", d.error || "Generazione non riuscita."); return; }
    hunt = d; await renderHunt();
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
    const r = await api("/api/editor/save", { baseVersion: quiz.version, title: quiz.title, pass: quiz.pass, questions: quiz.questions });
    if (r.status === 401) { forget(); showLogin("Sessione scaduta: accedi di nuovo. Le tue modifiche non sono andate perse."); return; }
    const d = await r.json();
    if (!r.ok) { show($("saveMsg"), "ko", d.error || "Pubblicazione non riuscita."); $("save").disabled = false; return; }
    quiz = d; render(); markClean();
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
