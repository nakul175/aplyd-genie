import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export const sessionCookie = '__Host-genie_session';
export const loginCookie = '__Host-genie_login';
export const randomToken = () => randomBytes(32).toString('base64url');
export const digest = value => createHash('sha256').update(value).digest('hex');

export class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

export function readCookie(request, name) {
  const values = (request.headers.cookie ?? '').split(';').map(v => v.trim())
    .filter(v => v.startsWith(`${name}=`)).map(v => v.slice(name.length + 1));
  if (values.length > 1) throw new HttpError(401, 'authentication_required');
  if (!values.length) return undefined;
  if (!/^[A-Za-z0-9_-]{43}$/.test(values[0])) throw new HttpError(401, 'authentication_required');
  return values[0];
}

export function setCookie(response, name, value, seconds) {
  response.append('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`);
}

export function seal(key, purpose, value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`aplyd-genie:v1:${purpose}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

export function open(key, purpose, value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{40,16384}$/.test(value)) throw Error('Invalid sealed value');
  const bytes = Buffer.from(value, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(`aplyd-genie:v1:${purpose}`));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
}

export function secureHeaders(_request, response, next) {
  response.set({
    'Cache-Control': 'no-store', Pragma: 'no-cache', Vary: 'Cookie',
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  });
  next();
}
