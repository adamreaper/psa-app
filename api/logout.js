import { clearAuthCookie } from '../auth.js';

export default async function handler(req, res) {
  clearAuthCookie(res);
  res.statusCode = 302;
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Location', '/');
  return res.end();
}
