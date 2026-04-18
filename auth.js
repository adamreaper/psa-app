const AUTH_COOKIE = 'psa_owner_auth';
const LOGIN_PATH = '/api/login';
const HOME_PATH = '/';

function getPassword() {
  return process.env.APP_PASSWORD || '';
}

export function isProtectionEnabled() {
  return Boolean(getPassword());
}

export function parseCookies(req) {
  const header = req.headers?.cookie || '';
  return header.split(';').reduce((acc, part) => {
    const [rawKey, ...rest] = part.trim().split('=');
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

export function isAuthorizedRequest(req) {
  if (!isProtectionEnabled()) return true;
  const cookies = parseCookies(req);
  return cookies[AUTH_COOKIE] === getPassword();
}

export function setAuthCookie(res) {
  const password = getPassword();
  const secure = process.env.NODE_ENV === 'production';
  const cookie = `${AUTH_COOKIE}=${encodeURIComponent(password)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secure ? '; Secure' : ''}`;
  res.setHeader('Set-Cookie', cookie);
}

export function clearAuthCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  const cookie = `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
  res.setHeader('Set-Cookie', cookie);
}

export function sendUnauthorized(res) {
  return res.status(401).json({ ok: false, error: 'Unauthorized' });
}

export function getLoginPageHtml(errorMessage = '') {
  const errorBlock = errorMessage ? `<p style="margin:12px 0 0;color:#ff8080;">${errorMessage}</p>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PSA Scout Login</title>
  <style>
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:#07111f; color:#e8f3ff; font-family:Arial,sans-serif; }
    .card { width:min(92vw,420px); background:rgba(10,20,38,.94); border:1px solid #5eb6ff55; border-radius:18px; padding:28px; box-shadow:0 20px 60px rgba(0,0,0,.45); }
    h1 { margin:0 0 8px; font-size:1.5rem; }
    p { margin:0 0 16px; color:#b8cae0; }
    label { display:block; margin-bottom:8px; font-size:.95rem; }
    input { width:100%; box-sizing:border-box; padding:14px 16px; border-radius:12px; border:1px solid #6bbcff66; background:#09182c; color:#fff; font-size:1rem; }
    button { width:100%; margin-top:14px; padding:14px 16px; border:0; border-radius:12px; background:linear-gradient(135deg,#62d0ff,#7b7dff); color:#08111d; font-weight:700; font-size:1rem; cursor:pointer; }
    .note { margin-top:12px; font-size:.85rem; color:#89a3bf; }
  </style>
</head>
<body>
  <form class="card" method="POST" action="${LOGIN_PATH}">
    <h1>Private PSA Scout</h1>
    <p>This app is locked. Enter your owner password.</p>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required />
    <button type="submit">Unlock</button>
    ${errorBlock}
    <div class="note">Only authorized access is allowed.</div>
  </form>
</body>
</html>`;
}

export { AUTH_COOKIE, LOGIN_PATH, HOME_PATH };
