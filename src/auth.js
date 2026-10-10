import express from 'express';
import { timingSafeEqual, createHash, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const digest = (s) => createHash('sha256').update(s).digest();
const safeEqual = (a, b) => timingSafeEqual(digest(a), digest(b));

const COOKIE = 'keepwarm_session';
const SESSION_DAYS = 30;
const FAILED_LOGIN_DELAY_MS = 600;
const LOGIN_PAGE = fileURLToPath(new URL('../public/login.html', import.meta.url));
// Files the login page needs before the visitor has signed in.
const PUBLIC_PATHS = new Set(['/healthz', '/login', '/styles.css', '/favicon.svg', '/favicon.ico', '/apple-touch-icon.png']);

const readCookie = (req, name) => {
  for (const part of (req.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
};

// Only same-site paths, so the login form can't be used as an open redirect.
const safeNext = (value) => (typeof value === 'string' && /^\/(?!\/)/.test(value) && !value.startsWith('/\\') ? value : '/');

const isHttps = (req) => req.secure || req.get('x-forwarded-proto') === 'https';

// Password login for the dashboard. Browsers get a login page and a signed session cookie;
// scripts can still send the password with HTTP Basic auth (any username). /healthz stays public.
export function createAuth(password) {
  // Derived from the password, so sessions survive restarts and changing the password signs everyone out.
  const key = createHash('sha256').update(`keepwarm-session:${password}`).digest();
  const sign = (expires) => createHmac('sha256', key).update(String(expires)).digest('base64url');

  const issueSession = () => {
    const expires = Date.now() + SESSION_DAYS * 86_400_000;
    return `${expires}.${sign(expires)}`;
  };

  const validSession = (req) => {
    const [expires, signature] = (readCookie(req, COOKIE) ?? '').split('.');
    if (!expires || !signature || Number(expires) < Date.now()) return false;
    return safeEqual(signature, sign(expires));
  };

  const validBasic = (req) => {
    const [scheme, encoded] = (req.get('authorization') ?? '').split(' ');
    if (scheme !== 'Basic' || !encoded) return false;
    const decoded = Buffer.from(encoded, 'base64').toString();
    return safeEqual(decoded.slice(decoded.indexOf(':') + 1), password);
  };

  const authenticated = (req) => validSession(req) || validBasic(req);

  const setCookie = (req, res, value, maxAgeSeconds) => {
    const attrs = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
    if (isHttps(req)) attrs.push('Secure');
    res.append('set-cookie', attrs.join('; '));
  };

  const router = express.Router();

  router.get('/login', (req, res) => {
    if (validSession(req)) return res.redirect(303, safeNext(req.query.next));
    res.set('cache-control', 'no-store').sendFile(LOGIN_PAGE);
  });

  router.post('/login', express.urlencoded({ extended: false, limit: '2kb' }), async (req, res) => {
    const next = safeNext(req.body?.next);
    if (typeof req.body?.password === 'string' && safeEqual(req.body.password, password)) {
      setCookie(req, res, issueSession(), SESSION_DAYS * 86_400);
      return res.redirect(303, next);
    }
    // Slow down guessing.
    await new Promise((r) => setTimeout(r, FAILED_LOGIN_DELAY_MS));
    const params = new URLSearchParams({ error: '1' });
    if (next !== '/') params.set('next', next);
    res.redirect(303, `/login?${params}`);
  });

  router.post('/logout', (req, res) => {
    setCookie(req, res, '', 0);
    res.redirect(303, '/login');
  });

  router.use((req, res, next) => {
    if (PUBLIC_PATHS.has(req.path) || authenticated(req)) return next();
    if (req.method === 'GET' && !req.path.startsWith('/api/') && req.accepts(['html', 'json']) === 'html') {
      const params = req.originalUrl === '/' ? '' : `?${new URLSearchParams({ next: req.originalUrl })}`;
      return res.redirect(303, `/login${params}`);
    }
    res.status(401).json({ error: 'authentication required' });
  });

  return router;
}
