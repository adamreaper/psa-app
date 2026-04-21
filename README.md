# PSA App

## Current State
This is now a paste-link PSA analyzer prototype being prepared for real eBay API intake.

Note: the scanner scripts were moved out of this folder into `scanners/` so the app and scanner products are no longer mixed together.

### Frontend
- `index.html`
- `styles.css`
- `app.js`

### Backend
- `api/ebay/normalize-url.js`
- `api/ebay/fetch-listing.js`
- `api/ebay/oauth-token.js`
- `api/ebay/browse-item.js`
- `api/analyze/listing.js`
- `vercel.json`
- `package.json`

## What works now
- paste-link analyzer UI
- ranking output shell
- real eBay API credential integration points
- live Browse API fetch route structure
- prototype analyzer endpoint
- retro/modern theme shell
- photo inspection support

## Required env vars
Copy `.env.example` and set:
- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `EBAY_REDIRECT_URI`
- `EBAY_ENVIRONMENT`
- optional: `EBAY_MARKETPLACE_ID`
- `APP_PASSWORD` for owner-only access
- optional but recommended: `APP_SESSION_SECRET` to sign auth cookies independently of the app password
- optional: `IMAGE_FETCH_ALLOWLIST` comma-separated hostnames allowed for vision image fetches (defaults to eBay image hosts)

## Privacy lock
- If `APP_PASSWORD` is set, the landing page itself is protected.
- Unauthenticated visits to `/` get the login screen instead of the app.
- Protected API routes reject unauthorized access with `401`.
- Auth cookies are signed and no longer store the raw app password.
- Vision image fetches are restricted to allowed public hosts and reject private-network targets.
- Use `/api/logout` or the Lock App button to clear access on your device.

## Current intended flow
1. paste eBay URL
2. normalize URL
3. fetch listing from eBay Browse API
4. analyze listing
5. render rank output

## Next Steps
1. set real env vars
2. run with `vercel dev`
3. chain frontend through normalize + fetch + analyze
4. replace prototype analyzer logic with real scoring/photo analysis
5. add DB persistence
