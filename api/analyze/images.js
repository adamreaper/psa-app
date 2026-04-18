import { isAuthorizedRequest, isProtectionEnabled, sendUnauthorized } from '../../auth.js';

async function fetchImageAsDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${url}`);
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  return `data:${contentType};base64,${base64}`;
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

    const sampledUrls = imageUrls.slice(0, 4);
    const imageInputs = await Promise.all(sampledUrls.map(fetchImageAsDataUrl));

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
      sampledImages: sampledUrls
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Vision analysis failed' });
  }
}
