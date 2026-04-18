# PSA App Architecture Plan - On The Go Version

## Goal
A mobile-friendly app Nate can use from his iPhone anywhere.

## Recommended Architecture
### Frontend
- lightweight web UI
- paste eBay link
- display rank, confidence, risk flags, and photos

### Backend (Vercel)
- normalize eBay URL
- fetch listing data from eBay API
- extract photo URLs
- call hosted vision provider on listing images
- transform vision output into grading signals
- calculate final rank and max buy price
- return final result JSON

### Data layer (later)
- Postgres via Neon or Supabase
- store listings, analyses, saved opportunities

## Required Backend Routes
- `POST /api/ebay/normalize-url`
- `POST /api/ebay/fetch-listing`
- `POST /api/analyze/images`
- `POST /api/analyze/listing`
- later: `POST /api/listings/save`

## Hosted Vision Requirement
Need a server-side callable vision model/provider.
This route should accept image URLs or fetched image bytes and return structured observations like:
- centering estimate
- corner wear estimate
- edge wear estimate
- visible surface defects
- glare/occlusion level
- confidence score

## Final Result Contract
```json
{
  "listing": {
    "itemId": "137230212677",
    "title": "...",
    "sellerName": "micahcollects",
    "price": 225,
    "shipping": 0,
    "photoUrls": ["..."]
  },
  "vision": {
    "frontCentering": "strong",
    "backCentering": "unknown",
    "corners": "minor visible wear",
    "edges": "mostly clean",
    "surface": "no obvious defect",
    "occlusion": "low",
    "confidence": 78
  },
  "analysis": {
    "recommendation": "maybe",
    "gradeRank": "B",
    "probability": 68,
    "maxBuyPrice": 191,
    "expectedProfit": 42,
    "riskFlags": ["minor visible edge/corner wear"],
    "reasons": ["..."]
  }
}
```

## Product Principle
No manual grading worksheet in the main flow.
The app should do the work and return a decision fast.
