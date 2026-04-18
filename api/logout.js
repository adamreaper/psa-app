import { clearAuthCookie } from '../auth.js';

export default async function handler(req, res) {
  clearAuthCookie(res);
  res.statusCode = 302;
  res.setHeader('Location', '/login');
  return res.end();
}
