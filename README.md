# Wortpfad

A learning-path German app — Duolingo-style lessons built from your own vocabulary list,
with the actual **Half-Life Regression** spaced-repetition model Duolingo published.
Runs entirely in the browser; no backend to run.

Original app (name, look, logo) — contains no third-party code, assets or characters.

## Features

- **Learning path** of lessons grouped into units (Nouns, Verbs, …) per level A1/A2/B1 —
  **all 4,208 words** of every level are included (535 lessons of 8 words each).
- **Seven exercise types**: multiple choice (both directions), der/die/das, type-the-word,
  listen-and-tap, word-bank sentence building, and match-the-pairs.
- **Spaced repetition (HLR)**: every word has a half-life; recall decays as `2^(−Δ/h)`; a
  word becomes **due** when predicted recall drops below 50%. **Review due words** builds a
  session from whatever's due, weakest first.
- **Unlimited hearts** (default on) — no lockout; practise as much as you like.
- **XP, daily goal, streak, combo**. German audio via the browser voice.

## Use it

Open the page, pick a level, and start the first lesson. Optional: **Sign in with Google**
to sync progress across devices (see Cloud sync). Chrome/Edge give the best voice.

## Cloud sync (Firestore)

Progress is kept in your browser (localStorage) and, when you sign in with Google, also in
your Firestore project `a2-vocab-trainer` under **collection `wortpfad`, document = your uid**
— isolated from your vocab-trainer data. Two one-time console steps make it work:

1. **Authorize the hosting domain** — Firebase console → Authentication → Settings →
   Authorized domains → Add `harsimar17.github.io` (localhost is already allowed for testing).
2. **Publish this Firestore rule** — Firestore Database → Rules, add inside
   `match /databases/{database}/documents { … }`, then Publish:
   ```
   match /wortpfad/{uid} {
     allow read, write: if request.auth != null && request.auth.uid == uid;
   }
   ```
   This lets each signed-in user read/write only their own document.

Until both are done, the app still works fully — it just keeps progress locally and logs a
warning instead of syncing.

## Host on GitHub Pages

Push `index.html`, `app.js`, `styles.css`, `favicon.svg`, `README.md` to a repo's default
branch, then Settings → Pages → Deploy from a branch → root. Live at
`https://<you>.github.io/<repo>/` after a minute.

## Notes

- No API key and no quota — lessons come from your vocab file and the browser voice.
- Vocabulary is fetched from
  `https://harsimar17.github.io/Deutsch-Vocab-Helper/german_vocab.json`
  (with a small built-in fallback list for offline use).
