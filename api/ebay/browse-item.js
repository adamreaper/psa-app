import { getEbayAccessToken } from './oauth-token.js';

export async function fetchBrowseItem(itemId) {
  if (!itemId) {
    throw new Error('itemId is required');
  }

  const token = await getEbayAccessToken();
  const marketplaceId = process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';

  const response = await fetch(`https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${encodeURIComponent(itemId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
      Accept: 'application/json'
    }
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.errors?.[0]?.message || 'Failed to fetch eBay browse item');
  }

  return data;
}

export function normalizeBrowseItem(data, fallback = {}) {
  const seller = data.seller?.username || data.seller?.feedbackPercentage || 'Unknown seller';
  const imageUrls = [
    data.image?.imageUrl,
    ...(Array.isArray(data.additionalImages) ? data.additionalImages.map(img => img.imageUrl) : [])
  ].filter(Boolean);

  return {
    itemId: fallback.itemId || data.itemId || null,
    title: data.title || fallback.title || 'Untitled eBay listing',
    price: Number(data.price?.value || 0),
    shipping: Number(data.shippingOptions?.[0]?.shippingCost?.value || 0),
    sellerName: seller,
    sellerScore: null,
    photoUrls: imageUrls,
    sourceUrl: data.itemWebUrl || fallback.listingUrl || null
  };
}
