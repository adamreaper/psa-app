export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { listingUrl } = req.body || {};
  if (!listingUrl || typeof listingUrl !== 'string') {
    return res.status(400).json({ ok: false, error: 'listingUrl is required' });
  }

  const patterns = [/\/itm\/(\d{9,})/i, /[?&]item=(\d{9,})/i, /[?&]itm=(\d{9,})/i];
  let itemId = null;
  for (const pattern of patterns) {
    const match = listingUrl.match(pattern);
    if (match) {
      itemId = match[1];
      break;
    }
  }

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
