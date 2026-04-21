import dns from 'node:dns/promises';
import net from 'node:net';
import { isAuthorizedRequest, isProtectionEnabled, sendUnauthorized } from '../../auth.js';

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 3;

function parseAllowedHosts() {
  const raw = process.env.IMAGE_FETCH_ALLOWLIST || 'i.ebayimg.com,thumbs.ebaystatic.com';
  return raw
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
}

const ALLOWED_HOSTS = parseAllowedHosts();

function isLoopbackOrPrivateIp(ip) {
  if (!net.isIP(ip)) return true;

  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 0) return true;
    return false;
  }

  const normalized = ip.toLowerCase();
  return normalized === '::1'
    || normalized === '::'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe80')
    || normalized.startsWith('::ffff:127.')
    || normalized.startsWith('::ffff:10.')
    || normalized.startsWith('::ffff:192.168.')
    || /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
    || normalized.startsWith('2001:db8');
}

function isAllowedHost(hostname) {
  const normalized = hostname.toLowerCase();
  return ALLOWED_HOSTS.some(allowed => normalized === allowed || normalized.endsWith(`.${allowed}`));
}

async function assertPublicImageUrl(inputUrl) {
  let current = new URL(inputUrl);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (current.protocol !== 'https:') {
      throw new Error('Only https image URLs are allowed');
    }
    if (current.username || current.password) {
      throw new Error('Image URLs cannot include credentials');
    }
    if (current.port && current.port !== '443') {
      throw new Error('Only standard https image URLs are allowed');
    }
    if (!isAllowedHost(current.hostname)) {
      throw new Error(`Host is not allowed: ${current.hostname}`);
    }

    const results = await dns.lookup(current.hostname, { all: true });
    if (!results.length || results.some(result => isLoopbackOrPrivateIp(result.address))) {
      throw new Error(`Refusing to fetch from non-public host: ${current.hostname}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'image/*'
        }
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error('Image redirect missing location header');
        }
        if (redirectCount === MAX_REDIRECTS) {
          throw new Error('Too many redirects while fetching image');
        }
        current = new URL(location, current);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${current}`);
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.startsWith('image/')) {
        throw new Error(`URL did not return an image: ${current.hostname}`);
      }

      const contentLength = Number(response.headers.get('content-length') || '0');
      if (contentLength && contentLength > MAX_IMAGE_BYTES) {
        throw new Error(`Image is too large: ${current.hostname}`);
      }

      const chunks = [];
      let totalBytes = 0;
      for await (const chunk of response.body) {
        totalBytes += chunk.length;
        if (totalBytes > MAX_IMAGE_BYTES) {
          throw new Error(`Image exceeded size limit: ${current.hostname}`);
        }
        chunks.push(chunk);
      }

      const base64 = Buffer.concat(chunks).toString('base64');
      return `data:${contentType};base64,${base64}`;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('Unexpected image fetch state');
}

export default async function handler(req, res) {
  if (isProtectionEnabled() && !isAuthorizedRequest(req)) {
    return sendUnauthorized(res);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { imageUrls = [], title = '', itemId = '' } = req.body || {};
    if (!Array.isArray(imageUrls) || !imageUrls.length) {
      return res.status(400).json({ ok: false, error: 'imageUrls is required' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    if (!apiKey) {
      return res.status(500).json({ ok: false, error: 'Missing OPENAI_API_KEY' });
    }

    const sampledUrls = imageUrls.slice(0, MAX_IMAGES);
    const imageInputs = await Promise.all(sampledUrls.map(assertPublicImageUrl));

    const inputContent = [
      {
        type: 'input_text',
        text: `You are analyzing collectible trading card listing photos for PSA 10 grading potential. Return strict JSON only. Assess only what is visible. Be conservative. For item ${itemId || 'unknown'} titled: ${title || 'Untitled listing'}. Output this exact shape: {"frontCentering":"strong|okay|borderline|poor|unknown","backCentering":"strong|okay|borderline|poor|unknown","corners":"clean|minor wear|visible whitening|multiple issues|unknown","edges":"clean|minor wear|visible wear|multiple issues|unknown","surface":"clean|possible issue|visible issue|unknown","occlusion":"none|minor|major","confidence":0,"summary":"short summary"}`
      },
      ...imageInputs.map(image => ({
        type: 'input_image',
        image_url: image,
        detail: 'high'
      }))
    ];

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: 'user',
            content: inputContent
          }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'OpenAI vision request failed');
    }

    const text = data.output_text
      || data.output?.map(x => x?.content?.map(c => c.text || '').join('')).join('')
      || data.output?.[0]?.content?.[0]?.text
      || '';
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
      throw new Error(`Vision response did not contain JSON: ${text.slice(0, 2000)}`);
    }

    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    if (typeof parsed.confidence === 'number' && parsed.confidence <= 1) {
      parsed.confidence = Math.round(parsed.confidence * 100);
    }

    return res.status(200).json({
      ok: true,
      mode: 'openai-vision',
      vision: parsed,
      sampledImages: sampledUrls,
      imageHostAllowlist: ALLOWED_HOSTS
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Vision analysis failed' });
  }
}
