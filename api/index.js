import fs from 'node:fs';
import path from 'node:path';
import { getLoginPageHtml, isAuthorizedRequest, isProtectionEnabled } from '../auth.js';

function getAppHtml() {
  const filePath = path.join(process.cwd(), 'index.html');
  return fs.readFileSync(filePath, 'utf8');
}

export default async function handler(req, res) {
  if (!isProtectionEnabled()) {
    return res.status(200).send(getAppHtml());
  }

  if (!isAuthorizedRequest(req)) {
    return res.status(200).send(getLoginPageHtml());
  }

  return res.status(200).send(getAppHtml());
}
