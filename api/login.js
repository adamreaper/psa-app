import fs from 'node:fs';
import path from 'node:path';
import { getLoginPageHtml, isAuthorizedRequest, isProtectionEnabled, setAuthCookie } from '../auth.js';

function getAppHtml() {
  const filePath = path.join(process.cwd(), 'index.html');
  return fs.readFileSync(filePath, 'utf8');
}

export default async function handler(req, res) {
  if (!isProtectionEnabled()) {
    return res.status(200).send(getAppHtml());
  }

  if (req.method === 'GET') {
    if (isAuthorizedRequest(req)) {
      return res.status(200).send(getAppHtml());
    }
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
  return res.status(200).json({ ok: true });
}
