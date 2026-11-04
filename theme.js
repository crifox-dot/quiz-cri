// Alto contrasto e modalita' chiara: preferenze del visitatore, salvate solo nel suo browser
// (non sul server). Applicate subito, prima che la pagina sia disegnata, per evitare lampeggi.
(function(){
  const root = document.documentElement;
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  if (get("theme") === "light") root.classList.add("light");
  if (get("a11y") === "1") root.classList.add("a11y");

  function swapLogos(){
    const light = root.classList.contains("light");
    document.querySelectorAll("img[data-logo-dark]").forEach((img) => {
      const next = light ? img.dataset.logoLight : img.dataset.logoDark;
      if (next && img.getAttribute("src") !== next) img.src = next;
    });
  }

  function wire(){
    swapLogos();
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
        set("theme", on ? "light" : "dark");
        lightBtn.setAttribute("aria-pressed", String(on));
        swapLogos();
      };
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
