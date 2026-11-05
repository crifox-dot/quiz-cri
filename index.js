const API = "https://steep-haze-2da0.cloudflare-vbmev.workers.dev";
const $ = (id) => document.getElementById(id);
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
let questions = [], version = 0, needed = 0, quizTitle = "Quiz sull'HIV";
let order = [], answers = {}, step = 0; // answers: { idDomanda: indiceRispostaScelta }

// Caccia al tesoro: il QR di una tappa porta qui con "#tappa=TOKEN" nell'indirizzo.
// Se la caccia al tesoro non e' attiva, questo pezzo di codice non fa nulla: il sito resta come sempre.
let huntToken = null;
try { const m = location.hash.match(/^#tappa=([^&]+)/); if (m) huntToken = decodeURIComponent(m[1]); } catch {}
const clearHash = () => history.replaceState(null, "", location.pathname + location.search);

// mescola l'ordine delle domande (Fisher-Yates con numeri casuali sicuri)
function shuffle(n){
  const a = Array.from({length:n}, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Titolo: l'ultima parola (dopo l'eventuale apostrofo) va in corsivo rosso, come nel design
function setTitle(t){
  const h = $("title"); h.textContent = "";
  const m = t.match(/^(.*?)([^\s']+)$/);
  if (m && m[1]) { h.append(m[1]); const em = document.createElement("em"); em.textContent = m[2]; h.append(em); }
  else h.textContent = t;
  document.title = t + " · CRI Francavilla Fontana - Oria";
}

// Scarica le domande attuali (numero e soglia possono cambiare quando il Comitato le modifica)
async function loadQuestions(){
  const d = await (await fetch(API + "/api/questions")).json();
  if (!d.questions) throw new Error("risposta non valida");
  questions = d.questions; version = d.version; needed = d.needed;
  quizTitle = d.title || "Quiz sull'HIV";
  setTitle(quizTitle);
  $("lead").textContent = plural(questions.length, "domanda", "domande") + ", una alla volta. Con almeno " +
    plural(needed, "risposta giusta", "risposte giuste") + " ricevi un codice personale, valido una sola volta.";
}

loadQuestions().then(async () => {
  $("go").disabled = false;
  $("loadMsg").hidden = true;
  if (huntToken) {
    const t = huntToken; clearHash();
    try { await handleHuntVisit(t); } catch { showHuntNote("Server non raggiungibile: prova a scansionare di nuovo questo QR."); }
  }
}).catch(() => { setTitle("Quiz sull'HIV"); $("loadMsg").textContent = "Impossibile caricare il quiz. Riprova più tardi."; });

function showHuntNote(text) {
  const p = document.createElement("p"); p.className = "hint"; p.textContent = text;
  $("start").append(p);
}

// Scansione di una tappa della caccia al tesoro (arrivata con "#tappa=" nell'indirizzo).
// Se la caccia al tesoro non e' attiva sul server, questa funzione non cambia nulla: resta la pagina normale.
async function handleHuntVisit(token) {
  const r = await (await fetch(API + "/api/hunt/visit", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, visitor: visitorId() })
  })).json();
  if (!r.enabled) return; // caccia al tesoro non attiva: pagina normale, nessun cambiamento
  if (!r.valid) return showHuntNote("Questo QR non è più valido.");
  if (!r.passed) return showHuntNote("Tappa trovata (" + r.found + " di " + r.total + "). Fai il quiz per continuare la caccia al tesoro.");
  renderHuntTicket(1 + r.found, r.total + 1, r.code, r.reused);
}

function start(){
  order = shuffle(questions.length);
  answers = {};
  step = 0;
  $("start").hidden = true; $("result").hidden = true; $("quiz").hidden = false;
  render();
}

function render(){
  const x = questions[order[step]];
  $("count").textContent = "Domanda " + (step + 1) + " di " + order.length;
  $("bar").style.width = (step / order.length * 100) + "%";
  $("qtext").textContent = x.q;
  const box = $("opts"); box.innerHTML = "";
  x.o.forEach((t, j) => {
    const l = document.createElement("label");
    const r = document.createElement("input");
    r.type = "radio"; r.name = "opt"; r.value = j; r.checked = answers[x.id] === j;
    r.onchange = () => { answers[x.id] = j; $("next").disabled = false; };
    const s = document.createElement("span"); s.textContent = t;
    l.append(r, s); box.append(l);
  });
  $("next").disabled = answers[x.id] === undefined;
  $("next").textContent = step === order.length - 1 ? "Invia le risposte" : "Avanti";
  $("back").hidden = step === 0;
  $("err").innerHTML = "";
}

function showError(text){
  $("err").innerHTML = '<p class="msg ko"></p>';
  $("err").firstChild.textContent = text;
}

$("go").onclick = start;
$("back").onclick = () => { step--; render(); };
$("next").onclick = () => { if (step < order.length - 1) { step++; render(); } else submit(); };

// Un id a caso salvato nel browser (non un cookie): serve solo a far ottenere di nuovo lo stesso
// codice se la stessa persona rifa' il quiz dallo stesso telefono. Se il browser blocca la memoria
// locale, va bene lo stesso: si ottiene solo un codice nuovo ad ogni volta, come oggi.
function visitorId(){
  try {
    let v = localStorage.getItem("quizVisitor");
    if (v && /^[a-f0-9]{32}$/.test(v)) return v;
    v = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem("quizVisitor", v);
    return v;
  } catch { return null; }
}

async function submit(){
  $("next").disabled = true;
  try {
    const r = await (await fetch(API + "/api/submit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version, answers, visitor: visitorId() })
    })).json();
    if (r.stale) { // le domande sono state aggiornate mentre rispondevi: si riparte con quelle nuove
      await loadQuestions(); start();
      showError("Il quiz è stato aggiornato mentre rispondevi: ricominciamo dalla prima domanda.");
      return;
    }
    if (r.error) { const e = new Error(r.error); e.wait = r.retryAfter; throw e; }
    showResult(r);
  } catch (e) {
    showError(e.wait
      ? "Troppi invii ravvicinati. Riprova tra circa " + Math.ceil(e.wait / 60) + " minuti."
      : "Invio non riuscito. Riprova.");
    $("next").disabled = false;
  }
}

function showResult(r){
  $("quiz").hidden = true;
  const out = $("result"); out.hidden = false; out.innerHTML = "";
  const msg = document.createElement("p");
  if (!r.passed) {
    msg.className = "msg ko";
    msg.textContent = "Hai risposto correttamente a " + r.score + " domande su " + r.total + ". Ne servono almeno " + r.needed + ".";
    const b = document.createElement("button"); b.textContent = "Riprova";
    b.onclick = start;
    out.append(msg, b);
    return;
  }
  if (r.hunt && !r.code) { // caccia al tesoro attiva: quiz superato, ma mancano ancora delle tappe
    return renderHuntTicket(1 + r.huntFound, r.huntTotal + 1, null, false);
  }
  if (r.hunt) { // caccia al tesoro attiva, ma le tappe erano gia' tutte trovate: biglietto gia' completo
    return renderHuntTicket(r.huntTotal + 1, r.huntTotal + 1, r.code, r.reused);
  }
  const text = r.reused
    ? "Hai già completato questo quiz da questo telefono: ecco di nuovo il tuo biglietto."
    : "Ben fatto: " + r.score + " risposte giuste su " + r.total + ". Ecco il tuo biglietto.";
  showTicket(r.code, r.reused, text);
}

// Un QR come <img> (non <svg> inline): solo cosi' tenendoci premuto sopra (telefono) o col tasto destro
// (PC) il browser offre "Salva immagine" - e offre SOLO il QR, non il resto del biglietto.
function qrImg(text, alt){
  const img = document.createElement("img");
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(qrSvg(text, 5, 2));
  img.alt = alt;
  return img;
}

// Sposta la "finestra" visibile del biglietto dal basso verso l'alto: a fraction=0 e' invisibile,
// a fraction=1 e' mostrato per intero. Si vede sempre la parte BASSA per prima (dove sono QR e codice,
// pero' sfocati finche' non si sbloccano) e il resto del biglietto (logo, titolo) sale sopra di essa.
function setReveal(ticket, fraction){
  const hiddenTop = Math.max(0, Math.min(1, 1 - fraction)) * 100;
  ticket.style.clipPath = "inset(" + hiddenTop + "% 0 0 0)";
}

// Disegna il biglietto. "locked"=true mostra QR e codice sfocati, non quelli veri (che il server
// non rivela finche' la caccia al tesoro non e' completa): non c'e' nulla da leggere dietro la sfocatura.
function buildTicket(locked, code, msgText, note){
  $("start").hidden = true; $("quiz").hidden = true;
  const out = $("result"); out.hidden = false; out.innerHTML = "";
  const msg = document.createElement("p"); msg.className = "msg ok"; msg.textContent = msgText;

  const ticket = document.createElement("div"); ticket.className = "ticket" + (locked ? " locked" : "");
  const top = document.createElement("div"); top.className = "ticket-top";
  const logo = document.createElement("img"); logo.className = "ticket-logo"; logo.src = "bollo-bianco.png";
  logo.alt = "Croce Rossa Italiana - Comitato di Francavilla Fontana - Oria";
  const ev = document.createElement("p"); ev.className = "ticket-event"; ev.textContent = quizTitle;
  top.append(logo, ev);

  const perf = document.createElement("div"); perf.className = "ticket-perf";
  const nl = document.createElement("span"); nl.className = "notch notch-l";
  const nr = document.createElement("span"); nr.className = "notch notch-r";
  perf.append(nl, nr);

  const bottom = document.createElement("div"); bottom.className = "ticket-bottom";
  const qr = document.createElement("div"); qr.className = "ticket-qr";
  const adminUrl = new URL("admin.html", location.href).href + "#" + code;
  qr.append(qrImg(locked ? "CRI-QUIZ-HIV" : adminUrl, "QR del codice")); // bloccato: QR finto/non funzionante, e comunque sfocato
  const codeEl = document.createElement("div"); codeEl.className = "ticket-code"; codeEl.textContent = code;
  const noteEl = document.createElement("p"); noteEl.className = "ticket-note"; noteEl.textContent = note;
  bottom.append(qr, codeEl, noteEl);

  ticket.append(top, perf, bottom);
  const hint = document.createElement("p"); hint.className = "hint";
  hint.textContent = locked
    ? "Il biglietto si sblocca quando trovi tutte le tappe."
    : "Mostra questo biglietto e non perderlo: il codice vale una sola volta.";
  out.append(msg, ticket, hint);
  return ticket;
}

// Biglietto definitivo, col vero codice e il vero QR: usato quando la caccia al tesoro e' disattivata
// (come oggi) o appena completata.
function showTicket(code, reused, msgText){
  const ticket = buildTicket(false, code, msgText || (reused
    ? "Hai già completato questo quiz da questo telefono: ecco di nuovo il tuo biglietto."
    : "Ecco il tuo biglietto."), "codice valido una sola volta");
  setReveal(ticket, 1);
}

// Biglietto "a tappe" della caccia al tesoro: cresce dal basso verso l'alto ad ogni tappa trovata.
// Resta sfocato (QR e codice finti) finche' "code" non arriva dal server, cioe' finche' non sono
// state trovate tutte le tappe: prima di allora non c'e' nessun codice vero da proteggere o rivelare.
function renderHuntTicket(completed, total, code, reused){
  const fraction = total > 0 ? Math.min(1, completed / total) : 1;
  const locked = !code;
  const huntFound = completed - 1, huntTotal = total - 1;
  const msgText = locked
    ? "Hai superato il quiz. Tappe trovate: " + huntFound + " di " + huntTotal + "."
    : (reused
        ? "Hai già completato questo quiz da questo telefono: ecco di nuovo il tuo biglietto."
        : "Complimenti, hai trovato tutte le tappe: ecco il tuo biglietto.");
  const note = locked ? "trova tutte le tappe per sbloccarlo" : "codice valido una sola volta";
  const ticket = buildTicket(locked, locked ? "••••-••••" : code, msgText, note);
  // Parte da un pelo piu' in basso e sale fino al punto giusto: si vede il biglietto "salire" un po'
  // ad ogni tappa, anche quando la pagina si e' appena caricata.
  setReveal(ticket, Math.max(0, fraction - 1 / total));
  requestAnimationFrame(() => requestAnimationFrame(() => setReveal(ticket, fraction)));
}

// Se la pagina resta aperta e si scansiona un'altra tappa (stessa scheda), l'indirizzo cambia da solo:
// non serve ricaricare la pagina per accorgersene.
window.addEventListener("hashchange", () => {
  let m; try { m = location.hash.match(/^#tappa=([^&]+)/); } catch {}
  if (!m) return;
  const t = decodeURIComponent(m[1]); clearHash();
  handleHuntVisit(t).catch(() => showHuntNote("Server non raggiungibile: prova a scansionare di nuovo questo QR."));
});
