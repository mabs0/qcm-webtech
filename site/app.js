// ---------- état ----------
let QUESTIONS = [];      // questions + corrigé fusionnés
let BY_ID = {};
let UNITS = [];          // dans l'ordre du cours

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const app = document.getElementById("app");

// Données gardées dans le navigateur
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};
let settings = store.get("mcq.settings", { count: 20, mode: "exam", units: [] });
let history = store.get("mcq.history", []);   // [{date, score, total, note}]
let stats = store.get("mcq.stats", {});       // {id: {ok, ko, last}}
let quiz = store.get("mcq.quiz", null);       // QCM en cours ou dernier terminé

// État de la bibliothèque (non persistant)
const lib = { query: "", unit: null, filter: "all", hide: false, revealed: new Set() };
let reviewOnlyErrors = false;

// ---------- utilitaires ----------
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(s) {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
}

// Mini Markdown : blocs de code, `code`, **gras**, *italique*, paragraphes
function markdown(text) {
  const parts = text.split(/```(\w*)\n?([\s\S]*?)```/g);
  let html = "";
  // split avec 2 groupes capturants : [texte, langage, code, texte, langage, code, ...]
  for (let i = 0; i < parts.length; i += 3) {
    const prose = parts[i].trim();
    if (prose) {
      html += prose.split(/\n{2,}/).map((p) => `<p>${inline(p).replace(/\n/g, "<br>")}</p>`).join("");
    }
    if (i + 2 < parts.length) {
      const lang = parts[i + 1] || "plaintext";
      html += `<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(parts[i + 2].replace(/\n$/, ""))}</code></pre>`;
    }
  }
  return html;
}

function highlight() {
  if (window.hljs) app.querySelectorAll("pre code:not(.hljs)").forEach((el) => hljs.highlightElement(el));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sameSet(a = [], b = []) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function formatNote(n) {
  return String(n).replace(".", ",");
}

function noteColor(note) {
  if (note >= 14) return "var(--good)";
  if (note >= 10) return "var(--warn)";
  return "var(--bad)";
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const unitCount = (u) => QUESTIONS.filter((q) => q.unit === u).length;

// ---------- QCM ----------
function pool(units) {
  return QUESTIONS.filter((q) => q.correct && (!units.length || units.includes(q.unit)));
}

function startQuiz(ids) {
  quiz = { ids, picks: {}, checked: {}, index: 0, mode: settings.mode, done: false, startedAt: Date.now() };
  store.set("mcq.quiz", quiz);
  location.hash = "#/qcm";
  render();
}

function newQuiz() {
  const ids = shuffle(pool(settings.units)).slice(0, settings.count).map((q) => q.id);
  if (ids.length) startQuiz(ids);
}

function isRight(id) {
  return sameSet(quiz.picks[id], BY_ID[id].correct);
}

function finishQuiz() {
  const score = quiz.ids.filter(isRight).length;
  const total = quiz.ids.length;
  quiz.done = true;
  quiz.score = score;
  quiz.note = Math.round((score / total) * 40) / 2;   // au demi-point
  history.push({ date: Date.now(), score, total, note: quiz.note });
  for (const id of quiz.ids) {
    const s = stats[id] || { ok: 0, ko: 0 };
    isRight(id) ? s.ok++ : s.ko++;
    s.last = isRight(id);
    stats[id] = s;
  }
  store.set("mcq.quiz", quiz);
  store.set("mcq.history", history);
  store.set("mcq.stats", stats);
  location.hash = "#/resultats";
  window.scrollTo({ top: 0 });
}

function togglePick(i) {
  const id = quiz.ids[quiz.index];
  if (quiz.checked[id]) return;
  const picks = new Set(quiz.picks[id] || []);
  picks.has(i) ? picks.delete(i) : picks.add(i);
  quiz.picks[id] = [...picks].sort();
  if (!quiz.picks[id].length) delete quiz.picks[id];
  store.set("mcq.quiz", quiz);
  renderQuiz();
}

function goTo(index) {
  quiz.index = Math.max(0, Math.min(quiz.ids.length - 1, index));
  store.set("mcq.quiz", quiz);
  renderQuiz();
}

function checkCurrent() {
  const id = quiz.ids[quiz.index];
  if (!quiz.picks[id]) return;
  quiz.checked[id] = true;
  store.set("mcq.quiz", quiz);
  renderQuiz();
}

// ---------- rendu des questions ----------
// mode "pick" : sélection en cours ; "review" : correction avec le choix de l'utilisateur ; "key" : corrigé seul
function answersHtml(q, mode, picks = []) {
  return q.answers.map((a, i) => {
    const correct = q.correct?.includes(i);
    const picked = picks.includes(i);
    let cls = "", tag = "";
    if (mode === "pick" && picked) cls = "picked";
    if (mode === "review") {
      if (picked && correct) [cls, tag] = ["good", "✓<span class=\"tag-label\"> Bonne réponse</span>"];
      else if (picked) [cls, tag] = ["bad", "✗<span class=\"tag-label\"> Mauvaise réponse</span>"];
      else if (correct) [cls, tag] = ["missed", "Oubliée"];
    }
    if (mode === "key" && correct) [cls, tag] = ["good", "✓"];
    return `
      <li class="answer ${cls}" data-i="${i}">
        <span class="letter">${LETTERS[i]}</span><div>${markdown(a)}</div>${tag ? `<span class="tag">${tag}</span>` : ""}
      </li>`;
  }).join("");
}

function explanationHtml(q) {
  if (!q.correct) return `<div class="explanation">Pas encore de corrigé pour cette question.</div>`;
  const letters = q.correct.map((i) => LETTERS[i]).join(", ");
  return `<div class="explanation"><b>Réponse${q.correct.length > 1 ? "s" : ""} : ${letters}.</b> ${inline(q.explanation || "")}</div>`;
}

function statHtml(id) {
  const s = stats[id];
  return s ? `<span class="q-stat" title="Réussie / ratée">✓ ${s.ok} · ✗ ${s.ko}</span>` : "";
}

// ---------- pages ----------
function renderHome() {
  const units = settings.units;
  const poolSize = pool(units).length;
  const count = Math.min(settings.count, poolSize);
  const inProgress = quiz && !quiz.done;

  const notes = history.map((h) => h.note);
  const avg = notes.length ? notes.reduce((a, b) => a + b, 0) / notes.length : null;
  const seen = Object.keys(stats).length;
  const answered = QUESTIONS.filter((q) => q.correct).length;
  const last = history.slice(-12);

  app.innerHTML = `
    ${inProgress ? `
      <div class="resume">
        <span><b>QCM en cours</b> · ${Object.keys(quiz.picks).length} / ${quiz.ids.length} répondues</span>
        <span class="actions">
          <button class="btn ghost" data-action="abandon">Abandonner</button>
          <a class="btn primary" href="#/qcm">Reprendre →</a>
        </span>
      </div>` : ""}
    <div class="home">
      <section class="card hero">
        <h2>Nouveau QCM</h2>
        <p class="muted">Des questions tirées au hasard dans la banque, une note sur 20 à la fin, et on recommence.</p>

        <div class="field">
          <label>Chapitres</label>
          <div class="chips">
            <button class="chip${units.length ? "" : " active"}" data-unit="">Tous<span>${answered}</span></button>
            ${UNITS.map((u) => `<button class="chip${units.includes(u) ? " active" : ""}" data-unit="${escapeHtml(u)}">${escapeHtml(u)}<span>${unitCount(u)}</span></button>`).join("")}
          </div>
        </div>

        <div class="field">
          <label>Nombre de questions</label>
          <div class="segmented">
            ${[10, 20, 30, 40].map((n) => `<button data-count="${n}" class="${settings.count === n ? "active" : ""}">${n}</button>`).join("")}
          </div>
        </div>

        <div class="field">
          <label>Mode</label>
          <div class="segmented">
            <button data-mode="exam" class="${settings.mode === "exam" ? "active" : ""}">Examen</button>
            <button data-mode="revision" class="${settings.mode === "revision" ? "active" : ""}">Révision</button>
          </div>
          <p class="hint">${settings.mode === "exam"
            ? "Correction et note uniquement à la fin."
            : "Correction et explication après chaque question, note à la fin."}</p>
        </div>

        <div class="start-row">
          <button class="btn primary big" data-action="start" ${poolSize ? "" : "disabled"}>Lancer ${count} questions</button>
          <span class="muted">${poolSize} questions dans le pool</span>
        </div>
      </section>

      <section class="card">
        <h3>Ta progression</h3>
        <div class="stats">
          <div class="stat"><b>${avg === null ? "–" : formatNote(avg.toFixed(1))}</b><span>moyenne /20</span></div>
          <div class="stat"><b>${notes.length ? formatNote(Math.max(...notes)) : "–"}</b><span>meilleure note</span></div>
          <div class="stat"><b>${history.length}</b><span>QCM terminés</span></div>
          <div class="stat"><b>${seen}<small class="muted">/${answered}</small></b><span>questions vues</span></div>
        </div>
        ${last.length ? `
          <div class="bars" title="Dernières notes">
            ${last.map((h) => `<div style="height:${Math.max(4, (h.note / 20) * 100)}%;background:${noteColor(h.note)}" title="${formatNote(h.note)}/20"></div>`).join("")}
          </div>
          <ul class="history">
            ${history.slice(-5).reverse().map((h) => `<li><span class="muted">${formatDate(h.date)}</span><span>${h.total !== 20 ? `${h.score}/${h.total} · ` : ""}<b>${formatNote(h.note)}/20</b></span></li>`).join("")}
          </ul>
          <p><button class="btn ghost" data-action="reset-stats">Réinitialiser ma progression</button></p>`
        : `<p class="muted">Lance un premier QCM pour voir tes notes ici.</p>`}
      </section>
    </div>`;
}

function renderQuiz() {
  if (!quiz || quiz.done) { location.hash = "#/"; return; }
  const i = quiz.index;
  const id = quiz.ids[i];
  const q = BY_ID[id];
  const total = quiz.ids.length;
  const picks = quiz.picks[id] || [];
  const checked = quiz.checked[id];
  const revision = quiz.mode === "revision";
  const answeredCount = Object.keys(quiz.picks).length;
  const isLast = i === total - 1;

  let primary;
  if (revision && !checked) primary = `<button class="btn primary" data-action="check" ${picks.length ? "" : "disabled"}>Vérifier</button>`;
  else if (isLast) primary = `<button class="btn primary" data-action="finish">Terminer et noter</button>`;
  else primary = `<button class="btn primary" data-action="next">Suivante →</button>`;

  const dotClass = (qid, n) => {
    const c = [n === i ? "current" : ""];
    if (revision && quiz.checked[qid]) c.push(isRight(qid) ? "ok" : "ko");
    else if (quiz.picks[qid]) c.push("done");
    return c.join(" ");
  };

  app.innerHTML = `
    <div class="quiz">
      <div class="quiz-top">
        <span><b>Question ${i + 1}</b> <span class="muted">/ ${total} · ${revision ? "Révision" : "Examen"}</span></span>
        <button class="btn ghost" data-action="quit">Quitter</button>
      </div>
      <div class="progress"><div style="width:${(answeredCount / total) * 100}%"></div></div>
      <article class="card ${checked ? "" : "selectable"}">
        <div class="q-head"><span class="qid">#${q.id}</span><span class="unit-tag">${escapeHtml(q.unit)}</span></div>
        <div class="question">${markdown(q.question)}</div>
        <p class="hint">Une ou plusieurs réponses possibles.</p>
        <ul class="answers">${answersHtml(q, checked ? "review" : "pick", picks)}</ul>
        ${checked ? `<p class="verdict ${isRight(id) ? "ok" : "ko"}">${isRight(id) ? "Bonne réponse !" : "Raté."}</p>${explanationHtml(q)}` : ""}
      </article>
      <div class="quiz-nav">
        <button class="btn" data-action="prev" ${i === 0 ? "disabled" : ""}>← Précédente</button>
        ${!isLast && answeredCount === total && !(revision && !checked) ? `<button class="btn" data-action="finish">Terminer</button>` : ""}
        ${primary}
      </div>
      ${isLast && answeredCount < total ? `<p class="hint" style="text-align:right">${total - answeredCount} question(s) sans réponse, comptée(s) fausse(s).</p>` : ""}
      <div class="dots">${quiz.ids.map((qid, n) => `<button class="dot ${dotClass(qid, n)}" data-goto="${n}">${n + 1}</button>`).join("")}</div>
      <p class="keys muted"><kbd>1</kbd>–<kbd>4</kbd> cocher · <kbd>Entrée</kbd> ${revision ? "vérifier / suivante" : "suivante"} · <kbd>←</kbd> <kbd>→</kbd> naviguer</p>
    </div>`;
  highlight();
}

function renderResults() {
  if (!quiz || !quiz.done) { location.hash = "#/"; return; }
  const { score, note } = quiz;
  const total = quiz.ids.length;
  const pct = Math.round((score / total) * 100);
  const wrong = quiz.ids.filter((id) => !isRight(id));
  const message =
    note >= 18 ? "Excellent, tu maîtrises !" :
    note >= 14 ? "Très bien, encore un petit effort." :
    note >= 10 ? "C'est la moyenne, revois tes erreurs." :
    "Il faut retravailler ça, regarde les corrections.";

  // Répartition par chapitre
  const perUnit = {};
  for (const id of quiz.ids) {
    const u = BY_ID[id].unit;
    perUnit[u] = perUnit[u] || { ok: 0, total: 0 };
    perUnit[u].total++;
    if (isRight(id)) perUnit[u].ok++;
  }

  const reviewIds = reviewOnlyErrors ? wrong : quiz.ids;

  app.innerHTML = `
    <section class="card">
      <div class="result-hero">
        <div class="ring" style="--p:${pct};--c:${noteColor(note)}">
          <div><div><b>${formatNote(note)}</b><br><span>/ 20</span></div></div>
        </div>
        <div class="result-text">
          <h2>${message}</h2>
          <p class="muted">${score} bonne${score > 1 ? "s" : ""} réponse${score > 1 ? "s" : ""} sur ${total} (${pct} %)</p>
          <div class="actions">
            <button class="btn primary" data-action="start">Nouveau QCM</button>
            ${wrong.length ? `<button class="btn" data-action="retry-wrong">Refaire mes ${wrong.length} erreur${wrong.length > 1 ? "s" : ""}</button>` : ""}
            <a class="btn ghost" href="#/">Accueil</a>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <h3>Par chapitre</h3>
      <div class="breakdown">
        ${Object.entries(perUnit).map(([u, r]) => `
          <div class="breakdown-row">
            <span>${escapeHtml(u)}</span>
            <div class="meter"><div style="width:${(r.ok / r.total) * 100}%"></div></div>
            <b>${r.ok}/${r.total}</b>
          </div>`).join("")}
      </div>
    </section>

    <div class="section-head">
      <h2>Correction</h2>
      <label class="toggle"><input type="checkbox" data-action="only-errors" ${reviewOnlyErrors ? "checked" : ""}> Seulement mes erreurs</label>
    </div>
    ${reviewIds.length ? reviewIds.map((id) => {
      const q = BY_ID[id];
      const n = quiz.ids.indexOf(id) + 1;
      const ok = isRight(id);
      return `
        <article class="card">
          <div class="q-head">
            <span class="verdict ${ok ? "ok" : "ko"}">${ok ? "✓" : "✗"} Question ${n}</span>
            <span class="qid">#${q.id}</span>
            ${quiz.picks[id] ? "" : `<span class="muted">· sans réponse</span>`}
          </div>
          <div class="question">${markdown(q.question)}</div>
          <ul class="answers">${answersHtml(q, "review", quiz.picks[id] || [])}</ul>
          ${explanationHtml(q)}
        </article>`;
    }).join("") : `<div class="empty">Aucune erreur, bravo !</div>`}`;
  highlight();
}

function libraryItems() {
  const query = lib.query.toLowerCase().trim();
  return QUESTIONS.filter((q) => {
    if (lib.unit && q.unit !== lib.unit) return false;
    const s = stats[q.id];
    if (lib.filter === "errors" && !(s && s.last === false)) return false;
    if (lib.filter === "unseen" && s) return false;
    if (!query) return true;
    if (query.startsWith("#")) return String(q.id) === query.slice(1);
    return (q.question + " " + q.answers.join(" ") + " " + (q.explanation || "")).toLowerCase().includes(query);
  });
}

function renderLibraryList() {
  const items = libraryItems();
  document.getElementById("lib-count").textContent = `${items.length} question${items.length > 1 ? "s" : ""}`;
  const list = document.getElementById("lib-list");
  if (!items.length) { list.innerHTML = `<div class="empty">Aucune question ne correspond.</div>`; return; }

  let html = "", current = null;
  for (const q of items) {
    if (q.unit !== current) {
      current = q.unit;
      html += `<h2 class="unit-title">${escapeHtml(current)}</h2>`;
    }
    const show = !lib.hide || lib.revealed.has(q.id);
    html += `
      <article class="card">
        <div class="q-head"><span class="qid">#${q.id}</span>${statHtml(q.id)}</div>
        <div class="question">${markdown(q.question)}</div>
        <ul class="answers">${answersHtml(q, show ? "key" : "pick")}</ul>
        ${show ? explanationHtml(q) : `<button class="btn reveal" data-reveal="${q.id}">Voir la réponse</button>`}
      </article>`;
  }
  list.innerHTML = html;
  highlight();
}

function renderLibrary() {
  const errors = QUESTIONS.filter((q) => stats[q.id]?.last === false).length;
  app.innerHTML = `
    <div class="lib-tools">
      <input class="search" id="lib-search" type="search" placeholder="Rechercher dans les questions, réponses, explications… ou #id" value="${escapeHtml(lib.query)}">
      <div class="chips">
        <button class="chip${lib.unit ? "" : " active"}" data-lib-unit="">Tous<span>${QUESTIONS.length}</span></button>
        ${UNITS.map((u) => `<button class="chip${lib.unit === u ? " active" : ""}" data-lib-unit="${escapeHtml(u)}">${escapeHtml(u)}<span>${unitCount(u)}</span></button>`).join("")}
      </div>
      <div class="lib-filters">
        <div class="segmented">
          <button data-lib-filter="all" class="${lib.filter === "all" ? "active" : ""}">Toutes</button>
          <button data-lib-filter="errors" class="${lib.filter === "errors" ? "active" : ""}">Mes erreurs (${errors})</button>
          <button data-lib-filter="unseen" class="${lib.filter === "unseen" ? "active" : ""}">Jamais vues</button>
        </div>
        <label class="toggle"><input type="checkbox" id="lib-hide" ${lib.hide ? "checked" : ""}> Cacher les réponses</label>
        <span class="lib-count" id="lib-count"></span>
      </div>
    </div>
    <div id="lib-list"></div>`;
  renderLibraryList();
}

// ---------- routeur ----------
function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  return ["qcm", "resultats", "bibli"].includes(hash) ? hash : "home";
}

function render() {
  const r = route();
  document.querySelectorAll(".tabs a").forEach((a) =>
    a.classList.toggle("active", a.dataset.route === (r === "bibli" ? "bibli" : "home")));
  if (r === "qcm") renderQuiz();
  else if (r === "resultats") renderResults();
  else if (r === "bibli") renderLibrary();
  else renderHome();
}

window.addEventListener("hashchange", () => { render(); window.scrollTo({ top: 0 }); });

// ---------- événements ----------
function saveSettings() { store.set("mcq.settings", settings); }

app.addEventListener("click", (e) => {
  const t = e.target.closest("button, li.answer");
  if (!t) return;
  const d = t.dataset;

  // Accueil
  if (d.unit !== undefined && route() === "home") {
    if (!d.unit) settings.units = [];
    else settings.units = settings.units.includes(d.unit)
      ? settings.units.filter((u) => u !== d.unit)
      : [...settings.units, d.unit];
    saveSettings(); return renderHome();
  }
  if (d.count) { settings.count = Number(d.count); saveSettings(); return renderHome(); }
  if (d.mode) { settings.mode = d.mode; saveSettings(); return renderHome(); }

  // QCM
  if (t.matches("li.answer") && route() === "qcm") return togglePick(Number(d.i));
  if (d.goto) return goTo(Number(d.goto));

  // Bibliothèque
  if (d.libUnit !== undefined) { lib.unit = d.libUnit || null; return renderLibrary(); }
  if (d.libFilter) { lib.filter = d.libFilter; return renderLibrary(); }
  if (d.reveal) { lib.revealed.add(Number(d.reveal)); return renderLibraryList(); }

  switch (d.action) {
    case "start": return newQuiz();
    case "abandon": quiz = null; store.set("mcq.quiz", null); return renderHome();
    case "quit": location.hash = "#/"; return;
    case "prev": return goTo(quiz.index - 1);
    case "next": return goTo(quiz.index + 1);
    case "check": return checkCurrent();
    case "finish": return finishQuiz();
    case "retry-wrong": return startQuiz(shuffle(quiz.ids.filter((id) => !isRight(id))));
    case "reset-stats":
      if (!confirm("Effacer toutes tes notes et statistiques ?")) return;
      history = []; stats = {};
      store.set("mcq.history", history); store.set("mcq.stats", stats);
      return renderHome();
  }
});

app.addEventListener("change", (e) => {
  if (e.target.dataset.action === "only-errors") { reviewOnlyErrors = e.target.checked; renderResults(); }
  if (e.target.id === "lib-hide") { lib.hide = e.target.checked; lib.revealed.clear(); renderLibraryList(); }
});

app.addEventListener("input", (e) => {
  if (e.target.id === "lib-search") { lib.query = e.target.value; renderLibraryList(); }
});

document.addEventListener("keydown", (e) => {
  if (route() !== "qcm" || !quiz || quiz.done || e.target.matches("input") || e.ctrlKey || e.metaKey) return;
  const id = quiz.ids[quiz.index];
  const n = BY_ID[id].answers.length;
  if (/^[1-9]$/.test(e.key) && Number(e.key) <= n) togglePick(Number(e.key) - 1);
  else if (e.key === "ArrowRight") goTo(quiz.index + 1);
  else if (e.key === "ArrowLeft") goTo(quiz.index - 1);
  else if (e.key === "Enter") {
    if (quiz.mode === "revision" && !quiz.checked[id]) checkCurrent();
    else if (quiz.index === quiz.ids.length - 1) finishQuiz();
    else goTo(quiz.index + 1);
  } else return;
  e.preventDefault();
});

// ---------- chargement ----------
async function load() {
  try {
    const [questions, answers] = await Promise.all(
      ["data/questions.json", "data/answers.json"].map((url) =>
        fetch(url).then((r) => { if (!r.ok) throw new Error(`${url} : ${r.status}`); return r.json(); })));
    QUESTIONS = questions.map((q) => ({ ...q, ...answers[q.id] }));
    BY_ID = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));
    UNITS = [...new Set(QUESTIONS.map((q) => q.unit))];
    // Un QCM sauvegardé peut contenir une question retirée de la banque
    if (quiz && !quiz.ids.every((id) => BY_ID[id])) quiz = null;
    render();
  } catch (err) {
    app.innerHTML = `<div class="empty">Impossible de charger les questions.<br><small>${escapeHtml(err.message)}</small></div>`;
  }
}

load();
