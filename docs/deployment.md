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

## Analytics build configuration

The static build reads two public build-time variables:

- `VITE_GA_MEASUREMENT_ID` - GA4 web-stream Measurement ID.
- `VITE_PRIVACY_CONTACT_EMAIL` - public contact shown for analytics
  access/deletion requests.

Configure both on the DigitalOcean static-site component before enabling the
analytics release. A missing or invalid Measurement ID or privacy contact keeps
analytics as the exact no-op implementation.

Follow `docs/analytics-setup.md` one checkpoint at a time. Do not add an
AdSense link or live ad code during the analytics-foundation release.

## Flow
- Every push/PR runs **CI** (typecheck, tests, build) via `.github/workflows/ci.yml`.
- App Platform **autodeploys** on every push to `main` (builds from source, publishes the
  new version). No API token or Actions deploy step is required.
- App Platform serves the new content-hashed assets and `sw.js`; clients pick up the
  update via the in-app prompt (never mid-session).

> Alternative (test-gated deploy): disable Autodeploy and add a Deploy workflow that runs
> `doctl apps create-deployment` after CI passes, using `DIGITALOCEAN_ACCESS_TOKEN` and
> `DO_APP_ID` repo secrets. Not used with Autodeploy enabled.