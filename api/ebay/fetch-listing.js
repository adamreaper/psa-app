import { isAuthorizedRequest, isProtectionEnabled, sendUnauthorized } from '../../auth.js';
import { fetchBrowseItem, normalizeBrowseItem } from './browse-item.js';

export default async function handler(req, res) {
  if (isProtectionEnabled() && !isAuthorizedRequest(req)) {
    return sendUnauthorized(res);
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { itemId, listingUrl } = req.body || {};

    if (!itemId && !listingUrl) {
      return res.status(400).json({ ok: false, error: 'itemId or listingUrl is required' });
    }

    const parsedItemId = itemId || (typeof listingUrl === 'string' ? (listingUrl.match(/\/itm\/(\d{9,})/i)?.[1] || listingUrl.match(/[?&](?:item|itm)=(\d{9,})/i)?.[1] || null) : null);

    if (!parsedItemId) {
      return res.status(400).json({ ok: false, error: 'Could not parse a valid eBay item ID' });
    }

    const browseData = await fetchBrowseItem(parsedItemId);
    const listing = normalizeBrowseItem(browseData, { itemId: parsedItemId, listingUrl });

    return res.status(200).json({
      ok: true,
      mode: 'live-api',
      message: 'Listing fetched from eBay Browse API.',
      listing
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Failed to fetch eBay listing'
    });
  }
}
