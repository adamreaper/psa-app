const fs = require('fs');

const env = fs.readFileSync('psa-app/.env.local', 'utf8').split(/\r?\n/).filter(Boolean);
for (const line of env) {
  const i = line.indexOf('=');
  if (i > 0) process.env[line.slice(0, i)] = line.slice(i + 1);
}

function parseEbayUrl(url) {
  const patterns = [/\/itm\/(\d{9,})/i, /[?&]item=(\d{9,})/i, /[?&]itm=(\d{9,})/i];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return '';
}

async function getToken() {
  const auth = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64');
  const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${auth}`
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope'
    })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || 'eBay token failed');
  return data.access_token;
}

async function fetchListing(itemId) {
  const token = await getToken();
  const response = await fetch(`https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${encodeURIComponent(itemId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': process.env.EBAY_MARKETPLACE_ID || 'EBAY_US',
      Accept: 'application/json'
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.errors?.[0]?.message || 'eBay browse fetch failed');
  return {
    itemId,
    title: data.title,
    price: Number(data.price?.value || 0),
    shipping: Number(data.shippingOptions?.[0]?.shippingCost?.value || 0),
    sellerName: data.seller?.username || 'Unknown seller',
    photoUrls: [data.image?.imageUrl, ...(data.additionalImages || []).map(x => x.imageUrl)].filter(Boolean)
  };
}

async function imageToDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image fetch failed: ${url}`);
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const arrayBuffer = await response.arrayBuffer();
  return `data:${contentType};base64,${Buffer.from(arrayBuffer).toString('base64')}`;
}

async function analyzeImages(listing) {
  const sampled = listing.photoUrls.slice(0, 3);
  const images = await Promise.all(sampled.map(imageToDataUrl));
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      input: [{
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `You are analyzing collectible trading card listing photos for PSA 10 grading potential. Return strict JSON only. Assess only what is visible. Be conservative. Output this exact shape: {"frontCentering":"strong|okay|borderline|poor|unknown","backCentering":"strong|okay|borderline|poor|unknown","corners":"clean|minor wear|visible whitening|multiple issues|unknown","edges":"clean|minor wear|visible wear|multiple issues|unknown","surface":"clean|possible issue|visible issue|unknown","occlusion":"none|minor|major","confidence":0,"summary":"short summary"}`
          },
          ...images.map(image => ({ type: 'input_image', image_url: image, detail: 'high' }))
        ]
      }]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'OpenAI vision failed');
  const text = data.output_text || JSON.stringify(data.output || []);
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error(`No JSON in vision output: ${text.slice(0, 2000)}`);
  }
  return JSON.parse(text.slice(jsonStart, jsonEnd + 1));
}

(async () => {
  try {
    const shortUrl = 'https://ebay.us/m/G8Xhvb';
    const resolved = await fetch(shortUrl, { redirect: 'follow' });
    const finalUrl = resolved.url;
    const itemId = parseEbayUrl(finalUrl) || '137230212677';
    const listing = await fetchListing(itemId);
    const vision = await analyzeImages(listing);
    console.log(JSON.stringify({ finalUrl, itemId, listing, vision }, null, 2));
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
