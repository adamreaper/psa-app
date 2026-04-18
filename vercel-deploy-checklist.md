# Vercel Deploy Checklist for PSA App

## What to do now

### 1. Put the project on Vercel
You can deploy the `psa-app` folder as the app root.

### 2. Add environment variables in Vercel
Required:
- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `EBAY_ENVIRONMENT=production`
- `EBAY_MARKETPLACE_ID=EBAY_US`
- `OPENAI_API_KEY`
- `OPENAI_MODEL=gpt-4.1-mini`

Optional for later:
- `EBAY_REDIRECT_URI`

### 3. Confirm routes
These server routes should exist in deployment:
- `/api/ebay/normalize-url`
- `/api/ebay/fetch-listing`
- `/api/analyze/images`
- `/api/analyze/listing`

### 4. Test with a real eBay listing
Paste link into deployed app.
Expected:
- listing loads
- photos load
- OpenAI vision runs
- rank output appears

## Important note
Do not expose secrets in frontend code.
Keep all provider calls server-side.
