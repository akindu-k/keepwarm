import { timingSafeEqual, createHash } from 'node:crypto';

const digest = (s) => createHash('sha256').update(s).digest();

// HTTP Basic auth guarding everything except the health check. Any username is accepted.
export function basicAuth(password) {
  const expected = digest(password);
  return (req, res, next) => {
    if (req.path === '/healthz') return next();
    const header = req.get('authorization') ?? '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString();
      const supplied = decoded.slice(decoded.indexOf(':') + 1);
      if (timingSafeEqual(digest(supplied), expected)) return next();
    }
    res.set('www-authenticate', 'Basic realm="keepwarm", charset="UTF-8"');
    res.status(401).send('Authentication required');
  };
}
