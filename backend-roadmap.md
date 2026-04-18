# PSA App Backend Roadmap

## Current State
Frontend is now pivoted to a simple paste-link analyzer.

Existing backend routes:
- `POST /api/ebay/normalize-url`
- `POST /api/ebay/fetch-listing` (stub)
- `POST /api/analyze/listing` (prototype analyzer)

## Next Build Steps

### Step 1: Chain the frontend properly
Frontend should call:
1. normalize URL
2. fetch listing
3. analyze listing
4. render result

### Step 2: Replace fetch stub
Need real listing intake for:
- title
- seller info
- price
- shipping
- image URLs
- source link

### Step 3: Improve analysis route
Replace prototype math with:
- image-based card condition scoring
- metadata-based confidence adjustments
- rank generation from real model output

### Step 4: Add persistence
Store:
- fetched listings
- analyses
- saved opportunities

## Recommended stack
- Vercel functions
- Postgres via Neon or Supabase
- optional vision model call for image review

## Suggested frontend result contract
```json
{
  "listing": {
    "itemId": "123456789012",
    "title": "...",
    "sellerName": "...",
    "price": 180,
    "shipping": 5,
    "photoUrls": ["..."]
  },
  "analysis": {
    "recommendation": "buy",
    "gradeRank": "A",
    "probability": 74,
    "confidence": 81,
    "maxBuyPrice": 152,
    "expectedProfit": 74,
    "offerSuggestion": "Offer around $152",
    "riskFlags": ["..."],
    "reasons": ["..."]
  }
}
```

## Product Principle
The user should not manually score cards in the main flow.
The system should do the work and surface a decision fast.
