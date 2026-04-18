import { getLoginPageHtml, isProtectionEnabled, setAuthCookie } from '../auth.js';

export default async function handler(req, res) {
  if (!isProtectionEnabled()) {
    return res.status(200).send(getLoginPageHtml('APP_PASSWORD is not set yet.'));
  }

  if (req.method === 'GET') {
    return res.status(200).send(getLoginPageHtml());
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const submitted = req.body?.password || '';
  if (submitted !== process.env.APP_PASSWORD) {
    return res.status(401).send(getLoginPageHtml('Wrong password.'));
  }

  setAuthCookie(res);
  res.statusCode = 302;
  res.setHeader('Location', '/');
  return res.end();
}
