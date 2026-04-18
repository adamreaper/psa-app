# PSA App Pivot Plan - Paste Link Analyzer

## New Product Direction
The app should no longer depend on manual condition entry for core use.

Target experience:
1. Nate pastes an eBay link
2. App fetches listing data automatically
3. App analyzes listing photos and metadata
4. App returns a clear rank and buy decision

## Core UX
### Input
- one main URL input
- one main CTA: Analyze Listing

### Output
- rank: Buy / Maybe / Pass or S/A/B/C/D
- confidence
- estimated PSA 10 probability
- max buy price
- expected value
- risk flags
- quick explanation
- listing photo strip

## Architecture Implication
### Frontend
Keep:
- theme
- branding
- result cards
- history/watchlist ideas if useful later

Reduce or remove from primary flow:
- manual condition forms
- manual comp entry in core screen
- dense multi-panel prototype layout

### Backend
Must own:
- eBay URL normalization
- listing fetch
- image collection
- optional AI/vision scoring pipeline
- result JSON for frontend

## Near-Term Build Plan
1. Replace current multi-input layout with single-intake hero + result dashboard
2. Keep existing JS only where reusable
3. Leave manual tools as secondary/advanced mode later if needed
4. Make fetch/analyze the center of the app

## Ranking Recommendation
Use both:
- `recommendation`: Buy / Maybe / Pass
- `gradeRank`: S / A / B / C / D

Example:
- Buy + A
- Maybe + B
- Pass + D

## Important Product Principle
This should feel like a fast flipping decision tool, not a grading worksheet.
