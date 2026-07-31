# Rotation Alarm Clock

An offline-first alarm clock that plays a different sound (or one of your own
uploaded tracks) every time it rings, so it never goes stale. Vanilla
HTML/CSS/JS, no build step, no server, no account.

## What's in here
- `index.html` — the whole UI
- `app.js` — alarm engine, sound rotation, Wake Lock, notifications, IndexedDB persistence
- `sw.js` — service worker (offline caching)
- `manifest.json` — makes it installable to a home screen/desktop
- `icon-192.png`, `icon-512.png` — app icons

## Deploy free on GitHub Pages

1. Create a new repo on your GitHub (e.g. `alarm-clock`).
2. Push these files to the repo root (no `src/` folder, no build):
   ```
   git init
   git add .
   git commit -m "Alarm clock v1"
   git branch -M main
   git remote add origin https://github.com/MJ-Baltasar/alarm-clock.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Source → Deploy from a branch → `main` / root**.
4. Your app will be live at `https://mj-baltasar.github.io/alarm-clock/` within a minute or two.

GitHub Pages serves over HTTPS by default, which is required for the service
worker, Notification API, and Wake Lock to work at all — so no extra config
needed there.

## Installing it as an app
Once it's live, open the URL on your phone or desktop and use the browser's
"Install app" / "Add to Home Screen" option. After that first load, it works
fully offline.

## A few honest notes
- **Background reliability**: browsers throttle timers in fully closed or
  force-stopped tabs/apps. Keep it installed and open (or at least not
  force-closed) for alarms to fire on time. This is a browser-level limit,
  not something fixable in JS — the in-app banner explains this too.
- **iOS Safari**: notifications and some background behavior are more
  limited than on Android/desktop Chrome. The core alarm-while-open
  experience still works fine.
- **Your data stays on your device**: alarms and uploaded sounds are stored
  in IndexedDB in your browser. Nothing is uploaded anywhere. Clearing your
  browser's site data will remove them.
