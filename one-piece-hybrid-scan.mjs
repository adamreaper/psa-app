import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const WORKSPACE = process.env.OPENCLAW_WORKSPACE || 'C:\\Users\\batpo\\.openclaw\\workspace';
const OUTPUT_DIR = path.join(WORKSPACE, 'reports', 'one-piece-hybrid');
const STATE_PATH = path.join(OUTPUT_DIR, 'seen-listings.json');
const DASHBOARD_DIR = path.join(WORKSPACE, 'one-piece-sniper');
const DASHBOARD_DATA_PATH = path.join(DASHBOARD_DIR, 'latest.json');
const ENV_PATH = path.join(WORKSPACE, 'psa-app', '.env.local');
const SNIPER_SHEET_PATH = path.join(WORKSPACE, 'one-piece-sniper-sheet.md');
const TOP15_PATH = path.join(WORKSPACE, 'one-piece-raw-to-psa10-top15.md');
const MARKET_SOURCES_PATH = path.join(WORKSPACE, 'psa-app', 'one-piece-market-sources.json');

function parseEnv(raw) {
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    env[key] = value;
  }
  return env;
}

async function loadEnv() {
  const raw = await fs.readFile(ENV_PATH, 'utf8');
  const env = parseEnv(raw);
  for (const [k, v] of Object.entries(env)) {
    if (!(k in process.env)) process.env[k] = v;
  }
}

let cachedToken = null;
let cachedExpiry = 0;

async function getToken() {
  const now = Date.now();
  if (cachedToken && now < cachedExpiry - 60_000) return cachedToken;

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const scope = process.env.EBAY_SCOPE || 'https://api.ebay.com/oauth/api_scope';
  if (!clientId || !clientSecret) throw new Error('Missing eBay credentials');

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'Authorization': `Basic ${auth}`
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(`Token request failed (${response.status}): ${JSON.stringify(data)}`);
  }

  cachedToken = data.access_token;
  cachedExpiry = now + (Number(data.expires_in || 7200) * 1000);
  return cachedToken;
}

async function searchListings(query, { limit = 15, sort = 'newlyListed', categoryIds = ['183454'] } = {}) {
  const token = await getToken();
  const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('sort', sort);
  url.searchParams.set('filter', `buyingOptions:{FIXED_PRICE},categoryIds:{${categoryIds.join('|')}}`);

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': process.env.EBAY_MARKETPLACE_ID || 'EBAY_US',
      'Accept': 'application/json'
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Search failed for ${query} (${response.status}): ${JSON.stringify(data)}`);
  }

  return Array.isArray(data.itemSummaries) ? data.itemSummaries : [];
}

async function searchSoldListings(query, { limit = 25, days = 90, categoryIds = ['183454'] } = {}) {
  const token = await getToken();
  const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('sort', 'newlyListed');
  const end = new Date();
  const start = new Date(end.getTime() - (days * 24 * 60 * 60 * 1000));
  url.searchParams.set(
    'filter',
    `buyingOptions:{FIXED_PRICE|AUCTION},conditions:{USED},categoryIds:{${categoryIds.join('|')}},lastSoldDate:[${start.toISOString()}..${end.toISOString()}]`
  );

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': process.env.EBAY_MARKETPLACE_ID || 'EBAY_US',
      'Accept': 'application/json'
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Sold search failed for ${query} (${response.status}): ${JSON.stringify(data)}`);
  }

  return Array.isArray(data.itemSummaries) ? data.itemSummaries : [];
}

async function fetchBrowseItem(itemId) {
  const token = await getToken();
  const marketplaceId = process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';
  const browseId = String(itemId || '');
  const isBrowseStyleId = /^v1\|/i.test(browseId);
  const url = isBrowseStyleId
    ? `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(browseId)}`
    : `https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${encodeURIComponent(browseId)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
      'Accept': 'application/json'
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.errors?.[0]?.message || `Failed to fetch browse item ${browseId}`);
  }
  return data;
}

function money(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalize(item) {
  const price = money(item.price?.value);
  const shipping = money(item.shippingOptions?.[0]?.shippingCost?.value);
  return {
    title: item.title || 'Untitled',
    price,
    shipping,
    total: price + shipping,
    condition: item.condition || null,
    seller: item.seller?.username || null,
    itemId: item.itemId || null,
    url: item.itemWebUrl || null,
    image: item.image?.imageUrl || null,
  };
}

function normalizeBrowse(data, fallback = {}) {
  const seller = data.seller?.username || data.seller?.feedbackPercentage || 'Unknown seller';
  const imageUrls = [
    data.image?.imageUrl,
    ...(Array.isArray(data.additionalImages) ? data.additionalImages.map((img) => img.imageUrl) : [])
  ].filter(Boolean);

  return {
    itemId: fallback.itemId || data.itemId || null,
    title: data.title || fallback.title || 'Untitled eBay listing',
    price: Number(data.price?.value || 0),
    shipping: Number(data.shippingOptions?.[0]?.shippingCost?.value || 0),
    total: Number(data.price?.value || 0) + Number(data.shippingOptions?.[0]?.shippingCost?.value || 0),
    sellerName: seller,
    sellerScore: null,
    condition: data.condition || fallback.condition || 'unknown',
    photoUrls: imageUrls,
    sourceUrl: data.itemWebUrl || fallback.url || null
  };
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.itemId || item.url || item.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function titleHas(title, term) {
  return (title || '').toLowerCase().includes(term.toLowerCase());
}

function hasAnyTerm(title, terms = []) {
  return terms.some((term) => titleHas(title, term));
}

function getTitleCodes(title) {
  return title.match(/\b(?:op|st|p|eb)\d{2,}-\d{3}\b/ig) || [];
}

function filterMatches(items, target) {
  return items.filter((item) => {
    const title = item.title || '';
    if ((target.required || []).some((term) => !titleHas(title, term))) return false;
    if ((target.requiredAny || []).length && !hasAnyTerm(title, target.requiredAny)) return false;
    if ((target.forbidden || []).some((term) => titleHas(title, term))) return false;
    if (/\b(proxy|custom|fan art|repro|replica|orica|coin|playmat|sleeve|case|display|poster|shirt|figure|funko|slab saver|toploader|binder|deck box|booster box|pack|sealed pack|starter deck|playset|lot|bundle|x2|x3|x4|2x|3x|4x|set of|full set)\b/i.test(title)) return false;
    if (/\b(psa|bgs|cgc|sgc|ace grading|graded|slabbed)\b/i.test(title)) return false;
    if (/\b(jp|japanese|japan|s-chinese|simplified chinese|chinese|korean|thai)\b/i.test(title)) return false;
    const codes = getTitleCodes(title);
    if (codes.length && !codes.some((code) => code.toLowerCase() === target.code.toLowerCase())) return false;
    if ((target.rawRequiredAny || []).length && !hasAnyTerm(title, target.rawRequiredAny)) return false;
    if ((target.rawForbidden || []).some((term) => titleHas(title, term))) return false;
    return true;
  });
}

function filterSoldMatches(items, target) {
  return items.filter((item) => {
    const title = item.title || '';
    const lower = title.toLowerCase();
    const total = Number(item.total ?? (money(item.price) + money(item.shipping)));
    const price = money(item.price);
    const shipping = money(item.shipping);

    if (!/\bpsa\s*10\b/i.test(title)) return false;
    if (!lower.includes(target.code.toLowerCase())) return false;
    if ((target.required || []).some((term) => !titleHas(title, term))) return false;
    if ((target.requiredAny || []).length && !hasAnyTerm(title, target.requiredAny)) return false;
    if ((target.soldRequired || []).some((term) => !titleHas(title, term))) return false;
    if ((target.soldRequiredAny || []).length && !hasAnyTerm(title, target.soldRequiredAny)) return false;
    if ((target.forbidden || []).filter((term) => term.toLowerCase() !== 'psa').some((term) => titleHas(title, term))) return false;
    if ((target.soldForbidden || []).some((term) => titleHas(title, term))) return false;
    if (/\b(psa 9|psa 8|bgs|cgc|sgc|ace grading|raw|ungraded|proxy|custom|lot|bundle|playset|reprint)\b/i.test(title)) return false;
    if (/\b(jp|japanese|japan|s-chinese|simplified chinese|chinese|korean|thai|finalist|championship|champion|winner|serial|signed|auto|autograph)\b/i.test(title)) return false;
    if (!Number.isFinite(total) || total < 20) return false;
    if (price <= 0) return false;
    if (shipping > 0 && shipping >= Math.max(15, price * 0.45)) return false;
    const codes = getTitleCodes(title);
    if (codes.length && !codes.some((code) => code.toLowerCase() === target.code.toLowerCase())) return false;
    return true;
  });
}

function summarizeSoldComps(items) {
  if (!items.length) return null;
  const totals = items
    .map((item) => Number(item.total ?? (money(item.price) + money(item.shipping))))
    .filter((n) => Number.isFinite(n) && n >= 20)
    .sort((a, b) => a - b);

  if (!totals.length) return null;

  const median = totals[Math.floor(totals.length / 2)];
  const bounded = totals.filter((n) => n >= median * 0.68 && n <= median * 1.4);
  const working = bounded.length >= 2 ? bounded : totals;
  const avg = working.reduce((sum, n) => sum + n, 0) / working.length;
  const market = Math.round(((avg + working[Math.floor(working.length / 2)]) / 2) * 100) / 100;

  return {
    market,
    compCount: working.length,
    low: working[0],
    high: working[working.length - 1],
    recent: working.slice(-5)
  };
}

function parseMoneyLine(line) {
  const match = line.match(/\$([\d,.]+)/);
  return match ? Number(match[1].replace(/,/g, '')) : null;
}

async function loadMarketSources() {
  try {
    const raw = await fs.readFile(MARKET_SOURCES_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function buildRecentPsa10MarketSource(target) {
  const nameParts = target.name.split(' ').filter(Boolean);
  const leadName = nameParts.slice(0, 2).join(' ');
  const soldQueries = [
    `"${target.code}" "PSA 10" "One Piece"`,
    `"${leadName}" "${target.code}" "PSA 10"`,
    `"${leadName}" "PSA 10" "One Piece"`,
    `"${target.queryName}" "PSA 10"`
  ];

  const combined = [];
  for (const query of soldQueries) {
    const items = await searchSoldListings(query, { limit: 20, days: 120 });
    combined.push(...items);
  }

  const normalized = dedupe(combined.map(normalize));
  const filtered = filterSoldMatches(normalized, target);
  await writeSoldCompDebug(target, normalized, filtered).catch(() => {});
  const summary = summarizeSoldComps(filtered);
  if (!summary || summary.compCount < 2) return null;

  const suggestedBuyUnder = Math.max(1, Math.round((summary.market * 0.24) * 100) / 100);

  return {
    source: 'ebay_recent_psa10_sales',
    psa10Market: summary.market,
    buyUnder: suggestedBuyUnder,
    notes: `${summary.compCount} recent PSA 10 sold comps, range ${formatMoney(summary.low)} to ${formatMoney(summary.high)}`
  };
}

async function writeSoldCompDebug(target, normalized, filtered) {
  const debugDir = path.join(OUTPUT_DIR, 'sold-comp-debug');
  await fs.mkdir(debugDir, { recursive: true });
  const payload = {
    target: target.name,
    code: target.code,
    generatedAt: new Date().toISOString(),
    candidates: normalized.map((item) => ({
      title: item.title,
      total: item.total,
      price: item.price,
      shipping: item.shipping,
      url: item.url,
      itemId: item.itemId
    })),
    matched: filtered.map((item) => ({
      title: item.title,
      total: item.total,
      price: item.price,
      shipping: item.shipping,
      url: item.url,
      itemId: item.itemId
    }))
  };
  await fs.writeFile(path.join(debugDir, `${target.code}.json`), JSON.stringify(payload, null, 2), 'utf8');
}

async function parseResearchFiles() {
  const [sniperRaw, top15Raw] = await Promise.all([
    fs.readFile(SNIPER_SHEET_PATH, 'utf8').catch(() => ''),
    fs.readFile(TOP15_PATH, 'utf8').catch(() => ''),
  ]);

  const blocks = sniperRaw.split(/\n(?=### )/).filter(Boolean);
  const research = new Map();

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const heading = lines[0]?.replace(/^###\s*/, '').trim();
    if (!heading) continue;

    let rawMarket = null;
    let psa10Market = null;
    let buyUnder = null;
    let verdict = null;

    for (const line of lines) {
      if (/^- Raw market:/i.test(line)) rawMarket = parseMoneyLine(line);
      if (/^- PSA 10 market:/i.test(line)) psa10Market = parseMoneyLine(line);
      if (/^- Buy under:/i.test(line)) buyUnder = parseMoneyLine(line);
      if (/^- Verdict:/i.test(line)) verdict = line.replace(/^- Verdict:/i, '').trim();
    }

    research.set(heading, {
      heading,
      rawMarket,
      psa10Market,
      buyUnder,
      verdict,
      notes: lines.filter((line) => /^- Read:|^  - /.test(line)).map((line) => line.trim()),
      source: 'sniper-sheet'
    });
  }

  const topPriority = [];
  for (const line of top15Raw.split(/\r?\n/)) {
    const m = line.match(/^\d+\.\s+(.+)$/);
    if (m) topPriority.push(m[1].trim());
  }

  return { research, topPriority };
}

async function analyzeImages(listing) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  if (!apiKey || !Array.isArray(listing.photoUrls) || !listing.photoUrls.length) {
    return null;
  }

  const sampledUrls = listing.photoUrls.slice(0, 4);
  const input = [
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: `You are analyzing collectible trading card listing photos for PSA 10 grading potential. Return strict JSON only. Assess only what is visible. Be conservative. For item ${listing.itemId || 'unknown'} titled: ${listing.title || 'Untitled listing'}. Output this exact shape: {"frontCentering":"strong|okay|borderline|poor|unknown","backCentering":"strong|okay|borderline|poor|unknown","corners":"clean|minor wear|visible whitening|multiple issues|unknown","edges":"clean|minor wear|visible wear|multiple issues|unknown","surface":"clean|possible issue|visible issue|unknown","occlusion":"none|minor|major","confidence":0,"summary":"short summary"}`
        },
        ...sampledUrls.map((url) => ({ type: 'input_image', image_url: url, detail: 'high' }))
      ]
    }
  ];

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, input })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { error: data.error?.message || 'Vision request failed' };
  }

  const text = data.output_text
    || data.output?.map((x) => x?.content?.map((c) => c.text || '').join('')).join('')
    || data.output?.[0]?.content?.[0]?.text
    || '';
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) {
    return { error: 'Vision response did not contain JSON' };
  }

  const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  if (typeof parsed.confidence === 'number' && parsed.confidence <= 1) {
    parsed.confidence = Math.round(parsed.confidence * 100);
  }
  return parsed;
}

function scoreVision(listing, vision, thresholds) {
  const photoCount = Array.isArray(listing.photoUrls) ? listing.photoUrls.length : 0;
  const sellerName = String(listing.sellerName || listing.seller || '').toLowerCase();
  const sellerPenalty = /comc|pwcc|probstein|myslabs/i.test(sellerName) ? 6 : 0;
  const photoPenalty = photoCount >= 4 ? 0 : photoCount >= 2 ? 4 : 10;
  const gradingCost = 25;
  const liquidityHaircut = thresholds.liquidityHaircut ?? 0.88;
  const psa9Floor = thresholds.psa9Floor ?? Math.max(0, thresholds.rawMarket * 0.82);
  const floorSafety = thresholds.floorSafety ?? 0.4;
  const gross10Exit = thresholds.psa10Market * liquidityHaircut;
  const gross9Exit = psa9Floor * liquidityHaircut;
  const maxSafeBuy = Math.max(1, Math.round((gross10Exit * thresholds.minGemRate) + (gross9Exit * (1 - thresholds.minGemRate)) - gradingCost - thresholds.minProfit));

  if (!vision || vision.error) {
    const estimatedGrossProfit = Math.round((gross10Exit * 0.55) + (gross9Exit * 0.45) - listing.total - gradingCost);
    const withinBuyRange = listing.total <= thresholds.buyUnder;
    const cheapVsRaw = listing.total <= thresholds.rawMarket * 0.9;
    return {
      recommendation: withinBuyRange && cheapVsRaw && listing.total <= maxSafeBuy ? 'manual-review' : 'watch',
      gradeRank: withinBuyRange && cheapVsRaw && listing.total <= maxSafeBuy ? 'B' : 'C',
      probability: null,
      confidence: 20,
      buyIn: listing.total,
      maxBuyPrice: Math.min(thresholds.buyUnder, maxSafeBuy),
      expectedProfit: estimatedGrossProfit,
      submitProfit: Math.round(estimatedGrossProfit * 0.55),
      submitReady: false,
      offerSuggestion: withinBuyRange ? 'Manual review before buying' : `Only revisit under ${formatMoney(Math.min(thresholds.buyUnder, maxSafeBuy))}`,
      riskFlags: [vision?.error || 'Vision unavailable', ...(photoPenalty ? [`limited photos: ${photoCount || 0}`] : []), ...(sellerPenalty ? [`seller review penalty: ${listing.sellerName || listing.seller || 'marketplace seller'}`] : [])],
      reasons: ['Photo-quality score unavailable, so no blind BUY should be made.'],
      summary: 'Listing found, but image quality analysis was unavailable.'
    };
  }

  const penalties = {
    frontCentering: { strong: 0, okay: 6, borderline: 16, poor: 28, unknown: 12 },
    backCentering: { strong: 0, okay: 3, borderline: 8, poor: 16, unknown: 8 },
    corners: { clean: 0, 'minor wear': 10, 'visible whitening': 18, 'multiple issues': 28, unknown: 12 },
    edges: { clean: 0, 'minor wear': 8, 'visible wear': 16, 'multiple issues': 28, unknown: 12 },
    surface: { clean: 0, 'possible issue': 12, 'visible issue': 28, unknown: 14 },
    occlusion: { none: 0, minor: 8, major: 20 }
  };

  let probability = 88;
  probability -= penalties.frontCentering[vision.frontCentering] ?? 12;
  probability -= penalties.backCentering[vision.backCentering] ?? 8;
  probability -= penalties.corners[vision.corners] ?? 12;
  probability -= penalties.edges[vision.edges] ?? 12;
  probability -= penalties.surface[vision.surface] ?? 14;
  probability -= penalties.occlusion[vision.occlusion] ?? 8;
  probability -= sellerPenalty;
  probability -= photoPenalty;
  probability = Math.max(1, Math.min(99, probability));

  const confidence = Math.max(15, Math.min(95, Number(vision.confidence || 55) - Math.round(photoPenalty / 2) - Math.round(sellerPenalty / 2)));
  const adjustedGemRate = Math.max(0.01, probability / 100);
  const cleanEnoughForReview = !['visible whitening', 'multiple issues'].includes(vision.corners)
    && !['visible wear', 'multiple issues'].includes(vision.edges)
    && !['visible issue'].includes(vision.surface)
    && vision.occlusion !== 'major';
  const conditionMultiplier = cleanEnoughForReview ? 1 : 0.55;
  const confidenceMultiplier = Math.max(0.45, confidence / 100);
  const conservativeExit = ((gross10Exit * adjustedGemRate) + (gross9Exit * (1 - adjustedGemRate))) * conditionMultiplier * confidenceMultiplier;
  const expectedProfit = Math.round(conservativeExit - listing.total - gradingCost);
  const maxBuyByProbability = Math.max(1, Math.round(conservativeExit - gradingCost - thresholds.minProfit));
  const maxBuyByFloor = Math.max(1, Math.round(((gross9Exit - gradingCost) + ((gross10Exit - gross9Exit) * floorSafety)) * conditionMultiplier));
  const maxBuyPrice = Math.max(1, Math.min(thresholds.buyUnder, maxBuyByProbability, maxBuyByFloor, maxSafeBuy));
  const withinBuyRange = listing.total <= maxBuyPrice;
  const submitProfit = Math.round((conservativeExit * 0.82) - listing.total - gradingCost);
  const submitReady = cleanEnoughForReview
    && probability >= thresholds.submitProbability
    && confidence >= thresholds.submitConfidence
    && submitProfit >= thresholds.submitProfitFloor
    && listing.total <= maxBuyPrice;

  let recommendation = 'watch';

  if (probability >= thresholds.buyProbability && confidence >= thresholds.buyConfidence && withinBuyRange && expectedProfit >= thresholds.minProfit) recommendation = 'buy';
  else if (probability >= thresholds.reviewProbability && confidence >= thresholds.reviewConfidence && withinBuyRange && expectedProfit >= Math.round(thresholds.minProfit * 0.55) && cleanEnoughForReview) recommendation = 'manual-review';
  else if (probability <= thresholds.passProbability || confidence <= thresholds.passConfidence || listing.total > maxBuyPrice * 1.08 || expectedProfit < Math.round(thresholds.minProfit * 0.35) || !cleanEnoughForReview) recommendation = 'pass';

  const gradeRank = recommendation === 'buy' ? 'A' : recommendation === 'manual-review' ? 'B' : recommendation === 'watch' ? 'C' : 'D';
  const riskFlags = [];
  if (vision.corners !== 'clean') riskFlags.push(`corners: ${vision.corners}`);
  if (vision.edges !== 'clean') riskFlags.push(`edges: ${vision.edges}`);
  if (vision.surface !== 'clean') riskFlags.push(`surface: ${vision.surface}`);
  if (vision.occlusion !== 'none') riskFlags.push(`occlusion: ${vision.occlusion}`);
  if (photoPenalty) riskFlags.push(`limited photos: ${photoCount}`);
  if (sellerPenalty) riskFlags.push(`seller review penalty: ${listing.sellerName || listing.seller || 'marketplace seller'}`);
  if (!riskFlags.length) riskFlags.push('no obvious major visual flags');

  return {
    recommendation,
    gradeRank,
    probability,
    confidence,
    buyIn: listing.total,
    maxBuyPrice,
    expectedProfit,
    offerSuggestion: listing.total <= maxBuyPrice ? 'Buy at ask' : `Offer around $${maxBuyPrice}`,
    submitProfit,
    submitReady,
    riskFlags,
    reasons: [
      `Front centering: ${vision.frontCentering}`,
      `Back centering: ${vision.backCentering}`,
      `Corners: ${vision.corners}`,
      `Edges: ${vision.edges}`,
      `Surface: ${vision.surface}`
    ],
    summary: vision.summary || 'Structured vision score generated.'
  };
}

const TARGETS = [
  {
    name: 'Nami OP09-070',
    code: 'OP09-070',
    queryName: 'Nami OP09-070 Best Selection',
    searches: ['"Nami OP09-070" one piece', '"OP09-070" nami card', '"Nami Best Selection" one piece'],
    required: ['nami'],
    requiredAny: ['op09-070', 'best selection'],
    rawRequiredAny: ['op09-070', 'best selection', 'premium card collection'],
    soldRequiredAny: ['best selection', 'premium card collection'],
    soldForbidden: ['purple promo', 'promo parallel', 'gengar', 'vol. 4 japanese', ' jp'],
    forbidden: ['japanese', 'japan', 's-chinese', 'simplified chinese', 'chinese', 'korean', 'thai', 'psa', 'bgs', 'cgc', 'proxy', 'custom', 'lot', 'playset'],
    rawMarketFallback: 51.36,
    psa10Fallback: 230,
    buyUnderFallback: 55,
    psa9FloorFallback: 46,
    liquidityHaircut: 0.9,
    minGemRate: 0.42,
    floorSafety: 0.28,
    minProfit: 55,
    buyProbability: 86,
    buyConfidence: 74,
    reviewProbability: 72,
    reviewConfidence: 60,
    passProbability: 54,
    passConfidence: 46,
    psa9Risk: 'weak protection',
    submitProbability: 74,
    submitConfidence: 62,
    submitProfitFloor: 35,
    priority: 'core',
    marketSource: 'manual_recent_psa_sales'
  },
  {
    name: 'Boa Hancock ST03-013',
    code: 'ST03-013',
    queryName: 'Boa Hancock ST03-013 Best Selection',
    searches: ['"Boa Hancock ST03-013" one piece', '"ST03-013" boa hancock card', '"Boa Hancock Best Selection" one piece'],
    required: ['boa'],
    requiredAny: ['st03-013', 'best selection', 'hancock'],
    rawRequiredAny: ['st03-013', 'best selection', 'premium card collection'],
    soldRequiredAny: ['best selection', 'premium card collection', 'vol. 2'],
    soldForbidden: ['op06', 'treasure rare', 'prb01', 'alternate art', 'alt art', 'super', 'parallel', 'japanese', 'china', 'chinese'],
    forbidden: ['japanese', 'japan', 's-chinese', 'simplified chinese', 'chinese', 'korean', 'thai', 'psa', 'bgs', 'cgc', 'proxy', 'custom', 'lot', 'playset'],
    rawMarketFallback: 25.28,
    psa10Fallback: 188.75,
    buyUnderFallback: 28,
    psa9FloorFallback: 21,
    liquidityHaircut: 0.9,
    minGemRate: 0.48,
    floorSafety: 0.34,
    minProfit: 32,
    buyProbability: 84,
    buyConfidence: 72,
    reviewProbability: 69,
    reviewConfidence: 58,
    passProbability: 53,
    passConfidence: 45,
    psa9Risk: 'real downside',
    submitProbability: 72,
    submitConfidence: 60,
    submitProfitFloor: 24,
    priority: 'core'
  },
  {
    name: 'Perona OP10-092',
    code: 'OP10-092',
    queryName: 'Perona OP10-092 Best Selection',
    searches: ['"Perona OP10-092" one piece', '"OP10-092" perona card', '"Perona Best Selection" one piece'],
    required: ['perona'],
    requiredAny: ['op10-092', 'best selection'],
    rawRequiredAny: ['op10-092'],
    soldRequiredAny: ['best selection', 'premium card', 'vol.4'],
    soldForbidden: ['finalist', 'tp pk', 'championship', 'japanese'],
    forbidden: ['japanese', 'japan', 's-chinese', 'simplified chinese', 'chinese', 'korean', 'thai', 'psa', 'bgs', 'cgc', 'proxy', 'custom', 'lot', 'playset'],
    rawMarketFallback: 6.8,
    psa10Fallback: 103.49,
    buyUnderFallback: 8,
    psa9FloorFallback: 5,
    liquidityHaircut: 0.87,
    minGemRate: 0.52,
    floorSafety: 0.42,
    minProfit: 24,
    buyProbability: 82,
    buyConfidence: 70,
    reviewProbability: 66,
    reviewConfidence: 56,
    passProbability: 52,
    passConfidence: 44,
    psa9Risk: '9 kills most edge',
    submitProbability: 74,
    submitConfidence: 62,
    submitProfitFloor: 18,
    priority: 'core'
  },
  {
    name: 'Nico Robin OP09-062',
    code: 'OP09-062',
    queryName: 'Nico Robin OP09-062 Leader Alternate Art',
    searches: ['"Nico Robin OP09-062" one piece', '"OP09-062" nico robin leader', '"Nico Robin leader alt art" one piece'],
    required: ['robin'],
    requiredAny: ['op09-062', 'leader'],
    rawRequiredAny: ['op09-062', 'leader'],
    soldRequiredAny: ['leader', 'alt art', 'alternative art', 'parallel'],
    soldForbidden: ['jpn', 'japanese', 'gift collection', '25th anniversary', 'eb03', 'op12', 'op07', 'op01', 'p-111', 'wafers', 'carddass', 'championship', 'finals'],
    forbidden: ['japanese', 'japan', 's-chinese', 'simplified chinese', 'chinese', 'korean', 'thai', 'psa', 'bgs', 'cgc', 'proxy', 'custom', 'lot', 'playset'],
    rawMarketFallback: 70,
    psa10Fallback: 155,
    buyUnderFallback: 55,
    psa9FloorFallback: 52,
    liquidityHaircut: 0.86,
    minGemRate: 0.5,
    floorSafety: 0.45,
    minProfit: 26,
    buyProbability: 84,
    buyConfidence: 72,
    reviewProbability: 68,
    reviewConfidence: 58,
    passProbability: 54,
    passConfidence: 46,
    psa9Risk: 'ugly downside if it 9s',
    submitProbability: 76,
    submitConfidence: 64,
    submitProfitFloor: 20,
    priority: 'secondary'
  }
];

function formatMoney(n) {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return `$${n.toFixed(2)}`;
}

async function loadSeenState() {
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { seen: {} };
  } catch {
    return { seen: {} };
  }
}

async function saveSeenState(state) {
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

const execFileAsync = promisify(execFile);

async function runGit(args, cwd) {
  return execFileAsync('git', args, { cwd, windowsHide: true });
}

async function updateDashboardFeed({ generatedAt, sections, freshSections, alertSections }) {
  const cards = sections.filter((section) => section.best).map((section) => ({
    name: section.target.name,
    code: section.target.code,
    priority: section.target.priority,
    rawMarket: section.rawMarket,
    psa10Market: section.psa10Market,
    buyUnder: section.buyUnder,
    psa9Risk: section.target.psa9Risk,
    isNew: section.isNew,
    pricingSource: section.pricingSource,
    pricingNotes: section.pricingNotes,
    shouldAlert: ['buy', 'manual-review'].includes(section.analysis?.recommendation),
    listingKey: section.listingKey,
    best: section.best ? {
      title: section.best.title,
      price: section.best.price,
      shipping: section.best.shipping,
      total: section.best.total,
      seller: section.best.sellerName || section.best.seller || null,
      condition: section.best.condition || null,
      link: section.best.sourceUrl || section.best.url || null
    } : null,
    analysis: section.analysis ? {
      recommendation: section.analysis.recommendation,
      gradeRank: section.analysis.gradeRank,
      probability: section.analysis.probability,
      confidence: section.analysis.confidence,
      expectedProfit: section.analysis.expectedProfit,
      submitProfit: section.analysis.submitProfit,
      submitReady: section.analysis.submitReady,
      offerSuggestion: section.analysis.offerSuggestion,
      riskFlags: section.analysis.riskFlags || []
    } : null
  }));

  const payload = {
    generatedAt,
    updatedAt: new Date().toISOString(),
    newListingCount: freshSections.length,
    alertCount: alertSections.length,
    tracked: sections.map((section) => section.target.name),
    coreTracked: sections.filter((section) => section.target.priority === 'core').map((section) => section.target.name),
    experimentalTracked: sections.filter((section) => section.target.priority !== 'core').map((section) => section.target.name),
    cards,
    coreCards: cards.filter((card) => card.priority === 'core'),
    experimentalCards: cards.filter((card) => card.priority !== 'core'),
    staleTargets: sections.filter((section) => !section.best).map((section) => section.target.name)
  };

  await fs.writeFile(DASHBOARD_DATA_PATH, JSON.stringify(payload, null, 2), 'utf8');

  if (!freshSections.length) return false;

  await runGit(['add', 'latest.json'], DASHBOARD_DIR);
  try {
    await runGit(['commit', '-m', `Update sniper data ${generatedAt.slice(0, 16).replace('T', ' ')}`], DASHBOARD_DIR);
  } catch (error) {
    const stderr = String(error.stderr || error.stdout || error.message || '');
    if (!/nothing to commit/i.test(stderr)) throw error;
    return false;
  }
  await runGit(['push'], DASHBOARD_DIR);
  return true;
}

function bestListing(items, rawMarket) {
  if (!items.length) return null;
  const hardFloor = Math.max(1, rawMarket * 0.35);
  const softFloor = Math.max(1, rawMarket * 0.55);
  const viable = items.filter((item) => item.total >= hardFloor);
  const pool = viable.length ? viable : items;
  const sorted = pool.slice().sort((a, b) => a.total - b.total);
  const realistic = sorted.find((item) => item.total >= softFloor);
  return realistic || sorted[0];
}

async function run() {
  await loadEnv();
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const seenState = await loadSeenState();
  const [{ research, topPriority }, marketSources] = await Promise.all([
    parseResearchFiles(),
    loadMarketSources()
  ]);
  const now = new Date();
  const sections = [];

  for (const target of TARGETS) {
    const combined = [];
    for (const query of target.searches) {
      const items = await searchListings(query, { limit: 15 });
      combined.push(...items.map(normalize));
    }

    const filtered = filterMatches(dedupe(combined), target).sort((a, b) => a.total - b.total).slice(0, 10);
    const reference = [...research.values()].find((entry) => entry.heading.toLowerCase().includes(target.name.toLowerCase()) || entry.heading.toLowerCase().includes(target.queryName.toLowerCase()));
    const liveMarketSource = await buildRecentPsa10MarketSource(target).catch(() => null);
    const marketOverride = liveMarketSource || marketSources[target.code] || null;
    const rawMarket = reference?.rawMarket ?? target.rawMarketFallback;
    const psa10Market = marketOverride?.psa10Market
      ?? (target.marketSource === 'manual_recent_psa_sales'
        ? target.psa10Fallback
        : (reference?.psa10Market ?? target.psa10Fallback));
    const buyUnder = marketOverride?.buyUnder
      ?? (target.marketSource === 'manual_recent_psa_sales'
        ? target.buyUnderFallback
        : (reference?.buyUnder ?? target.buyUnderFallback));
    const best = bestListing(filtered, rawMarket);

    let detail = null;
    let vision = null;
    let analysis = null;
    if (best?.itemId) {
      try {
        const browse = await fetchBrowseItem(best.itemId);
        detail = normalizeBrowse(browse, best);
        vision = await analyzeImages({
          itemId: detail.itemId,
          title: detail.title,
          photoUrls: detail.photoUrls
        });
        analysis = scoreVision(detail, vision, {
          buyUnder,
          psa10Market,
          rawMarket,
          psa9Floor: target.psa9FloorFallback,
          liquidityHaircut: target.liquidityHaircut,
          minGemRate: target.minGemRate,
          floorSafety: target.floorSafety,
          minProfit: target.minProfit,
          buyProbability: target.buyProbability,
          buyConfidence: target.buyConfidence,
          reviewProbability: target.reviewProbability,
          reviewConfidence: target.reviewConfidence,
          passProbability: target.passProbability,
          passConfidence: target.passConfidence
        });
      } catch (error) {
        analysis = {
          recommendation: 'watch',
          gradeRank: 'B',
          probability: 55,
          confidence: 40,
          buyIn: best.total,
          maxBuyPrice: buyUnder,
          expectedProfit: null,
          offerSuggestion: 'Need manual detail review',
          riskFlags: [error.message],
          reasons: ['Failed to fetch or analyze listing detail.'],
          summary: 'Detail fetch failed.'
        };
      }
    }

    const finalBest = detail || best;
    const listingKey = finalBest?.itemId || finalBest?.sourceUrl || finalBest?.url || null;
    const targetSeen = seenState.seen[target.code] || [];
    const isNew = listingKey ? !targetSeen.includes(listingKey) : false;

    sections.push({
      target,
      rawMarket,
      psa10Market,
      buyUnder,
      best: finalBest,
      reference,
      vision,
      analysis,
      filtered,
      listingKey,
      isNew,
      estimatedSpread: psa10Market - rawMarket,
      pricingSource: marketOverride?.source || target.marketSource || (reference ? 'research_sheet' : 'fallback'),
      pricingNotes: marketOverride?.notes || null
    });
  }

  sections.sort((a, b) => {
    const priorityScore = (x) => x.target.priority === 'core' ? 2 : 1;
    return priorityScore(b) - priorityScore(a)
      || ((b.analysis?.expectedProfit ?? -9999) - (a.analysis?.expectedProfit ?? -9999))
      || (b.estimatedSpread - a.estimatedSpread);
  });

  const report = [];
  report.push('# One Piece Hybrid Scan');
  report.push(`Generated: ${now.toISOString()}`);
  report.push('');
  report.push('## Core board');
  for (const section of sections.filter((section) => section.target.priority === 'core')) report.push(`- ${section.target.name}`);
  report.push('');
  report.push('## Experimental watchlist');
  for (const section of sections.filter((section) => section.target.priority !== 'core')) report.push(`- ${section.target.name}`);
  report.push('');

  for (const section of sections) {
    report.push(`## ${section.target.name}`);
    report.push(`- Raw market: ${formatMoney(section.rawMarket)}`);
    report.push(`- PSA 10 market: ${formatMoney(section.psa10Market)}`);
    report.push(`- Buy-under threshold: ${formatMoney(section.buyUnder)}`);
    report.push(`- Pricing source: ${section.pricingSource}`);
    if (section.pricingNotes) report.push(`- Pricing notes: ${section.pricingNotes}`);
    report.push(`- PSA 9 risk: ${section.target.psa9Risk}`);
    if (section.best) {
      report.push(`- Best live listing price: ${formatMoney(section.best.price)}`);
      report.push(`- Shipping: ${formatMoney(section.best.shipping)}`);
      report.push(`- Best live listing total: ${formatMoney(section.best.total)}`);
      report.push(`- Seller: ${section.best.sellerName || section.best.seller || 'unknown'}`);
      report.push(`- Condition: ${section.best.condition || 'unknown'}`);
      report.push(`- Is new listing: ${section.isNew ? 'YES' : 'NO'}`);
      report.push(`- Recommendation: ${String(section.analysis?.recommendation || 'watch').toUpperCase()}`);
      report.push(`- Grade rank: ${section.analysis?.gradeRank || 'C'}`);
      report.push(`- PSA 10 probability: ${section.analysis?.probability == null ? 'n/a' : `${section.analysis.probability}%`}`);
      report.push(`- Confidence: ${section.analysis?.confidence ?? 'n/a'}%`);
      report.push(`- Est. profit after grading/fees: ${section.analysis?.expectedProfit == null ? 'n/a' : formatMoney(section.analysis.expectedProfit)}`);
      report.push(`- Submission-worthy profit: ${section.analysis?.submitProfit == null ? 'n/a' : formatMoney(section.analysis.submitProfit)}`);
      report.push(`- Submission-ready: ${section.analysis?.submitReady ? 'YES' : 'NO'}`);
      report.push(`- Offer suggestion: ${section.analysis?.offerSuggestion || 'n/a'}`);
      if (section.best.total < section.rawMarket * 0.55) {
        report.push(`- Guardrail note: listing is far below reference raw market, so treat as suspicious or verify exact version/photos carefully.`);
      }
      if (section.vision?.summary) report.push(`- Vision summary: ${section.vision.summary}`);
      if (section.analysis?.riskFlags?.length) report.push(`- Risk flags: ${section.analysis.riskFlags.join('; ')}`);
      report.push(`- Link: ${section.best.sourceUrl || section.best.url || 'n/a'}`);
      report.push(`- Title: ${section.best.title}`);
    } else {
      report.push('- Best live listing total: none found');
      report.push('- Recommendation: PASS');
    }
    report.push('');
  }

  if (topPriority.length) {
    report.push('## Research priority list snapshot');
    for (const item of topPriority.slice(0, 5)) report.push(`- ${item}`);
    report.push('');
  }

  const outPath = path.join(OUTPUT_DIR, `scan-${now.toISOString().slice(0, 10)}.md`);
  await fs.writeFile(outPath, report.join('\n'), 'utf8');

  const freshSections = sections.filter((section) => section.best && section.isNew);

  for (const section of sections) {
    const listingKey = section.listingKey;
    if (!listingKey) continue;
    const existing = new Set(seenState.seen[section.target.code] || []);
    existing.add(listingKey);
    seenState.seen[section.target.code] = Array.from(existing).slice(-50);
  }
  await saveSeenState(seenState);

  const alertSections = freshSections.filter((section) => ['buy', 'manual-review'].includes(section.analysis?.recommendation));

  const dashboardPushed = await updateDashboardFeed({
    generatedAt: now.toISOString(),
    sections,
    freshSections,
    alertSections
  });

  const summary = [];
  summary.push('One Piece hybrid scan complete.');
  summary.push(`Report: ${outPath}`);
  summary.push('');
  summary.push('Core board:');
  for (const section of sections.filter((section) => section.target.priority === 'core')) summary.push(`- ${section.target.name}`);
  summary.push('');
  summary.push('Experimental watchlist:');
  for (const section of sections.filter((section) => section.target.priority !== 'core')) summary.push(`- ${section.target.name}`);
  summary.push('');

  const actionable = alertSections;
  if (!freshSections.length) {
    summary.push('Quiet summary: no new listings since the last scan.');
  } else if (!actionable.length) {
    summary.push('Quiet summary: new listings appeared, but none cleared the alert threshold.');
    for (const section of freshSections.slice(0, 3)) {
      summary.push(`${section.target.name} ${String(section.analysis?.recommendation || 'watch').toUpperCase()}`);
      summary.push(`- All-in price: ${formatMoney(section.best.total)} (${formatMoney(section.best.price)} + ${formatMoney(section.best.shipping)} shipping)`);
      summary.push(`- Why not alerted: ${section.analysis?.riskFlags?.slice(0, 2).join('; ') || 'did not meet review threshold'}`);
      summary.push(`- Link: ${section.best.sourceUrl || section.best.url || 'n/a'}`);
    }
  } else {
    for (const section of actionable) {
      summary.push(`${section.target.name} ${String(section.analysis?.recommendation || 'watch').toUpperCase()}`);
      summary.push(`- All-in price: ${formatMoney(section.best.total)} (${formatMoney(section.best.price)} + ${formatMoney(section.best.shipping)} shipping)`);
      summary.push(`- Buy-under: ${formatMoney(section.buyUnder)}`);
      summary.push(`- Est. profit after grading/fees: ${section.analysis?.expectedProfit == null ? 'n/a' : formatMoney(section.analysis.expectedProfit)}`);
      summary.push(`- Submission-worthy profit: ${section.analysis?.submitProfit == null ? 'n/a' : formatMoney(section.analysis.submitProfit)}`);
      summary.push(`- Submission-ready: ${section.analysis?.submitReady ? 'YES' : 'NO'}`);
      summary.push(`- Confidence: ${section.analysis?.confidence ?? 'n/a'}%`);
      summary.push(`- Offer suggestion: ${section.analysis?.offerSuggestion || 'n/a'}`);
      summary.push(`- Link: ${section.best.sourceUrl || section.best.url || 'n/a'}`);
    }
  }

  summary.push('');
  summary.push(`Dashboard feed updated: ${DASHBOARD_DATA_PATH}`);
  summary.push(`Dashboard pushed to GitHub: ${dashboardPushed ? 'YES' : 'NO'}`);

  console.log(summary.join('\n'));
}

run().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
