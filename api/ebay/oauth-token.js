let cachedToken = null;
let cachedExpiry = 0;

function redact(value = '') {
  if (!value) return '(missing)';
  if (value.length <= 8) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export async function getEbayAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedExpiry - 60_000) {
    return cachedToken;
  }

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const environment = process.env.EBAY_ENVIRONMENT || 'production';

  if (!clientId || !clientSecret) {
    throw new Error('Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET');
  }

  const baseUrl = environment === 'sandbox'
    ? 'https://api.sandbox.ebay.com'
    : 'https://api.ebay.com';

  const auth = Buffer.from(`${clientId.trim()}:${clientSecret.trim()}`).toString('base64');
  const scope = process.env.EBAY_SCOPE || 'https://api.ebay.com/oauth/api_scope';

  const response = await fetch(`${baseUrl}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${auth}`,
      Accept: 'application/json'
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`
  });

  const rawText = await response.text();
  let data = {};
  try {
    data = JSON.parse(rawText);
  } catch {
    data = { rawText };
  }

  if (!response.ok || !data.access_token) {
    const detail = {
      status: response.status,
      environment,
      clientId: redact(clientId.trim()),
      secretPrefix: redact(clientSecret.trim()),
      error: data.error || null,
      error_description: data.error_description || null,
      scope,
      rawText: typeof data.rawText === 'string' ? data.rawText.slice(0, 500) : null
    };
    throw new Error(`Failed to get eBay token: ${JSON.stringify(detail)}`);
  }

  cachedToken = data.access_token;
  cachedExpiry = now + ((data.expires_in || 7200) * 1000);
  return cachedToken;
}
