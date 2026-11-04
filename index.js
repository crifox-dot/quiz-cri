const API = "https://steep-haze-2da0.cloudflare-vbmev.workers.dev";
const $ = (id) => document.getElementById(id);
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
let questions = [], version = 0, needed = 0, quizTitle = "Quiz sull'HIV";
let order = [], answers = {}, step = 0; // answers: { idDomanda: indiceRispostaScelta }

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

loadQuestions().then(() => {
  $("go").disabled = false;
  $("loadMsg").hidden = true;
}).catch(() => { setTitle("Quiz sull'HIV"); $("loadMsg").textContent = "Impossibile caricare il quiz. Riprova più tardi."; });

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
  msg.className = "msg ok";
  msg.textContent = r.reused
    ? "Hai già completato questo quiz da questo telefono: ecco di nuovo il tuo biglietto."
    : "Ben fatto: " + r.score + " risposte giuste su " + r.total + ". Ecco il tuo biglietto.";

  const ticket = document.createElement("div"); ticket.className = "ticket";
  const top = document.createElement("div"); top.className = "ticket-top";
  const brand = document.createElement("p"); brand.className = "ticket-brand"; brand.textContent = "Croce Rossa Italiana";
  const ev = document.createElement("p"); ev.className = "ticket-event"; ev.textContent = quizTitle;
  const sub = document.createElement("p"); sub.className = "ticket-sub"; sub.textContent = "codice valido una sola volta";
  top.append(brand, ev, sub);

  const perf = document.createElement("div"); perf.className = "ticket-perf";
  const nl = document.createElement("span"); nl.className = "notch notch-l";
  const nr = document.createElement("span"); nr.className = "notch notch-r";
  perf.append(nl, nr);

  const bottom = document.createElement("div"); bottom.className = "ticket-bottom";
  const qr = document.createElement("div"); qr.className = "ticket-qr";
  const logo = document.createElement("img"); logo.className = "ticket-logo"; logo.src = "bollo.png";
  logo.alt = "Croce Rossa Italiana - Comitato di Francavilla Fontana - Oria";
  const code = document.createElement("div"); code.className = "ticket-code"; code.textContent = r.code;
  bottom.append(qr, logo, code);

  ticket.append(top, perf, bottom);
  const hint = document.createElement("p"); hint.className = "hint";
  hint.textContent = "Mostra questo biglietto e non perderlo: il codice vale una sola volta.";
  out.append(msg, ticket, hint);
  const adminUrl = new URL("admin.html", location.href).href + "#" + r.code;
  qr.innerHTML = qrSvg(adminUrl, 5, 2); // SVG generato qui nel browser, nessun servizio esterno
}
