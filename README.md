# Music Sort 🎵

A mobile-first PWA that lets you swipe through a Spotify playlist — Tinder-style — to build the perfect playlist length.

## Features

- **Spotify login** — OAuth PKCE (no backend required)
- **Pick any playlist** from your library or paste a URL/ID
- **Swipe right → Yes**, **swipe left → No**, **swipe down → Maybe**
- **Color cues** — green / red / yellow overlay with intensity that increases as you drag
- **Stacked card physics** — top card rotates and flies off; next cards slide up smoothly
- **Audio preview** — 30-second loop plays automatically, stops when you swipe
- **Duration tracker** — progress bar shows Yes total vs. your target length
- **Multi-pass** — after a full pass, resume with Maybe + No songs until you hit the target
- **Undo** — restore the last swiped card at any time
- **Session persistence** — localStorage saves everything; refresh without losing progress
- **Cleanup list** — export No + Maybe songs as `Title — Artist` for easy removal
- **Remove from Spotify** — delete cleanup tracks directly from the playlist in one tap
- **Installable PWA** — add to home screen on iOS/Android

---

## Quick Start (local dev)

```bash
# 1. Clone
git clone https://github.com/SkylarTheMeifwa/music-sort.git
cd music-sort

# 2. Install
npm install

# 3. Create .env.local
cp .env.example .env.local
# Fill in VITE_SPOTIFY_CLIENT_ID

# 4. Dev server
npm run dev
```

---
