# Family Grocery List

A private, installable family grocery list — no server required. All data is saved in the browser's `localStorage`.

## Features

- Add, edit, delete grocery items
- Mark items as purchased (moves to a "Purchased" section)
- Organise items by category (Produce, Dairy, Meat, etc.)
- Search items by name, notes, or category
- Activity log (last 90 days)
- Export the list as a CSV file
- Shared family password for access control
- Installable as a Progressive Web App (works offline)

## Getting started

### Option 1 — Open directly in a browser

Because this is plain HTML/CSS/JavaScript, you can open `index.html` directly in any browser on your local machine:

```
open index.html
```

> **Note:** The service worker and PWA install prompt require the app to be served over **HTTPS** (or `localhost`). For the install prompt to appear, serve the app instead of opening the file directly.

### Option 2 — Serve locally

```bash
# Python 3
python3 -m http.server 8080

# Node.js (npx)
npx serve .
```

Then open `http://localhost:8080`.

### Option 3 — Deploy (free hosting)

Upload the entire folder to any static hosting service:

| Provider | Free tier | Notes |
|---|---|---|
| **Cloudflare Pages** | Unlimited requests | Automatic HTTPS, custom domain |
| **Netlify** | 100 GB bandwidth/month | Drag-and-drop deploy or Git |
| **Vercel** | Generous free tier | Git-based deploy |
| **GitHub Pages** | Public repos free | Custom domain supported |

## Default password

The default family password is **`family`**.

Change it immediately after first login: go to **Settings → Change password**.

## Data storage

All data (items, activity, settings) is stored in the browser's `localStorage`. This means:

- Data persists after closing the browser tab
- Data is **device-local** — it does not sync between devices automatically
- Clearing site data / browser storage will erase the list

### Multi-device sync

For multi-device sync, upgrade to a cloud backend such as Supabase or Firebase (see `spec.md` for the full architecture). The app's JavaScript is structured to make this straightforward to add.

## File structure

```
index.html        — App shell
css/styles.css    — Styles (mobile-first)
js/app.js         — Application logic
manifest.json     — PWA manifest
sw.js             — Service worker (offline support)
icons/            — App icons
spec.md           — Full software requirements spec
```

## Free-tier notes

Since this version uses only `localStorage`, there are no third-party service limits. Once you add a cloud backend:

| Provider | Free tier limits | Inactivity suspension |
|---|---|---|
| Supabase | 500 MB DB, 50k auth users | Projects pause after 7 days inactivity (free tier) |
| Firebase | 1 GB Firestore, 10k auth/month | No suspension |
| Netlify | 100 GB bandwidth/month | None |
| Cloudflare Pages | Unlimited | None |
