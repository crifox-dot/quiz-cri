const API = "https://steep-haze-2da0.cloudflare-vbmev.workers.dev";
const $ = (id) => document.getElementById(id);
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
let questions = [], version = 0, needed = 0, quizTitle = "Quiz sull'HIV";
let huntDistributeFlag = false; // caccia al tesoro con le domande sparse tra le tappe: si sa gia' al caricamento
let order = [], answers = {}, step = 0; // answers: { idDomanda: indiceRispostaScelta }

// Caccia al tesoro con le domande sparse tra le tappe: mentre si risponde alle domande DI UNA TAPPA
// (invece che al quiz intero), "huntMode" e' vero e "huntQs"/"huntStopToken" sostituiscono
// "questions"/l'invio a "/api/submit" - order/answers/step/render restano gli stessi.
let huntMode = false, huntQs = [], huntStopToken = null;

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
  huntDistributeFlag = !!d.huntDistribute;
  setTitle(quizTitle);
  $("lead").textContent = "Con almeno " + plural(needed, "risposta giusta", "risposte giuste") +
    " su " + questions.length + " ricevi un codice personale, valido una sola volta.";
}

loadQuestions().then(async () => {
  $("loadMsg").hidden = true;
  $("go").disabled = false;
  if (huntToken) {
    const t = huntToken; clearHash();
    try { await handleHuntVisit(t); } catch { showHuntNote("Server non raggiungibile: prova a scansionare di nuovo questo QR."); }
  } else if (huntDistributeFlag) {
    // le domande sono sparse tra le tappe: niente quiz intero da qui, bisogna trovare e scansionare i QR
    $("go").hidden = true;
    showHuntNote("Il quiz è diviso tra diversi QR sparsi in giro: scansiona con la fotocamera uno dei QR per iniziare a rispondere.");
  }
}).catch(() => { setTitle("Quiz sull'HIV"); $("loadMsg").textContent = "Impossibile caricare il quiz. Riprova più tardi."; });

function showHuntNote(text) {
  const p = $("huntNote"); p.textContent = text; p.hidden = false;
}

// Scansione di una tappa della caccia al tesoro (arrivata con "#tappa=" nell'indirizzo).
// Se la caccia al tesoro non e' attiva sul server, questa funzione non cambia nulla: resta la pagina normale.
async function handleHuntVisit(token) {
  huntStopToken = token;
  const r = await (await fetch(API + "/api/hunt/visit", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, visitor: visitorId() })
  })).json();
  await handleHuntResult(r);
}

// Invio delle risposte DI UNA TAPPA (caccia al tesoro con le domande sparse): invece di "/api/submit"
// (tutto il quiz in una volta) si manda solo la tappa appena risposta.
async function submitHuntStop(){
  try {
    const r = await (await fetch(API + "/api/hunt/visit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: huntStopToken, answers, visitor: visitorId() })
    })).json();
    if (r.error) throw new Error(r.error);
    await handleHuntResult(r);
  } catch {
    showError("Invio non riuscito. Riprova.");
    $("next").disabled = false;
  }
}

// Legge la risposta di "/api/hunt/visit" (sia una scansione che l'invio delle risposte di una tappa)
// e decide cosa mostrare: le domande di questa tappa, una nota di avanzamento, il biglietto a tappe
// (se completato e superato) o l'esito negativo (se completato ma il punteggio non basta).
async function handleHuntResult(r) {
  if (!r.enabled) return; // caccia al tesoro non attiva: pagina normale, nessun cambiamento
  if (!r.valid) return showHuntNote("Questo QR non è più valido.");

  if (!r.distribute) { // caccia al tesoro "classica": un unico quiz, le tappe si trovano in qualsiasi ordine
    if (!r.passed) return showHuntNote("Tappa trovata (" + r.found + " di " + r.total + "). Fai il quiz per continuare la caccia al tesoro.");
    return renderHuntTicket(1 + r.found, r.total + 1, r.code, r.reused, false);
  }

  // caccia al tesoro con le domande sparse tra le tappe
  if (r.questions && r.questions.length) {
    // la primissima tappa (nessun'altra ancora risposta) mostra prima la schermata iniziale, per
    // spiegare che il quiz e' diviso in piu' parti; dalla seconda tappa in poi si entra dritti nel quiz.
    if (!r.found) return showHuntStopIntro(r.questions);
    return startHuntStop(r.questions);
  }
  if ("passed" in r && r.found >= r.total) {
    if (r.passed) return renderHuntTicket(r.found, r.total, r.code, r.reused, true);
    return showHuntFail(r.score, r.needed, r.quizTotal);
  }
  renderHuntTicket(r.found, r.total, null, false, true);
}

function start(){
  huntMode = false;
  order = shuffle(questions.length);
  answers = {};
  step = 0;
  $("start").hidden = true; $("result").hidden = true; $("quiz").hidden = false;
  render();
}

// Prima tappa scansionata (caccia al tesoro con le domande sparse, nessun'altra tappa ancora risposta):
// mostra la schermata iniziale invece di entrare subito nel quiz, spiegando che e' diviso in piu' parti.
// Dalla seconda tappa in poi (vedi handleHuntResult) si salta questa schermata ed entra dritti nel quiz.
function showHuntStopIntro(qs){
  $("quiz").hidden = true; $("result").hidden = true; $("start").hidden = false;
  $("go").hidden = false; $("go").disabled = false;
  $("go").onclick = () => startHuntStop(qs);
  showHuntNote("Il quiz è diviso tra diversi QR sparsi in giro: questa è la prima parte.");
}

// Mostra solo le domande DI UNA TAPPA (caccia al tesoro con le domande sparse), riusando la stessa
// schermata "una domanda alla volta" del quiz intero.
function startHuntStop(qs){
  huntMode = true;
  huntQs = qs;
  order = shuffle(qs.length);
  answers = {};
  step = 0;
  $("start").hidden = true; $("result").hidden = true; $("quiz").hidden = false;
  render();
}

function render(){
  const qs = huntMode ? huntQs : questions;
  const x = qs[order[step]];
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
  if (huntMode) return submitHuntStop();
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
    await showResult(r);
  } catch (e) {
    showError(e.wait
      ? "Troppi invii ravvicinati. Riprova tra circa " + Math.ceil(e.wait / 60) + " minuti."
      : "Invio non riuscito. Riprova.");
    $("next").disabled = false;
  }
}

async function showResult(r){
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
    return renderHuntTicket(1 + r.huntFound, r.huntTotal + 1, null, false, r.huntDistribute);
  }
  if (r.hunt) { // caccia al tesoro attiva, ma le tappe erano gia' tutte trovate: biglietto gia' completo
    return renderHuntTicket(r.huntTotal + 1, r.huntTotal + 1, r.code, r.reused, r.huntDistribute);
  }
  const text = r.reused
    ? "Hai già completato questo quiz da questo telefono: ecco di nuovo il tuo biglietto."
    : "Ben fatto: " + r.score + " risposte giuste su " + r.total + ". Ecco il tuo biglietto.";
  await showTicket(r.code, r.reused, text);
}

// Un QR come <img> con una vera immagine PNG (non un <svg> disegnato nella pagina): solo cosi'
// tenendoci premuto sopra (telefono, "Aggiungi a Foto") o col tasto destro (PC) si puo' salvare il
// QR come immagine - e si salva SOLO il QR, non il resto del biglietto.
async function qrImg(text, alt){
  const img = document.createElement("img");
  img.src = await qrPng(text, 8, 2);
  img.alt = alt;
  return img;
}

// Sposta il biglietto in verticale: a fraction=0 e' spinto fuori dallo schermo, sotto al bordo
// inferiore (come se stesse per essere "stampato" da una fessura li' sotto); a fraction=1 e' fermo
// al suo posto, del tutto visibile. Aumentando "fraction" il biglietto sale.
function setReveal(ticket, fraction){
  const hiddenPercent = Math.max(0, Math.min(1, 1 - fraction)) * 100;
  ticket.style.transform = "translateY(" + hiddenPercent + "%)";
}

// Disegna il biglietto. "locked"=true mostra QR e codice sfocati, non quelli veri (che il server
// non rivela finche' la caccia al tesoro non e' completa): non c'e' nulla da leggere dietro la sfocatura.
// "docked"=true lo tiene agganciato in basso allo schermo (per l'animazione di "stampa" della caccia
// al tesoro); altrimenti resta semplicemente nella pagina, come il biglietto normale di sempre.
async function buildTicket(locked, docked, code, msgText, note, belowMsg){
  $("start").hidden = true; $("quiz").hidden = true;
  const out = $("result"); out.hidden = false; out.innerHTML = "";
  const msg = document.createElement("p"); msg.className = "msg ok"; msg.textContent = msgText;
  out.append(msg);
  if (belowMsg) { // es. durante la caccia al tesoro: "vai a cercare gli altri QR", subito sotto il riquadro
    const p = document.createElement("p"); p.className = "hint"; p.textContent = belowMsg;
    out.append(p);
  }

  const ticket = document.createElement("div");
  ticket.className = "ticket" + (locked ? " locked" : "") + (docked ? " docked" : "");
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
  qr.append(await qrImg(locked ? "CRI-QUIZ-HIV" : adminUrl, "QR del codice")); // bloccato: QR finto/non funzionante, e comunque sfocato
  const codeEl = document.createElement("div"); codeEl.className = "ticket-code"; codeEl.textContent = code;
  const noteEl = document.createElement("p"); noteEl.className = "ticket-note"; noteEl.textContent = note;
  bottom.append(qr, codeEl, noteEl);

  ticket.append(top, perf, bottom);
  out.append(ticket);
  if (!docked) { // il biglietto normale (fuori dalla caccia al tesoro) resta come sempre, con la sua nota
    const hint = document.createElement("p"); hint.className = "hint";
    hint.textContent = "Mostra questo biglietto e non perderlo: il codice vale una sola volta.";
    out.append(hint);
  }
  return ticket;
}

// Biglietto definitivo, col vero codice e il vero QR: usato quando la caccia al tesoro e' disattivata
// (come oggi) o appena completata.
async function showTicket(code, reused, msgText){
  await buildTicket(false, false, code, msgText || (reused
    ? "Hai già completato questo quiz da questo telefono: ecco di nuovo il tuo biglietto."
    : "Ecco il tuo biglietto."), "codice valido una sola volta");
}

// Biglietto "a tappe" della caccia al tesoro: resta agganciato in basso allo schermo e sale un po'
// di piu' ad ogni tappa trovata, come se stesse uscendo da una fessura sotto al bordo dello schermo.
// Resta sfocato (QR e codice finti) finche' "code" non arriva dal server, cioe' finche' non sono
// state trovate tutte le tappe: prima di allora non c'e' nessun codice vero da proteggere o rivelare.
// "found"/"total" sono le tappe; con la caccia "classica" (distribute=false) il quiz intero conta
// come un passo in piu' (per questo chi la chiama gli passa gia' "+1"), mentre con le domande sparse
// tra le tappe ogni tappa risposta e' gia' un passo pieno, senza bisogno di questo scalino iniziale.
const ORDINALI = ["zero", "prima", "seconda", "terza", "quarta", "quinta", "sesta", "settima", "ottava",
  "nona", "decima", "undicesima", "dodicesima", "tredicesima", "quattordicesima", "quindicesima",
  "sedicesima", "diciassettesima", "diciottesima", "diciannovesima", "ventesima"];
const ordinale = (n) => ORDINALI[n] || (n + "ª");

async function renderHuntTicket(found, total, code, reused, distribute){
  const fraction = total > 0 ? Math.min(1, found / total) : 1;
  const locked = !code;
  const huntFound = distribute ? found : found - 1, huntTotal = distribute ? total : total - 1;
  const msgText = locked
    ? (distribute
        ? "Hai superato la " + ordinale(huntFound) + " parte del quiz."
        : "Hai superato il quiz. Tappe trovate: " + huntFound + " di " + huntTotal + ".")
    : (reused
        ? "Hai già completato questo quiz da questo telefono: ecco di nuovo il tuo biglietto."
        : "Complimenti, hai trovato tutte le tappe: ecco il tuo biglietto.");
  const note = locked ? "trova tutte le tappe per sbloccarlo" : "codice valido una sola volta";
  const belowMsg = locked
    ? (distribute
        ? "Scansiona con la fotocamera gli altri QR sparsi in giro per poter completare il quiz :)"
        : "Scansiona con la fotocamera gli altri QR sparsi in giro: tranquillo, non ci sono altre domande :)")
    : null;
  const ticket = await buildTicket(locked, true, locked ? "••••-••••" : code, msgText, note, belowMsg);
  // Parte da un pelo piu' in basso e sale fino al punto giusto: si vede il biglietto "salire" un po'
  // ad ogni tappa, anche quando la pagina si e' appena caricata.
  setReveal(ticket, Math.max(0, fraction - 1 / total));
  requestAnimationFrame(() => requestAnimationFrame(() => setReveal(ticket, fraction)));
}

// Caccia al tesoro con le domande sparse: tutte le tappe sono state trovate e risposte, ma il
// punteggio complessivo non basta. Si puo' tornare a scansionare una tappa per cambiare le risposte.
function showHuntFail(score, needed, total){
  $("start").hidden = true; $("quiz").hidden = true;
  const out = $("result"); out.hidden = false; out.innerHTML = "";
  const msg = document.createElement("p"); msg.className = "msg ko";
  msg.textContent = "Hai risposto correttamente a " + score + " domande su " + total + ". Ne servono almeno " + needed + ".";
  const hint = document.createElement("p"); hint.className = "hint";
  hint.textContent = "Torna a scansionare con la fotocamera una delle tappe per cambiare le risposte e riprovare.";
  out.append(msg, hint);
}

// Se la pagina resta aperta e si scansiona un'altra tappa (stessa scheda), l'indirizzo cambia da solo:
// non serve ricaricare la pagina per accorgersene.
window.addEventListener("hashchange", () => {
  let m; try { m = location.hash.match(/^#tappa=([^&]+)/); } catch {}
  if (!m) return;
  const t = decodeURIComponent(m[1]); clearHash();
  handleHuntVisit(t).catch(() => showHuntNote("Server non raggiungibile: prova a scansionare di nuovo questo QR."));
});
