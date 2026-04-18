import { isAuthorizedRequest, isProtectionEnabled } from './auth.js';

export default function middleware(req) {
  if (!isProtectionEnabled()) {
    return;
  }

  const pathname = req.url || '/';
  const isLoginRoute = pathname === '/api/login';
  const isLogoutRoute = pathname === '/api/logout';
  const isStaticAsset = pathname.startsWith('/styles.css') || pathname.startsWith('/app.js') || pathname.startsWith('/favicon') || pathname.startsWith('/images/') || pathname.startsWith('/assets/');

  if (isLoginRoute || isLogoutRoute) {
    return;
  }

  if (isAuthorizedRequest(req)) {
    return;
  }

  return {
    status: 302,
    headers: {
      Location: '/api/login'
    },
    body: ''
  };
}
