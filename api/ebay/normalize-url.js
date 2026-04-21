import { isAuthorizedRequest, isProtectionEnabled, sendUnauthorized } from '../../auth.js';

const SHORTLINK_TIMEOUT_MS = 8000;

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

async function resolveEbayListingUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';

  const trimmed = rawUrl.trim();
  let parsed;

  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }

  const host = parsed.hostname.toLowerCase();
  if (!host.includes('ebay.')) return trimmed;
  if (!/^(www\.)?ebay\.us$/i.test(host) && !parsed.pathname.startsWith('/m/')) {
    return trimmed;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHORTLINK_TIMEOUT_MS);

  try {
    const response = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
      }
    });

    return response.url || trimmed;
  } catch {
    return trimmed;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
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

  const resolvedUrl = await resolveEbayListingUrl(listingUrl);
  const itemId = extractEbayItemId(resolvedUrl) || extractEbayItemId(listingUrl) || null;

  return res.status(200).json({
    ok: true,
    normalized: {
      source: 'ebay',
      listingUrl: resolvedUrl,
      itemId,
      valid: Boolean(itemId)
    }
  });
}
