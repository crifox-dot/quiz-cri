const API = "https://steep-haze-2da0.cloudflare-vbmev.workers.dev";
const $ = (id) => document.getElementById(id);
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
let questions = [], version = 0, needed = 0, quizTitle = "Quiz sull'HIV", quizSubtitle = "";
let huntDistributeFlag = false; // caccia al tesoro con le domande sparse tra le tappe: si sa gia' al caricamento
let huntEnabledFlag = false; // caccia al tesoro attiva (classica o con domande sparse, non importa quale)
let order = [], answers = {}, step = 0; // answers: { idDomanda: indiceRispostaScelta }
// Modalita' classifica (accesa dal pannello domande): si gioca con un nickname e si ricevono punti.
// "ticketOn" = il biglietto col codice viene creato (sempre, se la classifica e' spenta).
// "player" = { nick, played, score, streak } di questo browser, oppure null se non ha ancora un nickname.
let classifica = false, ticketOn = true, player = null;
// Domande gia' sbagliate e non ancora recuperate: quando le si riprova il timer non parte.
const missed = new Set();
const setMissed = (ids) => { missed.clear(); (ids || []).forEach((id) => missed.add(id)); };
// Timer (solo con la classifica): secondi a disposizione per ogni domanda, 0 = spento. Rispondere presto
// vale di piu': verde x2, giallo x1,5, rosso x1,2, tempo scaduto x1 (si puo' comunque rispondere).
let timerSec = 0;
const timed = () => classifica && timerSec > 0;

// Caccia al tesoro con le domande sparse tra le tappe: mentre si risponde alle domande DI UNA TAPPA
// (invece che al quiz intero), "huntMode" e' vero e "huntQs"/"huntStopToken" sostituiscono
// "questions"/l'invio a "/api/submit" - order/answers/step/render restano gli stessi.
let huntMode = false, huntQs = [], huntStopToken = null;

// Caccia al tesoro: il QR di una tappa porta qui con "#tappa=TOKEN" nell'indirizzo.
// Se la caccia al tesoro non e' attiva, questo pezzo di codice non fa nulla: il sito resta come sempre.
let huntToken = null;
try { const m = location.hash.match(/^#tappa=([^&]+)/); if (m) huntToken = decodeURIComponent(m[1]); } catch {}
const clearHash = () => history.replaceState(null, "", location.pathname + location.search);
// Arrivo da un QR: gli elementi della schermata iniziale restano invisibili finche' il server non dice
// cosa mostrare, cosi' possono poi comparire tutti insieme con l'effetto "nuvola" (grafica nuova).
if (huntToken) $("start").classList.add("pending");

// Sito in manutenzione (acceso dal pannello domande): il server non risponde piu' al quiz e alla caccia
// al tesoro, e la pagina mostra solo l'avviso. Vale anche se la manutenzione inizia mentre si risponde.
function showMaintenance(){
  flowId++; // un risultato ancora in arrivo non deve piu' comparire
  ["start", "quiz", "result"].forEach((id) => { $(id).hidden = true; });
  document.documentElement.classList.remove("quiz-enter", "quiz-leave");
  window.removeEventListener("resize", dockRelayout);
  $("maint").hidden = false;
  // grafica e scritte del logo: in manutenzione non arrivano con le domande, si chiedono a parte
  fetch(API + "/api/grafica").then((r) => r.json()).then((d) => {
    if (window.setGrafica && d.grafica) window.setGrafica(d.grafica);
    if (window.setSticker && d.sticker) window.setSticker(d.sticker);
  }).catch(() => {});
}
const maintenanceError = () => Object.assign(new Error("manutenzione"), { maintenance: true });

// Le animazioni valgono solo per la grafica nuova, e mai se il dispositivo chiede meno movimento.
const fancy = () => document.documentElement.classList.contains("ui-nuova") &&
  !(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

// Effetto "nuvola": titolo, sottotitolo, pulsante e avviso compaiono uno dopo l'altro, gonfiandosi da sfocati.
let cloudTimer = null;
function cloudIn(){
  const st = $("start");
  st.classList.remove("pending", "cloud");
  if (st.hidden || !fancy()) return;
  void st.offsetWidth; // fa ripartire l'animazione anche se era gia' stata fatta
  st.classList.add("cloud");
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => st.classList.remove("cloud"), 1300);
}

// Passaggio dalla schermata iniziale (o dal risultato) alle domande. Nella grafica nuova: gli elementi
// della schermata iniziale svaniscono, poi la fascia delle domande scende come una tenda (con un piccolo
// rimbalzo) e le risposte compaiono una dopo l'altra. Le domande sono comunque subito pronte nella pagina.
let leaveTimer = null, enterTimer = null;
function endLeave(){
  clearTimeout(leaveTimer);
  const st = $("start");
  st.hidden = true; st.classList.remove("leaving", "cloud", "pending"); st.style.cssText = "";
}
function openQuiz(){
  const st = $("start"), animate = fancy();
  if (animate && !st.hidden && !st.classList.contains("leaving") && !st.classList.contains("pending")) {
    // resta dov'e' (fissata allo schermo) mentre svanisce, senza spostare le domande che arrivano sotto
    const r = st.getBoundingClientRect();
    st.style.cssText = "position:fixed;margin:0;top:" + r.top + "px;left:" + r.left + "px;width:" + r.width + "px";
    st.classList.remove("cloud", "pending"); st.classList.add("leaving");
    clearTimeout(leaveTimer); leaveTimer = setTimeout(endLeave, 430);
  } else if (!st.classList.contains("leaving")) endLeave();
  $("result").hidden = true; $("quiz").hidden = false;
  document.documentElement.classList.remove("quiz-leave"); $("quiz").classList.remove("leaving"); // se stava ancora chiudendosi
  return animate;
}
// da chiamare dopo render(): serve l'altezza della fascia (dipende da quanto e' lunga la domanda)
function dropCurtain(){
  const root = document.documentElement, quiz = $("quiz");
  const bottom = $("qtext").getBoundingClientRect().bottom + window.scrollY + 24;
  root.style.setProperty("--band-h", Math.max(120, Math.round(bottom)) + "px");
  root.classList.remove("quiz-enter"); quiz.classList.remove("enter");
  void quiz.offsetWidth;
  root.classList.add("quiz-enter"); quiz.classList.add("enter");
  clearTimeout(enterTimer); enterTimer = setTimeout(endEnter, 1700);
}
function endEnter(){
  clearTimeout(enterTimer);
  document.documentElement.classList.remove("quiz-enter"); $("quiz").classList.remove("enter");
}

// Fine del quiz (superato o no), grafica nuova: le risposte svaniscono, i pulsanti scendono e la fascia
// risale come una tenda; solo dopo si mostra il risultato. Senza animazioni non aspetta nulla.
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function closeQuiz(){
  const quiz = $("quiz");
  if (quiz.hidden || !fancy()) return false;
  endEnter();
  const root = document.documentElement;
  root.style.setProperty("--band-h", Math.max(120, Math.round($("qtext").getBoundingClientRect().bottom + window.scrollY + 24)) + "px");
  root.classList.add("quiz-leave"); quiz.classList.add("leaving");
  const mine = flowId;
  await pause(560);
  root.classList.remove("quiz-leave"); quiz.classList.remove("leaving");
  if (mine !== flowId) return false; // nel frattempo e' stato scansionato un altro QR: le domande in vista sono gia' le sue
  quiz.hidden = true;
  return true;
}
// ...e gli elementi del risultato compaiono uno dopo l'altro (come quelli della schermata iniziale);
// il biglietto, se non e' quello agganciato in basso della caccia al tesoro, sale dal fondo dello schermo.
let arriveTimer = null;
function arriveResult(){
  const out = $("result");
  if (out.hidden || !fancy()) return;
  out.classList.remove("arrive"); void out.offsetWidth; out.classList.add("arrive");
  const t = out.querySelector(".ticket:not(.docked):not(.rise)");
  if (t) t.classList.add("rise");
  clearTimeout(arriveTimer); arriveTimer = setTimeout(() => out.classList.remove("arrive"), 1500);
}

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
// "big" e' la scritta grande della pagina iniziale: se l'editor non ne ha scritta una, e' il titolo stesso.
function setTitle(t, big){
  const text = big || t;
  const h = $("title"); h.textContent = "";
  const m = text.match(/^(.*?)([^\s']+)$/);
  if (m && m[1]) { h.append(m[1]); const em = document.createElement("em"); em.textContent = m[2]; h.append(em); }
  else h.textContent = text;
  document.title = t + " · CRI Francavilla Fontana - Oria";
}

// Scarica le domande attuali (numero e soglia possono cambiare quando il Comitato le modifica)
async function loadQuestions(){
  const d = await (await fetch(API + "/api/questions")).json();
  if (d.maintenance) throw maintenanceError();
  if (!d.questions) throw new Error("risposta non valida");
  if (window.qrSetColors) qrSetColors(d.qr); // colori del QR sul biglietto, scelti nel pannello domande
  questions = d.questions; version = d.version; needed = d.needed;
  classifica = !!d.classifica; ticketOn = d.ticket !== false;
  timerSec = classifica && d.timer > 0 ? d.timer : 0;
  quizTitle = d.title || "Quiz sull'HIV";
  huntDistributeFlag = !!d.huntDistribute;
  huntEnabledFlag = !!d.hunt;
  if (window.setGrafica && d.grafica) window.setGrafica(d.grafica);
  setTitle(quizTitle, typeof d.headline === "string" ? d.headline : "");
  if (window.setSticker && d.sticker) window.setSticker(d.sticker); // scritte del logo in alto a sinistra
  // Sottotitolo: quello scritto nel pannello domande (con {giuste} e {domande} sostituiti dai numeri
  // veri), oppure, se e' vuoto, la frase automatica di sempre.
  quizSubtitle = typeof d.subtitle === "string" ? d.subtitle : "";
  $("lead").textContent = quizSubtitle
    ? quizSubtitle.replace(/\{giuste\}/gi, needed).replace(/\{domande\}/gi, questions.length)
    : !ticketOn
      ? "Rispondi alle " + questions.length + " domande: ogni risposta giusta vale punti, e quelle giuste di fila ne valgono di più. Scala la classifica!"
      : "Con almeno " + plural(needed, "risposta giusta", "risposte giuste") +
        " su " + questions.length + " ricevi un codice personale, valido una sola volta." +
        (classifica ? " Ogni risposta giusta vale anche punti per la classifica." : "");
  $("nBadge").textContent = plural(questions.length, "domanda", "domande"); // etichetta sul titolo (grafica nuova)
}

// Controlla se questo browser ha gia' un codice da prima (es. pagina ricaricata dopo averlo
// ottenuto, anche a distanza di giorni entro la scadenza del codice): in tal caso non ha senso far
// rifare il quiz o la caccia al tesoro da capo a chi l'ha gia' completata.
// Con la classifica attiva la stessa risposta dice anche se questo browser ha gia' un nickname e dei punti.
async function checkExistingCode(){
  const vid = visitorId();
  if (!vid) return null;
  const r = await (await fetch(API + "/api/mycode", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitor: vid }),
  })).json();
  if (r.player) { player = r.player; setMissed(r.player.missed); }
  return r.code || null;
}

// ---------- modalita' classifica: nickname ----------
// Schermata iniziale: chi non ha ancora un nickname lo sceglie qui (solo lettere); chi ce l'ha vede con
// quale nome gioca. Il pulsante "Classifica" c'e' sempre, ma la classifica si scarica solo premendolo.
function updateStartForMode(){
  const box = $("nickBox"), as = $("nickAs");
  $("boardBtn").hidden = !classifica;
  box.hidden = !classifica || !!player;
  as.hidden = !classifica || !player;
  if (classifica && player) {
    as.textContent = "Giochi come " + player.nick + "." + (player.played
      ? " Hai già giocato: " + plural(player.score, "punto", "punti") + ". Puoi rifare il quiz: una domanda che avevi sbagliato, se ora la indovini, vale la metà."
      : "");
  }
}
const NICK_HELP = "Da 3 a 16 lettere, senza numeri né spazi. Comparirà in classifica: non usare il tuo vero nome.";
function nickError(text){
  const m = $("nickMsg"); m.textContent = text || NICK_HELP; m.classList.toggle("ko", !!text);
  $("nick").classList.toggle("bad", !!text);
}
// Prima di iniziare: se serve un nickname lo registra. Restituisce false se non si puo' ancora partire.
async function ensureNick(){
  if (!classifica || player) return true;
  const nick = $("nick").value.trim();
  if (!/^[A-Za-z]+$/.test(nick)) { nickError("Il nickname può avere solo lettere (dalla A alla Z), senza spazi, numeri o simboli."); $("nick").focus(); return false; }
  if (nick.length < 3 || nick.length > 16) { nickError("Il nickname deve avere da 3 a 16 lettere."); $("nick").focus(); return false; }
  try {
    const res = await fetch(API + "/api/nick", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitor: visitorId(), nick }),
    });
    const r = await res.json();
    if (r.maintenance) { showMaintenance(); return false; }
    if (!res.ok) { nickError(r.error || "Nickname non accettato: scegline un altro."); $("nick").focus(); return false; }
    player = { nick: r.nick, played: !!r.locked };
    nickError(""); updateStartForMode();
    return true;
  } catch {
    nickError("Server non raggiungibile: riprova tra poco.");
    return false;
  }
}

loadQuestions().then(async () => {
  $("loadMsg").hidden = true;
  // Domande sparse tra le tappe: da qui il quiz intero non si fa MAI, quindi il pulsante "Inizia" sparisce
  // subito (prima di qualsiasi attesa): ricompare solo dopo la scansione di una tappa, per quella tappa.
  if (huntDistributeFlag) $("go").hidden = true;
  if (huntToken) {
    $("go").disabled = false;
    const t = huntToken; clearHash();
    try { await handleHuntVisit(t); } catch { showHuntNote("Server non raggiungibile: prova a scansionare di nuovo questo QR."); }
    updateStartForMode();
    cloudIn(); // se dopo la scansione si vede la schermata iniziale, i suoi elementi compaiono "a nuvola"
    return;
  }
  let already = null;
  try { already = await checkExistingCode(); } catch {} // offline/errore: si procede come se non ci fosse
  $("go").disabled = false; // solo ora: prima non si sa ancora se c'e' gia' un biglietto o un nickname
  updateStartForMode();
  if (already) {
    return huntEnabledFlag
      ? renderHuntTicket(1, 1, already, true, huntDistributeFlag)
      : showTicket(already, true);
  }
  if (huntDistributeFlag) {
    // le domande sono sparse tra le tappe: niente quiz intero da qui, bisogna trovare e scansionare i QR
    $("go").hidden = true;
    showHuntNote("Il quiz è diviso tra diversi QR sparsi in giro: scansiona con la fotocamera uno dei QR per iniziare a rispondere.");
  }
}).catch((e) => { if (e && e.maintenance) return showMaintenance(); $("start").classList.remove("pending"); setTitle("Quiz sull'HIV"); $("loadMsg").textContent = "Impossibile caricare il quiz. Riprova più tardi."; });

function showHuntNote(text) {
  const p = $("huntNote"); p.textContent = text; p.hidden = false;
}

// Scansione di una tappa della caccia al tesoro (arrivata con "#tappa=" nell'indirizzo).
// Se la caccia al tesoro non e' attiva sul server, questa funzione non cambia nulla: resta la pagina normale.
// Cresce a ogni QR scansionato: se un risultato del quiz arriva (dopo l'animazione di chiusura) quando nel
// frattempo e' stata scansionata un'altra tappa, quel risultato e' gia' vecchio e non va piu' mostrato.
let flowId = 0;
async function handleHuntVisit(token) {
  flowId++;
  if (token !== huntStopToken) huntWrong = {}; // un'altra tappa: le risposte sbagliate segnate valevano per la precedente
  huntStopToken = token;
  const r = await (await fetch(API + "/api/hunt/visit", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, visitor: visitorId() })
  })).json();
  if (r.maintenance) return showMaintenance();
  syncMode(r);
  await handleHuntResult(r);
}
// Le risposte della caccia al tesoro dicono anche se il biglietto e' attivo e, con la classifica, con
// quale nickname gioca questo browser (null = non l'ha ancora scelto).
function syncMode(r){
  if (typeof r.ticket === "boolean") ticketOn = r.ticket;
  if (Array.isArray(r.missed)) setMissed(r.missed);
  if ("nick" in r) {
    if (r.nick) player = Object.assign(player || { played: false }, { nick: r.nick });
    else player = null;
  }
}

// Invio delle risposte DI UNA TAPPA (caccia al tesoro con le domande sparse): invece di "/api/submit"
// (tutto il quiz in una volta) si manda solo la tappa appena risposta.
async function submitHuntStop(){
  try {
    const r = await (await fetch(API + "/api/hunt/visit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: huntStopToken, answers, order: order.map((i) => huntQs[i].id), times: timed() ? times : undefined, visitor: visitorId() })
    })).json();
    if (r.maintenance) return showMaintenance();
    if (r.error) throw new Error(r.error);
    syncMode(r);
    // la tappa e' finita (non ci sono domande da rifare): animazione di chiusura, poi il risultato
    const done = !r.retry && !(r.questions && r.questions.length) && r.enabled && r.valid;
    const mine = flowId;
    const closed = done && await closeQuiz();
    if (mine !== flowId) return;
    await handleHuntResult(r);
    if (closed) arriveResult();
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

  if (r.retry) {
    // domande sparse tra le tappe: alcune risposte di questa tappa erano sbagliate. Si rifanno SOLO
    // quelle (tornare a cercare di nuovo tutti i QR per un errore sarebbe troppo faticoso).
    const n = r.questions.length;
    // ci si ricorda quale risposta era stata scelta per ognuna: al nuovo giro resta segnata in rosso
    for (const q of r.questions) {
      if (answers[q.id] === undefined) continue;
      (huntWrong[q.id] = huntWrong[q.id] || []).push(answers[q.id]);
    }
    return startHuntStop(r.questions, "Hai risposto in modo sbagliato a " + plural(n, "domanda", "domande") +
      " di questa tappa: rispondi di nuovo solo a " + (n === 1 ? "questa." : "queste."));
  }

  const c = r.classifica || null; // punti fin qui (modalita' classifica)
  if (!r.distribute) { // caccia al tesoro "classica": un unico quiz, le tappe si trovano in qualsiasi ordine
    if (!ticketOn) { // biglietto disattivato: delle tappe resta solo il conto
      const n = "Tappa trovata (" + r.found + " di " + r.total + ").";
      return showHuntNote(r.found >= r.total ? "Hai trovato tutte le " + r.total + " tappe!"
        : r.passed ? n : n + " Fai il quiz per entrare in classifica.");
    }
    if (!r.passed) return showHuntNote("Tappa trovata (" + r.found + " di " + r.total + "). Fai il quiz per continuare la caccia al tesoro.");
    return renderHuntTicket(1 + r.found, r.total + 1, r.code, r.reused, false);
  }

  // caccia al tesoro con le domande sparse tra le tappe
  if (r.questions && r.questions.length) {
    // la primissima tappa (nessun'altra ancora risposta) mostra prima la schermata iniziale, per
    // spiegare che il quiz e' diviso in piu' parti; dalla seconda tappa in poi si entra dritti nel quiz.
    // Con la classifica, la schermata iniziale serve anche a chi non ha ancora scelto il nickname.
    if (!r.found || (classifica && !player)) return showHuntStopIntro(r.questions, !!r.found);
    return startHuntStop(r.questions);
  }
  if ("passed" in r && r.found >= r.total) {
    if (!ticketOn) return showScore({ score: r.score, total: r.quizTotal, classifica: c, huntDone: true });
    if (r.passed) return renderHuntTicket(r.found, r.total, r.code, r.reused, true, lbNodes(c));
    return showHuntFail(r.score, r.needed, r.quizTotal, c);
  }
  if (!ticketOn) return showHuntPart(r.found, r.total, c);
  renderHuntTicket(r.found, r.total, null, false, true, lbNodes(c, true));
}

// ---------- timer ----------
// Il tempo di ogni domanda parte 1,5 secondi dopo che sono comparse le risposte (piu' il tempo della loro
// animazione) e si ferma premendo Avanti. Continua anche se si esce dalla pagina. I tempi si mandano al
// server insieme alle risposte; il server sa quando la partita e' iniziata ("/api/start") e controlla il totale.
const TIMER_WAIT_MS = 1500;
let times = {}, qStart = 0, timerRaf = 0, startSent = null, firstQuestion = true;
function beginTimedGame(){
  times = {}; firstQuestion = true;
  if (!timed()) { startSent = null; return; }
  startSent = fetch(API + "/api/start", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitor: visitorId() }),
  }).then((r) => r.json()).catch(() => null);
}
// Fasi (frazione del tempo, classe): servono al colore e ai punti - verde x2, giallo x1,5, rosso x1,2, poi x1
const TIMER_PHASES = [[0.5, "green"], [0.8, "yellow"], [1, "red"]];
const SAND_TOP = 11, SAND_H = 13, SAND_BOT = 39; // dove sta la sabbia nel disegno della clessidra
function drawTimer(){
  const box = $("timer");
  if ($("quiz").hidden || !timed() || box.hidden) { timerRaf = 0; return; }
  const lim = timerSec * 1000, el = Date.now() - qStart;
  const f = Math.max(0, Math.min(1, el / lim));
  const ph = el < 0 ? "wait" : ((TIMER_PHASES.find((p) => f < p[0]) || [1, "over"])[1]);
  if (box.dataset.phase !== ph) {
    const from = box.dataset.phase;
    box.dataset.phase = ph;
    // finita l'attesa la clessidra si gira (la sabbia, che era tutta in basso, si ritrova in alto) e il tempo parte
    box.className = "timer " + ph + (ph === "green" && from === "wait" ? " flip" : "");
    // per chi usa un lettore di schermo: si annuncia solo il cambio di fase, non ogni istante
    $("tsay").textContent = ph === "over" ? "Tempo scaduto: puoi ancora rispondere."
      : ph === "wait" ? "" : ph === "green" ? "Il tempo è partito." : ph === "yellow" ? "Metà del tempo passata." : "Il tempo sta per finire.";
  }
  // In attesa: clessidra ferma, sabbia tutta in basso. Poi la sabbia scende dall'alto al basso; a tempo
  // scaduto e' di nuovo tutta in basso.
  const run = el >= 0, top = run ? SAND_H * (1 - f) : 0, bot = run ? SAND_H * f : SAND_H;
  $("sandTop").setAttribute("y", SAND_TOP + SAND_H - top); $("sandTop").setAttribute("height", top);
  $("sandBot").setAttribute("y", SAND_BOT - bot); $("sandBot").setAttribute("height", bot);
  $("sandFall").setAttribute("height", run && f < 1 ? SAND_BOT - 23 : 0);
  $("tfill").style.width = ((1 - f) * 100) + "%";
  timerRaf = f >= 1 ? 0 : requestAnimationFrame(drawTimer);
}
// Da chiamare quando compare una domanda. "retry" = domanda gia' sbagliata che si sta riprovando: per
// quella il timer non parte (e non c'e' bonus di velocita').
function startQuestionTimer(retry){
  cancelAnimationFrame(timerRaf); timerRaf = 0;
  const box = $("timer");
  if (!timed() || retry) { box.hidden = true; qStart = 0; return; }
  // attesa: 1,5 s da quando le risposte sono comparse (con le animazioni della grafica nuova compaiono piu' tardi)
  const anim = fancy() ? (firstQuestion ? 1500 : 650) : 0;
  firstQuestion = false;
  qStart = Date.now() + anim + TIMER_WAIT_MS;
  box.hidden = false; box.dataset.phase = "";
  drawTimer();
}
// premendo Avanti: si registra il tempo della domanda in vista
function stopQuestionTimer(id){
  if (!timed()) return;
  cancelAnimationFrame(timerRaf); timerRaf = 0;
  if (qStart) times[id] = Math.max(0, Math.round(Date.now() - qStart)); // senza timer (domanda riprovata) nessun tempo
}
// tornando sulla pagina il disegno riprende dal punto giusto (il tempo intanto e' passato)
document.addEventListener("visibilitychange", () => { if (!document.hidden && timed() && !$("quiz").hidden && !timerRaf) drawTimer(); });

function start(){
  if (huntDistributeFlag) return; // domande sparse tra le tappe: il quiz intero non esiste (lo rifiuta anche il server)
  huntMode = false;
  beginTimedGame();
  order = shuffle(questions.length);
  answers = {};
  step = 0;
  const animate = openQuiz();
  $("quizNote").hidden = true; $("quizNote").innerHTML = "";
  render();
  if (animate) dropCurtain();
}

// Caccia al tesoro con le domande sparse: risposte gia' date e risultate sbagliate in questa tappa
// ({ idDomanda: [indici] }). Quando si rifanno le domande restano segnate in rosso e non si possono riscegliere.
let huntWrong = {};

// Prima tappa scansionata (caccia al tesoro con le domande sparse, nessun'altra tappa ancora risposta):
// mostra la schermata iniziale invece di entrare subito nel quiz, spiegando che e' diviso in piu' parti.
// Dalla seconda tappa in poi (vedi handleHuntResult) si salta questa schermata ed entra dritti nel quiz.
function showHuntStopIntro(qs, notFirst){
  $("quiz").hidden = true; $("result").hidden = true; $("start").hidden = false;
  $("go").hidden = false; $("go").disabled = false;
  goAction = () => startHuntStop(qs);
  updateStartForMode();
  showHuntNote(notFirst ? "Il quiz è diviso tra diversi QR sparsi in giro: scegli un nickname per continuare."
    : "Il quiz è diviso tra diversi QR sparsi in giro: questa è la prima parte.");
}

// Mostra solo le domande DI UNA TAPPA (caccia al tesoro con le domande sparse), riusando la stessa
// schermata "una domanda alla volta" del quiz intero. "note", se presente, resta visibile sotto la
// barra di avanzamento per tutto il giro di domande (usata per il messaggio "rifai solo queste").
function startHuntStop(qs, note){
  huntMode = true;
  beginTimedGame();
  huntQs = qs;
  order = shuffle(qs.length);
  answers = {};
  step = 0;
  const animate = openQuiz();
  const qn = $("quizNote");
  // Stesso riquadro rosso usato per dire che un codice/QR non e' valido (vedi showError e admin.js),
  // cosi' l'avviso "hai risposto male" si nota allo stesso modo di un errore.
  if (note) { qn.innerHTML = '<p class="msg ko"></p>'; qn.firstChild.textContent = note; qn.hidden = false; }
  else { qn.hidden = true; qn.innerHTML = ""; }
  render();
  if (animate) dropCurtain();
}

function render(){
  const qs = huntMode ? huntQs : questions;
  const x = qs[order[step]];
  // "Domanda " si nasconde nella grafica nuova (resta "3 di 8" accanto alla barra, come nel design)
  const word = document.createElement("span"); word.className = "n-hide"; word.textContent = "Domanda ";
  $("count").replaceChildren(word, (step + 1) + " di " + order.length);
  const pct = (step / order.length * 100) + "%";
  $("bar").style.width = pct;
  $("dot").style.left = pct; // pallino della grafica nuova: si muove per primo, la barra lo segue
  $("qtext").textContent = x.q;
  const box = $("opts"); box.innerHTML = "";
  x.o.forEach((t, j) => {
    const l = document.createElement("label");
    const r = document.createElement("input");
    r.type = "radio"; r.name = "opt"; r.value = j; r.checked = answers[x.id] === j;
    r.onchange = () => {
      answers[x.id] = j; $("next").disabled = false;
      // grafica nuova: la risposta appena scelta "sobbalza" con due stelline (il colore cambia come prima)
      box.querySelectorAll("label.picked").forEach((el) => el.classList.remove("picked"));
      l.classList.add("picked");
    };
    const s = document.createElement("span"); s.textContent = t;
    l.append(r, s); box.append(l);
    if (huntMode && (huntWrong[x.id] || []).includes(j)) { // risposta gia' data e sbagliata: rossa, non riselezionabile
      l.classList.add("was-wrong"); r.disabled = true; r.checked = false;
      const w = document.createElement("span"); w.className = "vh"; w.textContent = " (risposta sbagliata, già provata)";
      l.append(w);
    }
  });
  $("next").disabled = answers[x.id] === undefined;
  $("next").textContent = step === order.length - 1 ? "Invia le risposte" : "Avanti";
  $("back").hidden = step === 0 || timed(); // col timer non si torna indietro: la risposta si blocca con Avanti
  $("err").innerHTML = "";
  startQuestionTimer(missed.has(x.id) || (huntMode && (huntWrong[x.id] || []).length > 0));
}

function showError(text){
  $("err").innerHTML = '<p class="msg ko"></p>';
  $("err").firstChild.textContent = text;
}

// "Inizia il quiz": di solito fa partire il quiz intero; dopo la scansione di una tappa (domande sparse)
// fa partire le domande di quella tappa. Con la classifica, prima registra il nickname se manca.
let goAction = start;
$("go").onclick = async () => {
  $("go").disabled = true;
  let ready = false;
  try { ready = await ensureNick(); } finally { $("go").disabled = false; }
  if (ready) goAction();
};
$("nick").onkeydown = (e) => { if (e.key === "Enter") $("go").click(); };
$("nick").oninput = () => { if ($("nickMsg").classList.contains("ko")) nickError(""); };
$("boardBtn").onclick = showBoardScreen;
$("back").onclick = () => { endEnter(); step--; render(); };
$("next").onclick = () => {
  endEnter();
  const qs = huntMode ? huntQs : questions;
  stopQuestionTimer(qs[order[step]].id);
  if (step < order.length - 1) { step++; render(); } else submit();
};

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
  if (startSent) await startSent; // l'inizio della partita deve essere arrivato al server prima delle risposte
  if (huntMode) return submitHuntStop();
  try {
    const r = await (await fetch(API + "/api/submit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version, answers, order: order.map((i) => questions[i].id), times: timed() ? times : undefined, visitor: visitorId() })
    })).json();
    if (r.maintenance) return showMaintenance();
    if (r.stale) { // le domande sono state aggiornate mentre rispondevi: si riparte con quelle nuove
      await loadQuestions(); start();
      showError("Il quiz è stato aggiornato mentre rispondevi: ricominciamo dalla prima domanda.");
      return;
    }
    if (r.huntOnly) { // nel frattempo sono state attivate le domande sparse tra le tappe: il quiz intero non vale
      huntDistributeFlag = true; $("quiz").hidden = true; $("start").hidden = false; $("go").hidden = true;
      showHuntNote("Il quiz è diviso tra diversi QR sparsi in giro: scansiona con la fotocamera uno dei QR per iniziare a rispondere.");
      return;
    }
    if (r.needNick) { // il nickname non c'e' piu' (classifica eliminata nel frattempo): si torna a sceglierlo
      player = null; $("quiz").hidden = true; $("start").hidden = false; updateStartForMode();
      nickError("Scegli un nickname per inviare le risposte."); return;
    }
    if (r.error) { const e = new Error(r.error); e.wait = r.retryAfter; throw e; }
    if (typeof r.ticket === "boolean") ticketOn = r.ticket;
    if (r.classifica && player) Object.assign(player, { played: true, score: r.classifica.xp, streak: r.classifica.streak });
    if (r.classifica && Array.isArray(r.classifica.wrong)) { // sbagliate ora: da riprovare senza timer; indovinate: non piu'
      for (const q of questions) missed.delete(q.id);
      r.classifica.wrong.forEach((id) => missed.add(id));
    }
    const mine = flowId;
    const closed = await closeQuiz();
    if (mine !== flowId) return;
    await showResult(r);
    if (closed) arriveResult();
  } catch (e) {
    if (e && e.maintenance) return showMaintenance();
    showError(e.wait
      ? "Troppi invii ravvicinati. Riprova tra circa " + Math.ceil(e.wait / 60) + " minuti."
      : "Invio non riuscito. Riprova.");
    $("next").disabled = false;
  }
}

async function showResult(r){
  $("quiz").hidden = true;
  const c = r.classifica || null; // modalita' classifica: punti, serie, domande sbagliate, classifica
  if (!ticketOn) return showScore(r); // biglietto disattivato: solo punti e classifica
  const out = $("result"); out.hidden = false; out.innerHTML = "";
  const msg = document.createElement("p");
  if (!r.passed) {
    msg.className = "msg ko";
    msg.textContent = "Hai risposto correttamente a " + r.score + " domande su " + r.total + ". Ne servono almeno " + r.needed + ".";
    const b = document.createElement("button"); b.textContent = "Riprova"; b.className = "n-retry";
    b.onclick = start;
    out.append(...scoreBadge(r.score, r.total, r.needed), msg, ...lbNodes(c), b);
    return;
  }
  if (r.hunt && !r.code) { // caccia al tesoro attiva: quiz superato, ma mancano ancora delle tappe
    return renderHuntTicket(1 + r.huntFound, r.huntTotal + 1, null, false, r.huntDistribute, lbNodes(c, true));
  }
  if (r.hunt) { // caccia al tesoro attiva, ma le tappe erano gia' tutte trovate: biglietto gia' completo
    return renderHuntTicket(r.huntTotal + 1, r.huntTotal + 1, r.code, r.reused, r.huntDistribute, lbNodes(c));
  }
  const text = r.reused
    ? "Hai già completato questo quiz da questo telefono: ecco di nuovo il tuo biglietto."
    : "Ben fatto: " + r.score + " risposte giuste su " + r.total + ". Ecco il tuo biglietto.";
  await showTicket(r.code, r.reused, text);
  out.append(...lbNodes(c)); // con la classifica attiva, sotto al biglietto: punti e classifica
}

// ---------- modalita' classifica: risultato ----------
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
// Fiammella con la serie piu' lunga di risposte giuste di fila: compare solo da 3 in su, e solo a quiz finito
function flame(streak){
  if (!(streak >= 3)) return null;
  const f = el("span", "flame");
  const i = el("i"); i.setAttribute("aria-hidden", "true");
  f.append(i, String(streak), el("span", "vh", " risposte giuste di fila"));
  f.title = "Serie più lunga: " + streak + " risposte giuste di fila";
  return f;
}
// Riquadri della classifica da aggiungere a un risultato: punti (con la fiammella), le domande sbagliate
// (mai la risposta giusta) e la classifica. "compact" = solo i punti e le domande sbagliate, per le
// schermate col biglietto agganciato in basso, dove lo spazio e' poco.
function lbNodes(c, compact){
  if (!c) return [];
  const out = [];
  const xp = el("div", "xp");
  const num = el("div", "xp-num"); num.append(el("b", null, String(c.xp)), el("span", null, c.xp === 1 ? "punto" : "punti"));
  xp.append(num); const f = flame(c.streak); if (f) xp.append(f);
  out.push(xp);
  if (c.replay) out.push(el("p", "hint", (c.gained > 0 ? "Questa volta hai guadagnato " + plural(c.gained, "punto", "punti") + ". " : "Questa volta non hai guadagnato altri punti. ") +
    "Una domanda già sbagliata vale la metà (un terzo dopo due errori, e così via); quelle già indovinate non danno altri punti."));
  if (Array.isArray(c.wrong)) {
    if (!c.wrong.length) out.push(el("p", "hint", "Nessuna domanda sbagliata!"));
    else {
      const box = el("div", "wrong"); box.append(el("h2", null, c.wrong.length === 1 ? "La domanda che hai sbagliato" : "Le domande che hai sbagliato"));
      const ul = el("ul");
      for (const id of c.wrong) { const q = questions.find((x) => x.id === id); if (q) ul.append(el("li", null, q.q)); }
      box.append(ul); out.push(box);
    }
  }
  if (c.board && !compact) out.push(boardNode(c.board));
  return out;
}
// La classifica: i primi 10 e, se non e' tra loro, la propria riga con la posizione
function boardNode(b){
  const box = el("div", "board"); box.append(el("h2", null, "Classifica"));
  if (!b.top.length) { box.append(el("p", "hint", "Nessuno ha ancora giocato: la classifica è vuota.")); return box; }
  const ol = el("ol");
  const row = (pos, p, mine) => {
    const li = el("li", mine ? "me" : null);
    const who = el("span", "who", p.nick); if (mine) who.append(el("span", "vh", " (tu)"));
    li.append(el("span", "pos", pos + "°"), who);
    const f = flame(p.streak); if (f) li.append(f);
    li.append(el("span", "pts", String(p.score)));
    return li;
  };
  b.top.forEach((p, i) => ol.append(row(i + 1, p, !!b.me && b.me.rank === i + 1)));
  if (b.me && b.me.rank > b.top.length) { ol.append(el("li", "gap", "…")); ol.append(row(b.me.rank, b.me, true)); }
  box.append(ol, el("p", "hint", plural(b.players, "giocatore", "giocatori") + " in classifica."));
  return box;
}
// Risultato quando il biglietto e' disattivato: niente soglia da superare, solo punti e classifica
function showScore(r){
  $("start").hidden = true; $("quiz").hidden = true;
  const out = $("result"); out.hidden = false; out.innerHTML = "";
  const c = r.classifica || null;
  const all = r.score === r.total;
  const msg = el("p", "msg ok", (r.huntDone ? "Hai completato tutte le tappe: " : "") +
    (r.huntDone ? "hai" : "Hai") + " risposto correttamente a " + r.score + " " + (r.score === 1 ? "domanda" : "domande") + " su " + r.total + ".");
  out.append(nHead(all ? "Perfetto!" : "Fatto!", "n-head-red"), msg, ...lbNodes(c));
  if (r.hunt && !r.huntDone) out.append(el("p", "hint", r.huntFound >= r.huntTotal
    ? "Hai trovato tutte le " + r.huntTotal + " tappe!"
    : "Tappe trovate: " + r.huntFound + " di " + r.huntTotal + ". Scansiona con la fotocamera gli altri QR sparsi in giro."));
  if (!r.huntDone) { const b = el("button", "n-retry", "Rigioca"); b.onclick = start; out.append(b); }
}
// Domande sparse tra le tappe, biglietto disattivato: una tappa e' fatta, ne mancano altre
function showHuntPart(found, total, c){
  $("start").hidden = true; $("quiz").hidden = true;
  const out = $("result"); out.hidden = false; out.innerHTML = "";
  out.append(nHead("Ottimo!", "n-head-red"), el("p", "msg ok", "Hai completato la " + ordinale(found) + " parte del quiz (" + found + " di " + total + ")."),
    ...lbNodes(c, true), el("p", "hint", "Scansiona con la fotocamera gli altri QR sparsi in giro per completare il quiz :)"));
}
// Schermata "Classifica", aperta dal pulsante della schermata iniziale (la classifica si scarica solo qui)
async function showBoardScreen(){
  const btn = $("boardBtn"); btn.disabled = true;
  try {
    const res = await fetch(API + "/api/leaderboard", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitor: visitorId() }),
    });
    const b = await res.json();
    if (b.maintenance) return showMaintenance();
    if (!res.ok) throw new Error("classifica");
    $("start").hidden = true; $("quiz").hidden = true;
    const out = $("result"); out.hidden = false; out.innerHTML = "";
    const back = el("button", "ghost", "Torna al quiz");
    back.onclick = () => { out.hidden = true; out.innerHTML = ""; $("start").hidden = false; cloudIn(); };
    out.append(boardNode(b), back);
    arriveResult();
  } catch {
    showHuntNote("Classifica non raggiungibile: riprova tra poco.");
  } finally { btn.disabled = false; }
}

// Grafica nuova: titolo ad "adesivo" (es. "Quasi!", "Ce l'hai fatta!"). Nella classica non si vede,
// perche' lo stesso messaggio c'e' gia' scritto nel riquadro sotto.
function nHead(text, extra){
  const h = document.createElement("p"); h.className = "n-only n-head" + (extra ? " " + extra : "");
  h.setAttribute("aria-hidden", "true"); h.textContent = text;
  return h;
}

// Grafica nuova: titolo + cerchio col punteggio ("5 giuste su 8", "ne servono 7") del quiz non superato
function scoreBadge(score, total, needed){
  const missing = Math.max(0, needed - score);
  const c = document.createElement("div"); c.className = "n-only n-score"; c.setAttribute("aria-hidden", "true");
  const n = document.createElement("b"); n.textContent = score;
  const t = document.createElement("span"); t.textContent = (score === 1 ? "giusta" : "giuste") + " su " + total;
  const k = document.createElement("i"); k.textContent = (needed === 1 ? "ne serve " : "ne servono ") + needed;
  c.append(n, t, k);
  return [nHead(missing <= 2 ? "Quasi!" : "Riprova!"), c];
}

// Un QR come <img> con una vera immagine PNG (non un <svg> disegnato nella pagina): solo cosi'
// tenendoci premuto sopra (telefono, "Aggiungi a Foto") o col tasto destro (PC) si puo' salvare il
// QR come immagine - e si salva SOLO il QR, non il resto del biglietto.
async function qrImg(text, alt){
  const img = document.createElement("img");
  img.src = await qrPng(text, 8, 2);
  img.alt = alt;
  img.draggable = false; // altrimenti il trascinamento nativo dell'immagine (drag HTML) interrompe
  return img;             // il gesto di "staccare" il biglietto, scambiandolo per un drag-and-drop
}

// Sposta il biglietto in verticale: a fraction=0 e' spinto fuori dallo schermo, sotto al bordo
// inferiore (come se stesse per essere "stampato" da una fessura li' sotto); a fraction=1 e' fermo
// al suo posto, del tutto visibile. Aumentando "fraction" il biglietto sale.
function setReveal(ticket, fraction){
  const hiddenPercent = Math.max(0, Math.min(1, 1 - fraction)) * 100;
  ticket.dataset.hiddenPct = hiddenPercent;
  if (!ticket.classList.contains("dragging")) ticket.style.transform = "translateY(" + hiddenPercent + "%)";
}

// Disegna il biglietto. "locked"=true mostra QR e codice sfocati, non quelli veri (che il server
// non rivela finche' la caccia al tesoro non e' completa): non c'e' nulla da leggere dietro la sfocatura.
// "docked"=true lo tiene agganciato in basso allo schermo (per l'animazione di "stampa" della caccia
// al tesoro); altrimenti resta semplicemente nella pagina, come il biglietto normale di sempre.
async function buildTicket(locked, docked, code, msgText, note, belowMsg, extra){
  $("start").hidden = true; $("quiz").hidden = true;
  const out = $("result"); out.hidden = false; out.innerHTML = "";
  const msg = document.createElement("p"); msg.className = "msg ok"; msg.textContent = msgText;
  out.append(nHead(locked ? "Ottimo!" : "Ce l'hai fatta!", "n-head-red"), msg);
  if (belowMsg) { // es. durante la caccia al tesoro: "vai a cercare gli altri QR", subito sotto il riquadro
    const p = document.createElement("p"); p.className = "hint"; p.textContent = belowMsg;
    out.append(p);
  }
  if (extra && extra.length && docked) out.append(...extra); // classifica: punti (e domande sbagliate) sopra al biglietto agganciato

  const ticket = document.createElement("div");
  ticket.className = "ticket" + (locked ? " locked" : "") + (docked ? " docked" : "");
  const top = document.createElement("div"); top.className = "ticket-top";
  const logo = document.createElement("img"); logo.className = "ticket-logo"; logo.src = API + "/img/bollo"; // i loghi li consegna il Worker, non stanno su GitHub
  logo.alt = "Croce Rossa Italiana - Comitato di Francavilla Fontana - Oria";
  logo.draggable = false; // idem: niente drag nativo dell'immagine sul biglietto
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
    if (extra && extra.length) out.append(...extra); // classifica: punti e classifica sotto al biglietto
  }
  enableTicketDrag(ticket, locked); // l'effetto "staccabile" vale per ogni biglietto, caccia al tesoro o no
  return ticket;
}

// Fa "staccare" un pelo il biglietto quando ci si preme sopra col dito e si muove, come se fosse
// davvero appoggiato li' sotto: lo fa seguire il dito (ombra compresa) per un piccolo tratto, e quando
// si rilascia torna al suo posto. Si tiene premuto un attimo (HOLD_MS) prima che il trascinamento si
// armi, cosi' un tocco distratto sul biglietto non lo fa muovere per sbaglio. Da sbloccato (il QR vero
// e' stato rivelato, oppure fuori dalla caccia al tesoro) si puo' muovere un pelo in QUALSIASI
// direzione; da bloccato (dentro la caccia al tesoro, il biglietto si vede ancora a malapena sotto il
// bordo) si puo' tirare SOLO verso il centro dello schermo, cioe' un po' piu' in alto, per non
// rompere l'illusione che sia incollato li'.
function enableTicketDrag(ticket, locked){
  const HOLD_MS = 160;   // quanto tenere premuto prima che si armi (evita tocchi per sbaglio)
  const CANCEL_PX = 6;   // se si muove piu' di cosi' PRIMA di armarsi, non e' una pressione volontaria
  const MAX_FREE = 16;   // da sbloccato: massimo spostamento in ogni direzione (px)
  const MAX_PULL = 22;   // da bloccato: massimo quanto si puo' tirare verso il centro (px)
  let holdTimer = null, armed = false, startX = 0, startY = 0;

  const baseTransform = () => "translateY(" + (ticket.dataset.hiddenPct || 0) + "%)";

  function applyDrag(dx, dy){
    ticket.style.transform = baseTransform() + " translate(" + dx + "px," + dy + "px) scale(1.018)";
    const shadowY = 10 + Math.abs(dy) * 0.3 + Math.abs(dx) * 0.2;
    ticket.style.boxShadow = (dx * 0.25) + "px " + shadowY + "px " + (22 + shadowY) + "px rgba(0,0,0,.4)";
  }

  // Ascolto spostamento e rilascio su "window" (non sul biglietto): se il dito si sposta velocemente
  // puo' finire fuori dal riquadro del biglietto, e cosi' non si perdono gli eventi successivi.
  function onMove(e){
    const dx0 = e.clientX - startX, dy0 = e.clientY - startY;
    if (!armed) {
      if (Math.hypot(dx0, dy0) > CANCEL_PX) { clearTimeout(holdTimer); ticket.style.transition = ""; cleanup(); }
      return;
    }
    let dx = dx0, dy = dy0;
    if (locked) {
      dx = 0; dy = Math.max(-MAX_PULL, Math.min(0, dy)); // solo verso il centro (in alto), mai in giu'
    } else {
      const dist = Math.hypot(dx, dy);
      if (dist > MAX_FREE) { const k = MAX_FREE / dist; dx *= k; dy *= k; }
    }
    applyDrag(dx, dy);
  }

  function onUp(){
    clearTimeout(holdTimer);
    if (armed) {
      ticket.style.transition = "transform .35s cubic-bezier(.34,1.56,.64,1), box-shadow .35s ease";
      ticket.style.transform = baseTransform();
      ticket.style.boxShadow = "";
      ticket.classList.remove("dragging");
      setTimeout(() => { ticket.style.transition = ""; }, 380);
    } else {
      ticket.style.transition = "";
    }
    armed = false;
    cleanup();
  }

  function cleanup(){
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  }

  ticket.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startX = e.clientX; startY = e.clientY;
    ticket.style.transition = "none";
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      armed = true;
      ticket.classList.add("dragging");
    }, HOLD_MS);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });
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

async function renderHuntTicket(found, total, code, reused, distribute, extra){
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
  window.removeEventListener("resize", dockRelayout); dockRelayout = () => {};
  if (!locked) {
    // Caccia completata: il biglietto intero NON resta agganciato in basso (su schermi piccoli coprirebbe
    // il testo): sta nella pagina, sotto al testo, e ci arriva salendo dal basso.
    // Parte da dove si era fermato il biglietto agganciato (o dal fondo dello schermo, se non c'era) e sale.
    const old = document.querySelector("#result .ticket.docked");
    const oldTop = old ? old.getBoundingClientRect().top : window.innerHeight;
    const ticket = await buildTicket(false, false, code, msgText, note, null, extra);
    const from = Math.max(0, oldTop - ticket.getBoundingClientRect().top);
    ticket.style.setProperty("--rise-from", from + "px");
    ticket.classList.add("rise");
    return;
  }
  const ticket = await buildTicket(true, true, "••••-••••", msgText, note, belowMsg, extra);
  // Parte da un pelo piu' in basso e sale fino al punto giusto: si vede il biglietto "salire" un po'
  // ad ogni tappa, anche quando la pagina si e' appena caricata. Quanto sale lo decide fitDocked: mai
  // cosi' tanto da coprire il testo, qualunque sia il numero di tappe o l'altezza dello schermo.
  const place = (f) => setReveal(ticket, fitDocked(ticket, f));
  // La posizione di partenza va messa SENZA animazione: altrimenti il biglietto, appena creato (quindi
  // ancora tutto in vista, in mezzo allo schermo), si vedrebbe scendere fino a li'. Deve solo salire dal basso.
  let started = false;
  ticket.style.transition = "none";
  place(Math.max(0, fraction - 1 / total));
  void ticket.offsetHeight; // fa applicare subito la posizione di partenza
  requestAnimationFrame(() => requestAnimationFrame(() => { ticket.style.transition = ""; started = true; place(fraction); }));
  // se cambia lo spazio (schermo ruotato, barra del browser, immagini o caratteri appena caricati) si ricalcola
  dockRelayout = () => { if (ticket.isConnected) place(started ? fraction : Math.max(0, fraction - 1 / total)); };
  window.addEventListener("resize", dockRelayout);
  ticket.querySelectorAll("img").forEach((img) => { if (!img.complete) img.addEventListener("load", dockRelayout); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => dockRelayout());
}
let dockRelayout = () => {};

// Biglietto agganciato in basso: quanta parte puo' spuntare. Lo spazio disponibile e' quello tra la
// fine del testo e il fondo dello schermo: il biglietto ne occupa una frazione ("fraction", che cresce
// ad ogni tappa), quindi sale sempre un po' di piu' ma non arriva mai a coprire il testo.
function fitDocked(ticket, fraction){
  const GAP = 30; // spazio lasciato tra il testo e il biglietto (copre anche il piccolo "tiro" col dito)
  // fine del testo = fondo del riquadro del risultato (il biglietto agganciato e' fuori dal flusso, non conta).
  // Si misura il riquadro e non i singoli elementi, che durante l'animazione di comparsa sono rimpiccioliti.
  const textBottom = $("result").getBoundingClientRect().bottom + window.scrollY;
  const h = ticket.offsetHeight;
  if (!h) return fraction;
  const fromBottom = parseFloat(getComputedStyle(ticket).bottom) || 0;
  const room = Math.max(0, window.innerHeight - fromBottom - textBottom - GAP);
  return fraction * Math.min(h, room) / h;
}

// Caccia al tesoro con le domande sparse: tutte le tappe sono state trovate e risposte, ma il
// punteggio complessivo non basta. Si puo' tornare a scansionare una tappa per cambiare le risposte.
function showHuntFail(score, needed, total, c){
  $("start").hidden = true; $("quiz").hidden = true;
  const out = $("result"); out.hidden = false; out.innerHTML = "";
  const msg = document.createElement("p"); msg.className = "msg ko";
  msg.textContent = "Hai risposto correttamente a " + score + " domande su " + total + ". Ne servono almeno " + needed + ".";
  const hint = document.createElement("p"); hint.className = "hint";
  hint.textContent = "Torna a scansionare con la fotocamera una delle tappe per cambiare le risposte e riprovare.";
  out.append(...scoreBadge(score, total, needed), msg, hint, ...lbNodes(c));
}

// Se la pagina resta aperta e si scansiona un'altra tappa (stessa scheda), l'indirizzo cambia da solo:
// non serve ricaricare la pagina per accorgersene.
window.addEventListener("hashchange", () => {
  let m; try { m = location.hash.match(/^#tappa=([^&]+)/); } catch {}
  if (!m) return;
  const t = decodeURIComponent(m[1]); clearHash();
  const startWasVisible = !$("start").hidden;
  handleHuntVisit(t).catch(() => showHuntNote("Server non raggiungibile: prova a scansionare di nuovo questo QR."))
    .then(() => { if (!startWasVisible) cloudIn(); }); // schermata iniziale appena comparsa: effetto "nuvola"
});
