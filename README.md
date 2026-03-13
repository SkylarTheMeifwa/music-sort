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

## Spotify App Setup

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create an App
3. Under **Redirect URIs**, add your dev URL: `http://localhost:5173/`
4. Copy the **Client ID** into `.env.local` as `VITE_SPOTIFY_CLIENT_ID`

---

## Deploying

### GitHub Pages (automatic)

1. In your repo → **Settings → Pages** → Source: **GitHub Actions**
2. Add a repository secret `VITE_SPOTIFY_CLIENT_ID` (Settings → Secrets)
3. In your Spotify app's Redirect URIs, add:
   ```
   https://SkylarTheMeifwa.github.io/music-sort/
   ```
4. Push to `main` — the workflow in `.github/workflows/deploy.yml` builds and deploys automatically

### Vercel

1. Import the repo on [vercel.com](https://vercel.com)
2. Add environment variable `VITE_SPOTIFY_CLIENT_ID`
3. In your Spotify app's Redirect URIs, add your Vercel URL
4. Deploy — no extra config needed (`VITE_BASE_PATH` stays at `/`)

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `VITE_SPOTIFY_CLIENT_ID` | ✅ | Your Spotify app Client ID |
| `VITE_SPOTIFY_REDIRECT_URI` | optional | Override redirect URI (auto-detected otherwise) |
| `VITE_BASE_PATH` | optional | Set to `/music-sort/` for GitHub Pages |

