// Wortpfad: a learning path of short German lessons built from your own vocabulary list.
const $ = (id) => document.getElementById(id);

const VOCAB_URL = "https://harsimar17.github.io/Deutsch-Vocab-Helper/german_vocab.json";
const WORDS_PER_LESSON = 8;
const MAX_HEARTS = 5;
const HEART_REFILL_MS = 20 * 60 * 1000;
const DAILY_GOAL = 20;
const CATEGORY_NAMES = {
  nouns: "Nouns",
  adjectives: "Adjectives",
  verbs: "Verbs",
  separable_verbs: "Separable verbs",
  function_words: "Little words",
  phrases: "Phrases",
};

// A small built-in list so the app still works offline or if the vocab URL fails.
const FALLBACK = [
  { de: "der Hund", en: "dog", example: "Der Hund schläft im Garten.", level: "A1", cat: "nouns" },
  { de: "die Katze", en: "cat", example: "Die Katze trinkt Milch.", level: "A1", cat: "nouns" },
  { de: "das Haus", en: "house", example: "Das Haus ist sehr alt.", level: "A1", cat: "nouns" },
  { de: "der Tisch", en: "table", example: "Der Tisch steht in der Küche.", level: "A1", cat: "nouns" },
  { de: "die Schule", en: "school", example: "Die Schule beginnt um acht.", level: "A1", cat: "nouns" },
  { de: "das Buch", en: "book", example: "Das Buch liegt auf dem Bett.", level: "A1", cat: "nouns" },
  { de: "der Zug", en: "train", example: "Der Zug kommt gleich.", level: "A1", cat: "nouns" },
  { de: "die Stadt", en: "city", example: "Die Stadt ist im Sommer voll.", level: "A1", cat: "nouns" },
  { de: "gehen", en: "to go", example: "Wir gehen heute ins Kino.", level: "A1", cat: "verbs" },
  { de: "essen", en: "to eat", example: "Ich esse gern Brot.", level: "A1", cat: "verbs" },
  { de: "schreiben", en: "to write", example: "Sie schreibt einen Brief.", level: "A1", cat: "verbs" },
  { de: "kaufen", en: "to buy", example: "Er kauft neue Schuhe.", level: "A1", cat: "verbs" },
  { de: "spielen", en: "to play", example: "Die Kinder spielen draußen.", level: "A1", cat: "verbs" },
  { de: "lernen", en: "to learn", example: "Ich lerne jeden Tag Deutsch.", level: "A1", cat: "verbs" },
  { de: "wohnen", en: "to live", example: "Wir wohnen in Berlin.", level: "A1", cat: "verbs" },
  { de: "trinken", en: "to drink", example: "Er trinkt morgens Kaffee.", level: "A1", cat: "verbs" },
];

// ---------- storage ----------
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage unavailable; progress lasts for this visit only
    }
  },
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function loadProgress() {
  return store.get("wp_progress", {
    done: {}, // lessonId -> true
    xp: 0,
    xpByDay: {},
    streak: { count: 0, last: null },
    hearts: { n: MAX_HEARTS, ts: Date.now() },
    mistakes: [], // German forms answered wrong (legacy; superseded by `memory`)
    memory: {}, // de -> { h, last, right, wrong, seen }  (spaced-repetition state)
    level: "A1",
    unlimited: true, // no hearts lockout — practise as much as you like
  });
}
let progress = loadProgress();
if (progress.unlimited === undefined) progress.unlimited = true;
if (!progress.memory) progress.memory = {};

// ---------- cloud sync (Firestore + Google sign-in) ----------
// When you sign in with Google, progress is saved to Firestore under your own uid
// (collection "wortpfad", doc = your uid), so it follows you across devices.
// localStorage is always kept as an offline cache, so the app works signed out too.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBRzM4RvIBEbgmAhWHED57d4hE2MhvX4_Y",
  authDomain: "a2-vocab-trainer.firebaseapp.com",
  projectId: "a2-vocab-trainer",
  storageBucket: "a2-vocab-trainer.firebasestorage.app",
  appId: "1:167587188759:web:10fbfb9e36b8aa4fb88c52",
};
const CLOUD_FIELD = "progress";
let cloudRef = null; // Firestore doc reference once signed in
let cloudTimer = null;
let fbApp = null;

function fbReady() {
  const fb = window.firebase;
  if (!fb) return null;
  if (!fbApp) fbApp = fb.apps?.length ? fb.app() : fb.initializeApp(FIREBASE_CONFIG);
  return fb;
}

function updateAccountUI(user) {
  const btn = $("account");
  if (!btn) return;
  btn.hidden = false;
  btn.textContent = user ? `Sign out (${(user.displayName || user.email || "you").split(" ")[0]})` : "Sign in with Google";
  btn.dataset.state = user ? "in" : "out";
}

async function signInGoogle() {
  const fb = fbReady();
  if (!fb) return;
  const provider = new fb.auth.GoogleAuthProvider();
  try {
    await fb.auth(fbApp).signInWithPopup(provider); // works on desktop and most mobile taps
  } catch (e) {
    // Popups are often blocked on mobile — fall back to a full-page redirect.
    if (/popup/i.test(e?.code || "")) await fb.auth(fbApp).signInWithRedirect(provider);
    else console.warn("Sign-in failed:", e?.code || e?.message || e);
  }
}

async function signOutGoogle() {
  const fb = fbReady();
  if (fb) await fb.auth(fbApp).signOut().catch(() => {});
  cloudRef = null;
}

// Pull this user's saved progress from Firestore into the app.
async function loadCloudProgress() {
  if (!cloudRef) return;
  try {
    const snap = await cloudRef.get();
    const data = snap.exists ? snap.data()?.[CLOUD_FIELD] : null;
    if (data) {
      progress = data;
      if (progress.unlimited === undefined) progress.unlimited = true;
      if (!progress.memory) progress.memory = {};
      store.set("wp_progress", progress);
    } else {
      saveCloudNow(); // first sign-in: push the local cache up
    }
  } catch (e) {
    console.warn("Cloud load failed:", e?.code || e?.message || e);
  }
}

// Set up Firebase and watch auth state. The home screen re-renders on sign-in/out.
async function initCloud(onChange) {
  const fb = fbReady();
  if (!fb) return;
  try {
    await fb.auth(fbApp).getRedirectResult().catch(() => {}); // completes a mobile redirect sign-in
  } catch { /* ignore */ }
  fb.auth(fbApp).onAuthStateChanged(async (user) => {
    updateAccountUI(user);
    if (user) {
      cloudRef = fb.firestore(fbApp).collection("wortpfad").doc(user.uid);
      await loadCloudProgress();
    } else {
      cloudRef = null;
    }
    if (typeof onChange === "function") onChange();
  });
}

function saveCloudNow() {
  if (!cloudRef) return;
  cloudRef
    .set({ [CLOUD_FIELD]: progress, updated: Date.now() })
    .catch((e) => console.warn("Cloud save failed:", e?.code || e?.message || e));
}

// Save: always update the local cache immediately, and debounce the cloud write.
const save = () => {
  store.set("wp_progress", progress);
  if (cloudRef) {
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(saveCloudNow, 1200);
  }
};

function refillHearts() {
  const h = progress.hearts;
  if (progress.unlimited) {
    h.n = MAX_HEARTS; // keep hearts full; mistakes never lock you out
    h.ts = Date.now();
    return;
  }
  if (h.n >= MAX_HEARTS) {
    h.ts = Date.now();
    return;
  }
  const gained = Math.floor((Date.now() - h.ts) / HEART_REFILL_MS);
  if (gained > 0) {
    h.n = Math.min(MAX_HEARTS, h.n + gained);
    h.ts += gained * HEART_REFILL_MS;
    save();
  }
}

function addXp(amount) {
  progress.xp += amount;
  const d = today();
  progress.xpByDay[d] = (progress.xpByDay[d] ?? 0) + amount;
  const s = progress.streak;
  if (s.last !== d) {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    s.count = s.last === yesterday ? s.count + 1 : 1;
    s.last = d;
  }
  save();
}

// ---------- spaced repetition: Half-Life Regression (HLR) ----------
// Duolingo's published memory model. A word has a *half-life* h (days until recall
// decays to 50%). Predicted recall after Δ days is p = 2^(-Δ/h). The half-life is a
// log-linear (regression) function of practice history, h = 2^(θ·features), so each
// correct review lengthens it and each lapse shortens it. A word is "due" when p < 0.5.
const H_MIN = 15 / 1440; // 15 minutes, in days
const H_MAX = 365; // cap a half-life at one year
const MS_PER_DAY = 86_400_000;

// h = 2^(θ0 + θ_right·√right − θ_wrong·√wrong), clamped. These weights stand in for the
// trained regression coefficients; the functional form is the HLR model.
function halfLife(right, wrong) {
  const exponent = -1 + 1.6 * Math.sqrt(right) - 1.3 * Math.sqrt(wrong);
  return Math.min(H_MAX, Math.max(H_MIN, Math.pow(2, exponent)));
}

function recallProbability(mem, now = Date.now()) {
  if (!mem || !mem.last) return 0; // never studied
  const elapsedDays = (now - mem.last) / MS_PER_DAY;
  return Math.pow(2, -elapsedDays / mem.h);
}

// Record a review outcome and reschedule the word.
function reviewWord(de, correct, now = Date.now()) {
  const mem = progress.memory[de] ?? { h: H_MIN, last: 0, right: 0, wrong: 0, seen: 0 };
  mem.seen += 1;
  if (correct) mem.right += 1;
  else mem.wrong += 1;
  mem.h = halfLife(mem.right, mem.wrong);
  mem.last = now;
  progress.memory[de] = mem;
}

// Words whose predicted recall has dropped below 50%, weakest first.
function dueWords(now = Date.now()) {
  const due = [];
  for (const w of vocab) {
    const mem = progress.memory[w.de];
    if (mem && mem.last && recallProbability(mem, now) < 0.5) {
      due.push({ word: w, p: recallProbability(mem, now) });
    }
  }
  return due.sort((a, b) => a.p - b.p).map((d) => d.word);
}

// ---------- vocabulary ----------
function flattenVocab(json) {
  const out = [];
  const levels = json?.levels ?? {};
  const add = (e, level, cat) => {
    if (e?.de && e?.en) out.push({ de: e.de.trim(), en: e.en.trim(), example: (e.example ?? "").trim(), level, cat });
  };
  for (const level of Object.keys(levels)) {
    for (const cat of Object.keys(levels[level] ?? {})) {
      const v = levels[level][cat];
      if (Array.isArray(v)) v.forEach((e) => add(e, level, cat));
      else if (v && typeof v === "object") Object.values(v).forEach((arr) => Array.isArray(arr) && arr.forEach((e) => add(e, level, cat)));
    }
  }
  return out;
}

let vocab = [];

async function loadVocab() {
  $("load-status").textContent = "Loading your vocabulary…";
  try {
    const res = await fetch(VOCAB_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    vocab = flattenVocab(await res.json());
    if (!vocab.length) throw new Error("empty list");
    $("load-status").textContent = `${vocab.length} words loaded.`;
  } catch (error) {
    vocab = FALLBACK;
    $("load-status").textContent = `Couldn't load your vocab (${error.message}); using a small built-in list.`;
  }
}

// Units = one category within a level; lessons = consecutive chunks of words.
function buildUnits(level) {
  const units = [];
  for (const cat of Object.keys(CATEGORY_NAMES)) {
    // Reverse the JSON order so lessons start from the end of each list (bottom-to-top).
    const words = vocab.filter((w) => w.level === level && w.cat === cat).reverse();
    if (!words.length) continue;
    const lessons = [];
    for (let i = 0; i < words.length; i += WORDS_PER_LESSON) {
      lessons.push({ id: `${level}-${cat}-${i / WORDS_PER_LESSON}`, words: words.slice(i, i + WORDS_PER_LESSON) });
    }
    units.push({ id: `${level}-${cat}`, title: CATEGORY_NAMES[cat], cat, level, pool: words, lessons });
  }
  return units;
}

// ---------- home / path ----------
function renderStats() {
  refillHearts();
  $("stat-streak").textContent = `🔥 ${progress.streak.count}`;
  $("stat-xp").textContent = `⚡ ${progress.xp}`;
  $("stat-hearts").textContent = progress.unlimited ? "❤ ∞" : `❤ ${progress.hearts.n}`;
  const todayXp = progress.xpByDay[today()] ?? 0;
  $("goal-label").textContent = `${Math.min(todayXp, DAILY_GOAL)} / ${DAILY_GOAL} XP`;
  $("goal-fill").style.width = `${Math.min(100, (todayXp / DAILY_GOAL) * 100)}%`;
  const due = vocab.length ? dueWords().length : 0;
  $("mistake-count").textContent = due ? `(${due})` : "";
  $("practice-mistakes").disabled = due === 0;
}

function renderPath() {
  const level = $("level-filter").value;
  const units = buildUnits(level);
  const path = $("path");
  path.replaceChildren();
  const shown = 6; // show the next few lessons per unit, so long units stay readable
  for (const unit of units) {
    // Each unit progresses on its own: its first unfinished lesson is open, later ones locked.
    let foundCurrent = false;
    const li = document.createElement("li");
    li.className = "unit";
    const doneCount = unit.lessons.filter((l) => progress.done[l.id]).length;
    li.innerHTML = `<div class="unit-head"><strong></strong><span></span></div><div class="nodes"></div>`;
    li.querySelector("strong").textContent = `${unit.level} · ${unit.title}`;
    li.querySelector("span").textContent = `${doneCount} / ${unit.lessons.length} lessons`;
    const nodes = li.querySelector(".nodes");
    const firstOpen = unit.lessons.findIndex((l) => !progress.done[l.id]);
    const start = Math.max(0, (firstOpen === -1 ? unit.lessons.length : firstOpen) - 2);
    unit.lessons.slice(start, start + shown).forEach((lesson, k) => {
      const idx = start + k;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "node";
      btn.style.transform = `translateX(${Math.sin(idx * 1.1) * 70}px)`;
      if (progress.done[lesson.id]) {
        btn.classList.add("done");
        btn.textContent = "★";
        btn.title = "Practise again";
      } else if (!foundCurrent) {
        foundCurrent = true;
        btn.classList.add("current");
        btn.textContent = String(idx + 1);
        btn.title = "Start lesson";
      } else {
        btn.classList.add("locked");
        btn.textContent = "🔒";
        btn.disabled = true;
      }
      btn.addEventListener("click", () => startLesson(lesson.words, unit.pool, lesson.id));
      nodes.append(btn);
    });
    path.append(li);
  }
}

function showScreen(id) {
  for (const s of ["home", "lesson", "end"]) $(s).hidden = s !== id;
  window.scrollTo(0, 0);
}

// ---------- speech ----------
function germanVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("de"));
  const score = (v) =>
    (v.lang === "de-DE" ? 20 : 0) +
    (!v.localService ? 15 : 0) +
    (/natural|neural|premium|enhanced|google/i.test(v.name) ? 20 : 0) -
    (/compact|espeak/i.test(v.name) ? 20 : 0);
  return voices.sort((a, b) => score(b) - score(a))[0] ?? null;
}

function say(text, slow = false) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "de-DE";
  const v = germanVoice();
  if (v) u.voice = v;
  u.rate = slow ? 0.7 : 0.95;
  speechSynthesis.speak(u);
}
if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => {};

// ---------- helpers ----------
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const pickOthers = (pool, word, n, key) =>
  shuffle(pool.filter((w) => w[key] !== word[key])).filter((w, i, a) => a.findIndex((x) => x[key] === w[key]) === i).slice(0, n);
const ARTICLE = /^(der|die|das)\s+/i;
const articleOf = (de) => (de.match(ARTICLE)?.[1] ?? "").toLowerCase();

// Lenient comparison for typed answers: case, punctuation, umlaut spellings, optional article.
function normalize(s) {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[.,!?;:"'()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function typedMatches(input, de) {
  const a = normalize(input);
  return a === normalize(de) || a === normalize(de.replace(ARTICLE, ""));
}

// ---------- building a lesson ----------
function makeExercises(words, pool) {
  const ex = [];
  const types = ["select", "reverse", "listen", "type", "article", "build"];
  words.forEach((w, i) => {
    // Rotate types so a lesson mixes recognition, recall, listening and building.
    let order = types.slice(i % types.length).concat(types.slice(0, i % types.length));
    for (const t of order) {
      if (t === "article" && !articleOf(w.de)) continue;
      if (t === "build") {
        const n = w.example.split(/\s+/).length;
        if (n < 3 || n > 10) continue;
      }
      ex.push({ type: t, word: w });
      break;
    }
  });
  // One match-the-pairs round per lesson.
  if (words.length >= 4) ex.splice(Math.min(3, ex.length), 0, { type: "match", words: shuffle(words).slice(0, 5) });
  // A couple of extra recognition checks so the lesson has ~11 steps.
  shuffle(words).slice(0, 2).forEach((w) => ex.push({ type: "select", word: w }));
  return ex.map((e) => ({ ...e, pool }));
}

// ---------- lesson runner ----------
let lesson = null;

function startLesson(words, pool, id) {
  refillHearts();
  if (!progress.unlimited && progress.hearts.n <= 0) {
    alert("You're out of hearts. They refill over time, or practise your mistakes to earn one back.");
    return;
  }
  lesson = {
    id,
    isPractice: !id,
    queue: makeExercises(words, pool),
    total: 0,
    done: 0,
    mistakes: 0,
    answered: 0,
    combo: 0,
    bestCombo: 0,
    retried: new Set(),
  };
  lesson.total = lesson.queue.length;
  showScreen("lesson");
  nextExercise();
}

function updateLessonBar() {
  $("lesson-fill").style.width = `${(lesson.done / lesson.total) * 100}%`;
  $("lesson-hearts").textContent = progress.unlimited ? "❤ ∞" : `❤ ${progress.hearts.n}`;
  const c = $("combo");
  c.hidden = lesson.combo < 3;
  c.textContent = `${lesson.combo} in a row!`;
}

let current = null; // { ex, getAnswer(), check() }

function nextExercise() {
  updateLessonBar();
  $("feedback").hidden = true;
  const btn = $("check");
  btn.textContent = "Check";
  btn.disabled = true;
  btn.onclick = onCheck;
  if (!lesson.queue.length) return finishLesson(true);
  const ex = lesson.queue.shift();
  current = renderExercise(ex);
}

function setReady(ready) {
  $("check").disabled = !ready;
}

function renderExercise(ex) {
  const stage = $("stage");
  stage.replaceChildren();
  const prompt = $("prompt");
  const w = ex.word;

  if (ex.type === "select" || ex.type === "reverse" || ex.type === "listen") {
    const showDe = ex.type === "reverse";
    let correct, options;
    if (ex.type === "select") {
      prompt.textContent = `Which one means “${w.en}”?`;
      correct = w.de;
      options = shuffle([w, ...pickOthers(ex.pool, w, 3, "de")]).map((o) => o.de);
    } else if (ex.type === "reverse") {
      prompt.textContent = "What does this mean?";
      const big = document.createElement("div");
      big.className = "big-word";
      big.textContent = w.de;
      stage.append(big);
      correct = w.en;
      options = shuffle([w, ...pickOthers(ex.pool, w, 3, "en")]).map((o) => o.en);
    } else {
      prompt.textContent = "Tap what you hear";
      const play = document.createElement("button");
      play.type = "button";
      play.className = "speak-btn";
      play.textContent = "🔊";
      play.addEventListener("click", () => say(w.de));
      stage.append(play);
      setTimeout(() => say(w.de), 250);
      correct = w.de;
      options = shuffle([w, ...pickOthers(ex.pool, w, 3, "de")]).map((o) => o.de);
    }
    let chosen = null;
    const grid = document.createElement("div");
    grid.className = "options";
    options.forEach((text, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "option";
      b.textContent = `${i + 1}. ${text}`;
      b.addEventListener("click", () => {
        grid.querySelectorAll(".option").forEach((x) => x.classList.remove("selected"));
        b.classList.add("selected");
        chosen = text;
        if (!showDe && ex.type !== "listen") say(text);
        setReady(true);
      });
      grid.append(b);
    });
    stage.append(grid);
    return { ex, check: () => ({ ok: chosen === correct, answer: correct }) };
  }

  if (ex.type === "article") {
    const noun = w.de.replace(ARTICLE, "");
    prompt.textContent = `Der, die or das? — “${w.en}”`;
    const big = document.createElement("div");
    big.className = "big-word";
    big.textContent = `___ ${noun}`;
    stage.append(big);
    let chosen = null;
    const grid = document.createElement("div");
    grid.className = "options";
    ["der", "die", "das"].forEach((a) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "option";
      b.textContent = a;
      b.addEventListener("click", () => {
        grid.querySelectorAll(".option").forEach((x) => x.classList.remove("selected"));
        b.classList.add("selected");
        chosen = a;
        setReady(true);
      });
      grid.append(b);
    });
    stage.append(grid);
    return { ex, check: () => ({ ok: chosen === articleOf(w.de), answer: w.de }) };
  }

  if (ex.type === "type") {
    prompt.textContent = `Write this in German: “${w.en}”`;
    const input = document.createElement("input");
    input.className = "type-input";
    input.autocomplete = "off";
    input.autocapitalize = "off";
    input.spellcheck = false;
    input.placeholder = "Type in German";
    input.addEventListener("input", () => setReady(input.value.trim().length > 0));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !$("check").disabled) $("check").click();
    });
    stage.append(input);
    if (articleOf(w.de)) {
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = "Tip: include der / die / das for nouns.";
      stage.append(hint);
    }
    setTimeout(() => input.focus(), 50);
    return { ex, check: () => ({ ok: typedMatches(input.value, w.de), answer: w.de }) };
  }

  if (ex.type === "build") {
    const tokens = w.example.split(/\s+/);
    prompt.textContent = `Build the sentence (it uses “${w.de}” = ${w.en})`;
    const line = document.createElement("div");
    line.className = "answer-line";
    const bank = document.createElement("div");
    bank.className = "bank";
    const picked = [];
    const distractors = pickOthers(ex.pool, w, 2, "de").map((o) => o.de.replace(ARTICLE, ""));
    const tiles = shuffle([...tokens, ...distractors]);
    tiles.forEach((tok, idx) => {
      const t = document.createElement("button");
      t.type = "button";
      t.className = "tile";
      t.textContent = tok;
      t.addEventListener("click", () => {
        if (t.classList.contains("used")) return;
        t.classList.add("used");
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "tile";
        chip.textContent = tok;
        const entry = { tok, idx, chip };
        picked.push(entry);
        chip.addEventListener("click", () => {
          picked.splice(picked.indexOf(entry), 1);
          chip.remove();
          t.classList.remove("used");
          setReady(picked.length > 0);
        });
        line.append(chip);
        setReady(true);
      });
      bank.append(t);
    });
    stage.append(line, bank);
    return {
      ex,
      check: () => ({
        ok: normalize(picked.map((p) => p.tok).join(" ")) === normalize(w.example),
        answer: w.example,
      }),
    };
  }

  if (ex.type === "match") {
    prompt.textContent = "Tap the matching pairs";
    const grid = document.createElement("div");
    grid.className = "pairs";
    const left = shuffle(ex.words).map((x) => ({ side: "de", key: x.de, text: x.de }));
    const right = shuffle(ex.words).map((x) => ({ side: "en", key: x.de, text: x.en }));
    let sel = null;
    let matched = 0;
    let wrongTries = 0;
    const cells = [];
    for (let i = 0; i < left.length; i++) cells.push(left[i], right[i]);
    cells.forEach((cell) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pair";
      b.textContent = cell.text;
      b.addEventListener("click", () => {
        if (b.classList.contains("matched")) return;
        if (cell.side === "de") say(cell.text);
        if (!sel) {
          sel = { cell, b };
          b.classList.add("selected");
          return;
        }
        if (sel.b === b) {
          b.classList.remove("selected");
          sel = null;
          return;
        }
        if (sel.cell.side !== cell.side && sel.cell.key === cell.key) {
          sel.b.classList.add("matched");
          b.classList.add("matched");
          matched++;
          if (matched === ex.words.length) setReady(true);
        } else {
          wrongTries++;
          const other = sel.b;
          other.classList.add("wrong");
          b.classList.add("wrong");
          setTimeout(() => {
            other.classList.remove("wrong", "selected");
            b.classList.remove("wrong");
          }, 450);
        }
        sel.b.classList.remove("selected");
        sel = null;
      });
      grid.append(b);
    });
    stage.append(grid);
    // Matching counts as correct once all pairs are found; more than two slips costs a heart.
    return { ex, check: () => ({ ok: wrongTries <= 2, answer: "Keep an eye on those pairs." }) };
  }

  return { ex, check: () => ({ ok: true, answer: "" }) };
}

function onCheck() {
  if (!current) return;
  const { ok, answer } = current.check();
  const ex = current.ex;
  lesson.answered++;
  // Reschedule the word(s) in the spaced-repetition model.
  if (ex.type === "match") (ex.words ?? []).forEach((w) => reviewWord(w.de, ok));
  else if (ex.word) reviewWord(ex.word.de, ok);
  const fb = $("feedback");
  fb.hidden = false;
  fb.className = `feedback ${ok ? "good" : "bad"}`;
  if (ok) {
    lesson.combo++;
    lesson.bestCombo = Math.max(lesson.bestCombo, lesson.combo);
    lesson.done++;
    $("feedback-title").textContent = ["Nice!", "Richtig!", "Great job!", "Genau!"][Math.floor(Math.random() * 4)];
    $("feedback-detail").textContent = ex.type === "build" || ex.type === "type" ? answer : "";
    if (ex.word) say(ex.type === "build" ? ex.word.example : ex.word.de);
    if (ex.word) progress.mistakes = progress.mistakes.filter((m) => m !== ex.word.de);
  } else {
    lesson.combo = 0;
    lesson.mistakes++;
    if (!lesson.isPractice && !progress.unlimited) progress.hearts.n = Math.max(0, progress.hearts.n - 1);
    $("feedback-title").textContent = "Correct answer:";
    $("feedback-detail").textContent = answer;
    if (ex.word && !progress.mistakes.includes(ex.word.de)) progress.mistakes.push(ex.word.de);
    // Missed items come back once at the end of the lesson.
    const key = `${ex.type}:${ex.word?.de ?? "match"}`;
    if (!lesson.retried.has(key)) {
      lesson.retried.add(key);
      lesson.queue.push(ex);
      lesson.total++;
    } else {
      lesson.done++;
    }
  }
  save();
  updateLessonBar();
  const btn = $("check");
  btn.textContent = "Continue";
  btn.disabled = false;
  btn.onclick = () => {
    if (progress.hearts.n <= 0 && !lesson.isPractice) return finishLesson(false);
    nextExercise();
  };
}

function finishLesson(completed) {
  showScreen("end");
  const acc = lesson.answered ? Math.round(((lesson.answered - lesson.mistakes) / lesson.answered) * 100) : 100;
  let xp = 0;
  if (completed) {
    xp = 10 + (lesson.mistakes === 0 ? 5 : 0) + (lesson.bestCombo >= 5 ? 2 : 0);
    addXp(xp);
    if (lesson.id) progress.done[lesson.id] = true;
    if (lesson.isPractice) progress.hearts.n = Math.min(MAX_HEARTS, progress.hearts.n + 1);
    save();
  }
  $("end-title").textContent = completed ? (lesson.mistakes === 0 ? "Perfect lesson!" : "Lesson complete!") : "Out of hearts";
  $("end-xp").textContent = String(xp);
  $("end-acc").textContent = `${acc}%`;
  $("end-streak").textContent = String(progress.streak.count);
  $("end-note").textContent = completed
    ? lesson.isPractice
      ? "Mistakes reviewed — you earned a heart back."
      : lesson.mistakes
        ? `${lesson.mistakes} slip${lesson.mistakes > 1 ? "s" : ""} saved for mistake practice.`
        : "No mistakes. Ausgezeichnet!"
    : "Hearts refill over time. Practise your mistakes to earn one back sooner.";
  lesson = null;
}

// ---------- wiring ----------
$("quit").addEventListener("click", () => {
  if (confirm("Quit this lesson? Progress in it will be lost.")) {
    lesson = null;
    speechSynthesis?.cancel();
    showScreen("home");
    renderStats();
    renderPath();
  }
});

$("end-continue").addEventListener("click", () => {
  showScreen("home");
  renderStats();
  renderPath();
});

$("level-filter").addEventListener("change", () => {
  progress.level = $("level-filter").value;
  save();
  renderPath();
});

$("unlimited").addEventListener("change", () => {
  progress.unlimited = $("unlimited").checked;
  if (progress.unlimited) progress.hearts.n = MAX_HEARTS;
  save();
  renderStats();
});

$("practice-mistakes").addEventListener("click", () => {
  // Build a review session from whatever the spaced-repetition model says is due,
  // weakest-recall first, across all levels.
  const words = dueWords().slice(0, WORDS_PER_LESSON);
  if (!words.length) return;
  const pool = vocab.filter((w) => w.level === words[0].level && w.cat === words[0].cat);
  startLesson(words, pool.length >= 4 ? pool : vocab, null);
});

// Keyboard shortcuts on desktop: 1–4 pick an option, Enter checks/continues.
document.addEventListener("keydown", (e) => {
  if ($("lesson").hidden || e.target.tagName === "INPUT") return;
  if (e.key === "Enter" && !$("check").disabled) $("check").click();
  const n = Number(e.key);
  if (n >= 1 && n <= 4) $("stage").querySelectorAll(".option")[n - 1]?.click();
});

$("account").addEventListener("click", () => {
  if ($("account").dataset.state === "in") signOutGoogle();
  else signInGoogle();
});

(async function init() {
  $("level-filter").value = progress.level ?? "A1";
  $("unlimited").checked = progress.unlimited !== false;
  renderStats();
  await loadVocab();
  renderStats(); // refresh the due count now that the vocabulary is available
  renderPath();
  // Re-render when sign-in state changes and cloud progress arrives.
  initCloud(() => {
    $("level-filter").value = progress.level ?? "A1";
    $("unlimited").checked = progress.unlimited !== false;
    if ($("home") && !$("home").hidden) {
      renderStats();
      renderPath();
    }
  });
  setInterval(renderStats, 60_000);
})();
