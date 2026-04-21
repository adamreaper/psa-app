import { isAuthorizedRequest, isProtectionEnabled, sendUnauthorized } from '../../auth.js';

const QUALITY_SCORES = {
  frontCentering: { strong: 1, okay: 0.84, borderline: 0.58, poor: 0.25, unknown: 0.68 },
  backCentering: { strong: 1, okay: 0.9, borderline: 0.72, poor: 0.45, unknown: 0.78 },
  corners: { clean: 1, 'minor wear': 0.78, 'visible whitening': 0.48, 'multiple issues': 0.2, unknown: 0.64 },
  edges: { clean: 1, 'minor wear': 0.82, 'visible wear': 0.52, 'multiple issues': 0.24, unknown: 0.66 },
  surface: { clean: 1, 'possible issue': 0.7, 'visible issue': 0.3, unknown: 0.6 },
  occlusion: { none: 1, minor: 0.84, major: 0.45 }
};

const FIELD_WEIGHTS = {
  frontCentering: 0.24,
  backCentering: 0.12,
  corners: 0.23,
  edges: 0.17,
  surface: 0.18,
  occlusion: 0.06
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundMoney(value) {
  return Math.round(Number(value || 0));
}

function getObservedVision(vision) {
  return vision || {
    frontCentering: 'unknown',
    backCentering: 'unknown',
    corners: 'unknown',
    edges: 'unknown',
    surface: 'unknown',
    occlusion: 'minor',
    confidence: 55,
    summary: ''
  };
}

function computeVisualScore(observed) {
  return Object.entries(FIELD_WEIGHTS).reduce((total, [field, weight]) => {
    const value = observed[field];
    const score = QUALITY_SCORES[field]?.[value] ?? 0.6;
    return total + (score * weight);
  }, 0);
}

function computeMetadataAdjustments(listing, observed) {
  const photoCount = Array.isArray(listing.photoUrls) ? listing.photoUrls.length : 0;
  const sellerName = String(listing.sellerName || '').toLowerCase();
  const title = String(listing.title || '').toLowerCase();
  const shipping = Number(listing.shipping || 0);
  const price = Number(listing.price || 0);
  const buyIn = price + shipping;

  let probabilityAdjustment = 0;
  let confidenceAdjustment = 0;
  const reasons = [];

  if (photoCount >= 6) {
    probabilityAdjustment += 4;
    confidenceAdjustment += 10;
    reasons.push(`Photo count is strong at ${photoCount}, which supports a more reliable read.`);
  } else if (photoCount >= 4) {
    probabilityAdjustment += 2;
    confidenceAdjustment += 6;
    reasons.push(`Photo count is usable at ${photoCount}, enough for a decent initial screen.`);
  } else if (photoCount >= 2) {
    probabilityAdjustment -= 4;
    confidenceAdjustment -= 8;
    reasons.push(`Only ${photoCount} photos were available, which limits confidence.`);
  } else {
    probabilityAdjustment -= 10;
    confidenceAdjustment -= 18;
    reasons.push('Photo coverage is very limited, so the grade signal is weaker than it should be.');
  }

  const shippingRatio = price > 0 ? shipping / price : 0;
  if (shippingRatio >= 0.2 && shipping >= 8) {
    probabilityAdjustment -= 3;
    confidenceAdjustment -= 3;
    reasons.push('Shipping is high relative to price, which makes the buy-in less attractive.');
  }

  if (sellerName.includes('consign') || sellerName.includes('vault')) {
    confidenceAdjustment -= 4;
    reasons.push('Seller profile suggests consignment or broker inventory, which can mean less consistent card prep standards.');
  }

  if (title.includes('raw') || title.includes('ungraded')) {
    confidenceAdjustment += 2;
  }

  if (observed.occlusion === 'major') {
    confidenceAdjustment -= 14;
    reasons.push('Major occlusion means too much of the card is hidden to trust a PSA 10 call.');
  } else if (observed.occlusion === 'minor') {
    confidenceAdjustment -= 5;
    reasons.push('Minor occlusion still leaves some blind spots in the review.');
  }

  if (buyIn >= 250) {
    probabilityAdjustment -= 3;
    reasons.push('Higher buy-in raises the bar, so the model gets slightly more conservative.');
  }

  return { probabilityAdjustment, confidenceAdjustment, reasons };
}

function estimateEconomics({ probability, buyIn }) {
  const psa10SaleValue = roundMoney((buyIn * 1.65) + 55);
  const psa9SaleValue = roundMoney((buyIn * 1.08) + 12);
  const gradingFees = 28;
  const sellFees = Math.round(psa10SaleValue * 0.13);
  const psa10Net = psa10SaleValue - gradingFees - sellFees;
  const psa9Net = psa9SaleValue - gradingFees - Math.round(psa9SaleValue * 0.13);
  const expectedNet = Math.round((psa10Net * (probability / 100)) + (psa9Net * (1 - (probability / 100))));
  const expectedProfit = expectedNet - buyIn;
  const maxBuyPrice = Math.max(0, Math.round(expectedNet * 0.82));

  return {
    psa10SaleValue,
    psa10Net,
    psa9Net,
    expectedNet,
    expectedProfit,
    maxBuyPrice
  };
}

function getRecommendation({ probability, confidence, expectedProfit, buyIn, maxBuyPrice }) {
  const atOrBelowTarget = buyIn <= maxBuyPrice;

  if (probability >= 78 && confidence >= 72 && expectedProfit >= 35 && atOrBelowTarget) {
    return { recommendation: 'buy', gradeRank: 'A' };
  }
  if (probability <= 54 || confidence <= 42 || expectedProfit <= -10) {
    return { recommendation: 'pass', gradeRank: 'D' };
  }
  if (probability >= 66 && confidence >= 58 && expectedProfit >= 10) {
    return { recommendation: 'maybe', gradeRank: 'B' };
  }

  return { recommendation: 'pass', gradeRank: 'C' };
}

export default async function handler(req, res) {
  if (isProtectionEnabled() && !isAuthorizedRequest(req)) {
    return sendUnauthorized(res);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { listing, vision } = req.body || {};
  if (!listing) {
    return res.status(400).json({ ok: false, error: 'listing payload is required' });
  }

  const price = Number(listing.price || 0);
  const shipping = Number(listing.shipping || 0);
  const buyIn = roundMoney(price + shipping);
  const observed = getObservedVision(vision);
  const visualScore = computeVisualScore(observed);
  const metadata = computeMetadataAdjustments(listing, observed);

  let probability = Math.round((visualScore * 100) + metadata.probabilityAdjustment);
  probability = clamp(probability, 1, 99);

  let confidence = Math.round(Number(observed.confidence || 55) + metadata.confidenceAdjustment);
  confidence = clamp(confidence, 15, 95);

  const economics = estimateEconomics({ probability, buyIn });
  const verdict = getRecommendation({
    probability,
    confidence,
    expectedProfit: economics.expectedProfit,
    buyIn,
    maxBuyPrice: economics.maxBuyPrice
  });

  const offerSuggestion = buyIn <= economics.maxBuyPrice
    ? 'Buy at ask'
    : economics.maxBuyPrice > 0
      ? `Offer around $${economics.maxBuyPrice}`
      : 'Pass unless the seller drops the price materially';

  const riskFlags = [];
  if (observed.frontCentering !== 'strong') riskFlags.push(`front centering: ${observed.frontCentering}`);
  if (observed.corners !== 'clean') riskFlags.push(`corners: ${observed.corners}`);
  if (observed.edges !== 'clean') riskFlags.push(`edges: ${observed.edges}`);
  if (observed.surface !== 'clean') riskFlags.push(`surface: ${observed.surface}`);
  if (observed.occlusion !== 'none') riskFlags.push(`occlusion: ${observed.occlusion}`);
  if (economics.expectedProfit < 15) riskFlags.push('thin margin after grading and selling fees');
  if (confidence < 60) riskFlags.push('confidence is limited by photo coverage or visibility');
  if (!riskFlags.length) riskFlags.push('clean visual read with workable margin at current buy-in');

  const reasons = [
    `Visual quality score came in at ${Math.round(visualScore * 100)} out of 100 based on centering, corners, edges, surface, and visibility.`,
    `Estimated buy-in is $${buyIn}, with expected PSA 10 net around $${economics.psa10Net}.`,
    `Expected blended profit is $${economics.expectedProfit}, assuming a PSA 10 upside with a weaker fallback outcome if the card misses.`,
    ...metadata.reasons
  ];

  if (observed.summary) {
    reasons.push(`Vision summary: ${observed.summary}`);
  }

  return res.status(200).json({
    ok: true,
    analysis: {
      recommendation: verdict.recommendation,
      gradeRank: verdict.gradeRank,
      probability,
      confidence,
      buyIn,
      maxBuyPrice: economics.maxBuyPrice,
      expectedProfit: economics.expectedProfit,
      offerSuggestion,
      riskFlags,
      reasons,
      summary: `Scored from structured vision plus listing economics. Target max buy is $${economics.maxBuyPrice} against a current buy-in of $${buyIn}.`
    }
  });
}
