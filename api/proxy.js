export const config = { runtime: 'edge' };

function basicAuthOk(req) {
  const user = process.env.ADMIN_USER || '';
  const secret = process.env.ADMIN_SECRET || '';
  if (!user || !secret) return true;
  const h = req.headers.get('authorization') || '';
  if (!h.startsWith('Basic ')) return false;
  try {
    const decoded = atob(h.slice(6));
    const idx = decoded.indexOf(':');
    if (idx === -1) return false;
    const u = decoded.slice(0, idx);
    const p = decoded.slice(idx + 1);
    return u === user && p === secret;
  } catch (_) { return false; }
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

function isProbablyUrl(s) {
  try { new URL(s); return true; } catch (_) { return false; }
}

export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/+/, '');
  const GAS  = (process.env.GAS_BASE || '').replace(/\/+$/, '');
  if (!GAS) return new Response('GAS_BASE em falta', { status: 500 });

  if (path === '' || path === 'health') {
    return new Response(landingHtml(GAS), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  if (path === 'admin') {
    if (!basicAuthOk(req)) {
      return new Response('Autenticação requerida', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="admin"' }
      });
    }
    const PASS = process.env.ADMIN_PASS || '';
    if (!PASS) return new Response('ADMIN_PASS não configurado', { status: 403 });
    const html = '<!doctype html><meta charset="utf-8"><title>Admin</title>' +
                 '<div style="height:100vh;margin:0;padding:0">' +
                 '<iframe src="' + GAS + '?admin=1&pass=' + encodeURIComponent(PASS) + '"' +
                 ' style="border:0;width:100%;height:100%" allow="clipboard-write *"></iframe>' +
                 '</div>';
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  if (path.startsWith('qr/')) {
    const slug = decodeURIComponent(path.slice(3));
    const r = await fetch(GAS + '?qr=' + encodeURIComponent(slug), { headers: forwardHeaders(req) });
    return passthrough(r);
  }

  // /s/<slug> ou /<slug>
  if (path) {
    const slug = path.startsWith('s/') ? decodeURIComponent(path.slice(2)) : decodeURIComponent(path);
    if (slug && slug !== 'favicon.ico') {
      // tenta o endpoint resolve (texto puro)
      const lookup = await fetch(GAS + '?resolve=' + encodeURIComponent(slug), { headers: forwardHeaders(req) });
      if (lookup.ok) {
        const txt = (await lookup.text()).trim();
        if (txt && txt !== 'NOT_FOUND' && isProbablyUrl(txt)) {
          return Response.redirect(txt, 302);
        }
      }
      // fallback para a página do GAS (com meta refresh)
      const r = await fetch(GAS + '?s=' + encodeURIComponent(slug), { headers: forwardHeaders(req) });
      const resp = passthrough(r);
      resp.headers.set('Cache-Control', 'no-store');
      return resp;
    }
  }

  return new Response('Não encontrado', { status: 404 });
}

function forwardHeaders(req) {
  return {
    'User-Agent': req.headers.get('user-agent') || '',
    'Referer': req.headers.get('referer') || '',
    'X-Forwarded-For': req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '',
    'Accept-Language': req.headers.get('accept-language') || ''
  };
}

function passthrough(r) {
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: r.headers });
}
