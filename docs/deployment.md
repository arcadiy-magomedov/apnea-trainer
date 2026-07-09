# Deployment

Static PWA hosted on DigitalOcean App Platform (static site component).

## One-time setup
1. Create the app from `.do/app.yaml`: `doctl apps create --spec .do/app.yaml`.
2. Note the returned app id.
3. In GitHub repo settings → Secrets and variables → Actions, add:
   - `DIGITALOCEAN_ACCESS_TOKEN` — a DO API token with write access.
   - `DO_APP_ID` — the App Platform app id.

## Flow
- Every push/PR runs **CI** (typecheck, tests, build).
- On a successful **CI** run on `main`, **Deploy** triggers `doctl apps create-deployment`,
  which builds from source on App Platform and publishes the new version.
- App Platform serves the new content-hashed assets and `sw.js`; clients pick up the
  update via the in-app prompt (never mid-session).