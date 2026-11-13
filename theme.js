// Alto contrasto e modalita' chiara: preferenze del visitatore, salvate solo nel suo browser
// (non sul server). Applicate subito, prima che la pagina sia disegnata, per evitare lampeggi.
(function(){
  const root = document.documentElement;
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  // Finche' la persona non tocca il pulsante "modalita' chiara", il sito segue il tema chiaro/scuro
  // del dispositivo (anche se cambia da solo, es. al tramonto). Dopo averlo toccato, la sua scelta
  // esplicita (salvata qui sotto) vince sempre, anche se poi il dispositivo cambia tema.
  const mql = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)");
  const systemLight = () => !!(mql && mql.matches);
  function applyTheme(){
    const explicit = get("theme"); // "light" o "dark" solo se gia' toccato il pulsante
    root.classList.toggle("light", explicit ? explicit === "light" : systemLight());
  }
  applyTheme();
  if (get("a11y") === "1") root.classList.add("a11y");

  // Grafica del sito (nuova o classica): la sceglie l'editor e la comunica il server. Qui si applica
  // subito l'ultima vista su questo dispositivo (predefinita: nuova), cosi' la pagina non cambia aspetto
  // a meta' caricamento; appena arriva quella vera dal server, setGrafica la aggiorna se serve.
  root.classList.toggle("ui-nuova", get("grafica") !== "classica");
  // colore della barra del browser sul telefono, abbinato a grafica e tema
  function themeColor(){
    const m = document.querySelector('meta[name="theme-color"]');
    if (!m) return;
    const light = root.classList.contains("light"), nuova = root.classList.contains("ui-nuova");
    m.setAttribute("content", nuova ? (light ? "#FF7B7B" : "#2A1215") : (light ? "#f7f3ec" : "#16120f"));
  }
  window.setGrafica = (g) => {
    const nuova = g !== "classica";
    root.classList.toggle("ui-nuova", nuova);
    set("grafica", nuova ? "nuova" : "classica");
    themeColor();
  };

  // Le due scritte del logo ad "adesivo" in alto a sinistra (grafica nuova): le comunica il server.
  // Si ricordano su questo dispositivo, cosi' alla prossima apertura compaiono subito quelle giuste.
  function showSticker(w){
    const a = document.getElementById("nWord1"), b = document.getElementById("nWord2");
    if (!a || !b || !Array.isArray(w)) return;
    a.textContent = String(w[0] || ""); a.hidden = !w[0];
    b.textContent = String(w[1] || ""); b.hidden = !w[1];
  }
  window.setSticker = (w) => {
    if (!Array.isArray(w)) return;
    set("sticker", JSON.stringify([String(w[0] || "").slice(0, 12), String(w[1] || "").slice(0, 12)]));
    showSticker(w);
  };

  function swapLogos(){
    const light = root.classList.contains("light");
    document.querySelectorAll("img[data-logo-dark]").forEach((img) => {
      const next = light ? img.dataset.logoLight : img.dataset.logoDark;
      if (next && img.getAttribute("src") !== next) img.src = next;
    });
  }

  if (mql && mql.addEventListener) {
    mql.addEventListener("change", () => {
      if (!get("theme")) { // nessuna scelta esplicita: continua a seguire il dispositivo
        applyTheme(); swapLogos(); themeColor();
        const lightBtn = document.getElementById("btnLight");
        if (lightBtn) lightBtn.setAttribute("aria-pressed", String(root.classList.contains("light")));
      }
    });
  }

  function wire(){
    swapLogos(); themeColor();
    try { const w = JSON.parse(get("sticker") || "null"); if (w) showSticker(w); } catch {}
    const a11yBtn = document.getElementById("btnA11y");
    const lightBtn = document.getElementById("btnLight");
    if (a11yBtn) {
      a11yBtn.setAttribute("aria-pressed", String(root.classList.contains("a11y")));
      a11yBtn.onclick = () => {
        const on = !root.classList.contains("a11y");
        root.classList.toggle("a11y", on);
        set("a11y", on ? "1" : "0");
        a11yBtn.setAttribute("aria-pressed", String(on));
      };
    }
    if (lightBtn) {
      lightBtn.setAttribute("aria-pressed", String(root.classList.contains("light")));
      lightBtn.onclick = () => {
        const on = !root.classList.contains("light");
        root.classList.toggle("light", on);
        set("theme", on ? "light" : "dark"); // scelta esplicita: da qui in poi non segue piu' il dispositivo
        lightBtn.setAttribute("aria-pressed", String(on));
        swapLogos(); themeColor();
      };
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
