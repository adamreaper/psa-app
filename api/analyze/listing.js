import { isAuthorizedRequest, isProtectionEnabled, sendUnauthorized } from '../../auth.js';

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
  const buyIn = price + shipping;

  const penalties = {
    frontCentering: { strong: 0, okay: 6, borderline: 16, poor: 28, unknown: 12 },
    backCentering: { strong: 0, okay: 3, borderline: 8, poor: 16, unknown: 8 },
    corners: { clean: 0, 'minor wear': 10, 'visible whitening': 18, 'multiple issues': 28, unknown: 12 },
    edges: { clean: 0, 'minor wear': 8, 'visible wear': 16, 'multiple issues': 28, unknown: 12 },
    surface: { clean: 0, 'possible issue': 12, 'visible issue': 28, unknown: 14 },
    occlusion: { none: 0, minor: 8, major: 20 }
  };

  const observed = vision || {
    frontCentering: 'unknown',
    backCentering: 'unknown',
    corners: 'unknown',
    edges: 'unknown',
    surface: 'unknown',
    occlusion: 'minor',
    confidence: 55
  };

  let probability = 88;
  probability -= penalties.frontCentering[observed.frontCentering] ?? 12;
  probability -= penalties.backCentering[observed.backCentering] ?? 8;
  probability -= penalties.corners[observed.corners] ?? 12;
  probability -= penalties.edges[observed.edges] ?? 12;
  probability -= penalties.surface[observed.surface] ?? 14;
  probability -= penalties.occlusion[observed.occlusion] ?? 8;
  probability = Math.max(1, Math.min(99, probability));

  const confidence = Math.max(15, Math.min(95, Number(observed.confidence || 55)));
  const maxBuyPrice = Math.max(0, Math.round(price * (probability / 100) * 0.9));
  const expectedProfit = Math.round((price * (probability / 100) * 0.22) - 18);

  let recommendation = 'maybe';
  if (probability >= 78 && confidence >= 70) recommendation = 'buy';
  if (probability <= 52 || confidence <= 45) recommendation = 'pass';

  const gradeRank = recommendation === 'buy' ? 'A' : recommendation === 'maybe' ? 'B' : 'D';

  const riskFlags = [];
  if (observed.corners !== 'clean') riskFlags.push(`corners: ${observed.corners}`);
  if (observed.edges !== 'clean') riskFlags.push(`edges: ${observed.edges}`);
  if (observed.surface !== 'clean') riskFlags.push(`surface: ${observed.surface}`);
  if (observed.occlusion !== 'none') riskFlags.push(`occlusion: ${observed.occlusion}`);
  if (!riskFlags.length) riskFlags.push('no obvious major visual flags');

  const reasons = [
    `Front centering assessed as ${observed.frontCentering}.`,
    `Corners assessed as ${observed.corners}.`,
    `Edges assessed as ${observed.edges}.`,
    `Surface assessed as ${observed.surface}.`,
    `Occlusion assessed as ${observed.occlusion}.`
  ];

  return res.status(200).json({
    ok: true,
    analysis: {
      recommendation,
      gradeRank,
      probability,
      confidence,
      buyIn,
      maxBuyPrice,
      expectedProfit,
      offerSuggestion: price <= maxBuyPrice ? 'Buy at ask' : `Offer around $${maxBuyPrice}`,
      riskFlags,
      reasons,
      summary: 'Analysis generated from listing data plus structured vision observations.'
    }
  });
}
