import { isAuthorizedRequest, isProtectionEnabled, sendUnauthorized } from '../../auth.js';

function extractEbayItemId(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';

  const trimmed = rawUrl.trim();
  const patterns = [
    /\/itm\/(?:[^/?#]+\/)?(\d{9,})/i,
    /\/p\/(\d{9,})/i,
    /[?&](?:item|itm|itemid)=?(\d{9,})/i,
    /[?&](?:id|ul_noapp)=?(\d{9,})/i,
    /(?:^|[^\d])(\d{9,})(?:[^\d]|$)/
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (!host.includes('ebay.')) return '';

    const params = ['item', 'itm', 'itemid', 'id', 'ul_noapp'];
    for (const key of params) {
      const value = parsed.searchParams.get(key);
      if (value && /^\d{9,}$/.test(value)) return value;
    }

    const pathMatch = parsed.pathname.match(/\/(?:itm|p)\/(?:[^/?#]+\/)?(\d{9,})/i);
    if (pathMatch) return pathMatch[1];
  } catch {
    return '';
  }

  return '';
}

export default function handler(req, res) {
  if (isProtectionEnabled() && !isAuthorizedRequest(req)) {
    return sendUnauthorized(res);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { listingUrl } = req.body || {};
  if (!listingUrl || typeof listingUrl !== 'string') {
    return res.status(400).json({ ok: false, error: 'listingUrl is required' });
  }

  const itemId = extractEbayItemId(listingUrl) || null;

  return res.status(200).json({
    ok: true,
    normalized: {
      source: 'ebay',
      listingUrl,
      itemId,
      valid: Boolean(itemId)
    }
  });
}
