# Vision Provider Notes

## What we need
A hosted vision endpoint callable from Vercel/server-side routes.

The provider must be able to inspect collectible card listing photos and return structured condition observations.

## Minimum output we want
```json
{
  "frontCentering": "strong|okay|borderline|poor|unknown",
  "backCentering": "strong|okay|borderline|poor|unknown",
  "corners": "clean|minor wear|visible whitening|multiple issues|unknown",
  "edges": "clean|minor wear|visible wear|multiple issues|unknown",
  "surface": "clean|possible issue|visible issue|unknown",
  "occlusion": "none|minor|major",
  "confidence": 0
}
```

## Good provider characteristics
- server-side callable
- supports image URLs or image bytes
- reliable latency
- decent cost for repeated mobile use
- predictable JSON output

## App integration pattern
1. fetch listing from eBay
2. pass photo URLs to vision route
3. vision route returns structured card-condition observations
4. listing analyzer converts those observations into final rank + max buy price

## Important note
The model should be told explicitly:
- do not assume hidden defects are absent
- penalize glare/occlusion
- prefer conservative grading estimates
- assess only what is visible in photos
