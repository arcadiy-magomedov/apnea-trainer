# Deployment

Static PWA hosted on DigitalOcean App Platform (static site component).

## One-time setup
1. Create the app in the DigitalOcean App Platform web UI from the GitHub repo:
   - Resource type: **Static Site**.
   - Build command: `npm ci && npm run build`
   - Output directory: `dist`
   - Catchall document: `index.html` (SPA fallback for client-side routes).
   - **Autodeploy** on push to `main`: enabled.
2. Authorize DigitalOcean's GitHub app for the repository.

## Flow
- Every push/PR runs **CI** (typecheck, tests, build) via `.github/workflows/ci.yml`.
- App Platform **autodeploys** on every push to `main` (builds from source, publishes the
  new version). No API token or Actions deploy step is required.
- App Platform serves the new content-hashed assets and `sw.js`; clients pick up the
  update via the in-app prompt (never mid-session).

> Alternative (test-gated deploy): disable Autodeploy and add a Deploy workflow that runs
> `doctl apps create-deployment` after CI passes, using `DIGITALOCEAN_ACCESS_TOKEN` and
> `DO_APP_ID` repo secrets. Not used with Autodeploy enabled.