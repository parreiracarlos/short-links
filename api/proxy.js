export const config = { runtime: 'edge' };

// auth básica opcional para /admin
function basicAuthOk(req) {
  const user = process.env.ADMIN_USER || '';
  const secret = process.env.ADMIN_SECRET || '';
  if (!user || !secret) return true;
  const h = req.headers.get('authorization') || '';
  if (!h.startsWith('Basic ')) return false;
  try {
    const decoded = atob(h.slice(6));
    const i = decoded.indexOf(':');
    if (i < 0) return false;
    return decoded.slice(0, i) === user && decoded.slice(i + 1) === secret;
  } catch { return false; }
}

function forwardHeaders(req) {
  return {
    'User-Agent'       : req.headers.get('user-agent') || '',
    'Referer'          : req.headers.get('referer') || '',
    'X-Forwarded-For'  : req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '',
    'Accept-Language'  : req.headers.get('accept-language') || ''
  };
}
function passthrough(r) {
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: r.headers });
}
function isPlainUrl(s) {
  const t = (s || '').trim();
  if (!/^https?:\/\//i.test(t)) return false;
  if (/[<>\s]/.test(t))        return false;
  return true;
}
function landingHtml(gas) {
  return '<!doctype html><meta charset="utf-8"><title>Short links</title>' +
         '<div style="font-family:system-ui,Segoe UI,Roboto;padding:24px">' +
         '<h1 style="margin:0 0 8px">Short links</h1>' +
         '<p>Health OK. <a href="' + gas + '" target="_blank" rel="noreferrer noopener">Abrir GAS</a></p>' +
         '<ul><li>Curto: <code>/&lt;slug&gt;</code> ou <code>/s/&lt;slug&gt;</code></li>' +
         '<li>QR: <code>/qr/&lt;slug&gt;</code></li>' +
         '<li>Painel: <code>/admin</code></li></ul></div>';
}

export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/+/, '');
  const GAS  = (process.env.GAS_BASE || '').replace(/\/+$/, '');
  if (!GAS) return new Response('GAS_BASE em falta', { status: 500 });

  // health
  if (path === '' || path === 'health') {
    return new Response(landingHtml(GAS), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  // admin (painel em iframe) – protegido com Basic Auth se definido
  if (path === 'admin') {
    if (!basicAuthOk(req)) {
      return new Response('Autenticação requerida', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="admin"' } });
