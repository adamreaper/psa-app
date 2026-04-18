# PSA App API Notes

## New Product Direction
The app is now pivoting to a paste-link analyzer:
1. paste eBay URL
2. normalize URL
3. fetch listing
4. analyze listing
5. return rank + buy decision

## Current API Shape
### 1. Normalize URL
`POST /api/ebay/normalize-url`

Request:
```json
{
  "listingUrl": "https://www.ebay.com/itm/123456789012"
}
```

Response:
```json
{
  "ok": true,
  "normalized": {
    "source": "ebay",
    "listingUrl": "https://www.ebay.com/itm/123456789012",
    "itemId": "123456789012",
    "valid": true
  }
}
```

### 2. Fetch listing
`POST /api/ebay/fetch-listing`

Current state: stub route

### 3. Analyze listing
`POST /api/analyze/listing`

Request:
```json
{
  "listing": {
    "itemId": "123456789012",
    "title": "One Piece OP01 Roronoa Zoro Alt Art",
    "price": 180,
    "shipping": 5,
    "sellerName": "topratedtcg",
    "photoUrls": ["https://..."]
  }
}
```

Response:
```json
{
  "ok": true,
  "analysis": {
    "recommendation": "buy",
    "gradeRank": "A",
    "probability": 74,
    "confidence": 81,
    "buyIn": 185,
    "maxBuyPrice": 152,
    "expectedProfit": 74,
    "offerSuggestion": "Offer around $152",
    "riskFlags": ["photo count decent", "surface unknown"],
    "reasons": ["..."],
    "summary": "Prototype analyzer response generated from normalized listing data."
  }
}
```

## Correct Final Pipeline
Frontend should eventually do:
1. normalize URL
2. fetch listing metadata/images
3. send normalized listing into analysis route
4. render rank output only

## Future Backend Responsibilities
- eBay URL normalization
- listing data fetch
- image extraction
- AI/vision grading analysis
- scoring + rank generation
- persistence

## Suggested DB Tables Later
### listings
- id
- source
- item_id
- source_url
- title
- price
- shipping
- seller_name
- seller_score
- raw_payload_json
- created_at

### analyses
- id
- listing_id
- recommendation
- grade_rank
- psa10_probability
- confidence
- expected_profit
- max_buy_price
- offer_suggestion
- risk_flags_json
- reasons_json
- created_at

## Practical Note
Direct browser scraping of eBay is still the wrong move. Backend should own normalization, fetch strategy, anti-CORS handling, and future AI analysis orchestration.
