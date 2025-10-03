export const config = { runtime: 'edge' };

/* ========= Helpers ========= */

// Auth básica opcional para /admin
function basicAuthOk(req) {
  const user   = process.env.ADMIN_USER   || '';
  const secret = process.env.ADMIN_SECRET || '';
  if (!user || !secret) return true;
  const h = req.headers.get('authorization') || '';
  if (!h.startsWith('Basic ')) return false;
  try {
    const decoded = atob(h.slice(6));
    const i = decoded.indexOf(':');
    if (i < 0) return false;
    return decoded.slice(0, i) === user && decoded.slice(i + 1) === secret;
  } catch {
    return false;
  }
}

function forwardHeaders(req) {
  return {
    'User-Agent'      : req.headers.get('user-agent') || '',
    'Referer'         : req.headers.get('referer') || '',
    'X-Forwarded-For' : req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '',
    'Accept-Language' : req.headers.get('accept-language') || ''
  };
}

function passthrough(r) {
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: r.headers });
}

function isPlainUrl(s) {
  const t = (s || '').trim();
  if (!/^https?:\/\//i.test(t)) return false;
  if (/[<>\s]/.test(t)) return false;
  return true;
}

function landingHtml(gas) {
  return (
    '<!doctype html><meta charset="utf-8"><title>Short links</title>' +
    '<div style="font-family:system-ui,Segoe UI,Roboto;padding:24px">' +
    '<h1 style="margin:0 0 8px">Short links</h1>' +
    '<p>Health OK. <a href="' + gas + '" target="_blank" rel="noreferrer noopener">Abrir GAS</a></p>' +
    '<ul><li>Curto: <code>/&lt;slug&gt;</code> ou <code>/s/&lt;slug&gt;</code></li>' +
    '<li>QR: <code>/qr/&lt;slug&gt;</code></li>' +
    '<li>Painel: <code>/admin</code></li></ul></div>'
  );
}

// Junta UA / referer / ip / country como querystring para o GAS
function traceParams(req) {
  const ua = req.headers.get('user-agent') || '';
  const ref = req.headers.get('referer') || '';
  const ip  = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '';
  const cc  = req.headers.get('x-vercel-ip-country') || req.headers.get('cf-ipcountry') || '';
  const q = new URLSearchParams({ ua, ref, ip, cc }).toString();
  return '&' + q; // vamos sempre juntar a seguir a ?resolve=… ou ?s=…
}

// 404 bonitinho (sem iframe)
function notFoundHtml(slug) {
  return (
    '<!doctype html><meta charset="utf-8"><title>Link não encontrado</title>' +
    '<div style="font-family:system-ui,Segoe UI,Roboto;max-width:720px;margin:12vh auto;padding:24px;' +
    'border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 10px 35px rgba(0,0,0,.06)">' +
    '<h2 style="margin:0 0 6px">Link não encontrado</h2>' +
    '<p style="color:#6b7280;margin:0 0 12px">O slug <code>' + (slug || '') + '</code> não existe ou está inativo.</p>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
    '<a href="/" style="background:#374151;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px">Ir à home</a>' +
    '<a href="/admin" style="background:#6b7280;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px">Abrir painel</a>' +
    '</div></div>'
  );
}

/* ========= Handler ========= */

export default async function handler(req) {
  const url  = new URL(req.url);
  const path = url.pathname.replace(/^\/+/, '');
  const GAS  = (process.env.GAS_BASE || '').replace(/\/+$/, '');
  if (!GAS) return new Response('GAS_BASE em falta', { status: 500 });

  // Health
  if (path === '' || path === 'health') {
    return new Response(landingHtml(GAS), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  // Admin (painel em iframe) – Basic Auth opcional
  if (path === 'admin') {
    if (!basicAuthOk(req)) {
      return new Response('Autenticação requerida', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="admin"' }
      });
    }
    const PASS = process.env.ADMIN_PASS || '';
    if (!PASS) return new Response('ADMIN_PASS não configurado', { status: 403 });

    const html =
      '<!doctype html><meta charset="utf-8"><title>Admin</title>' +
      '<div style="height:100vh;margin:0;padding:0">' +
      '<iframe src="' + GAS + '?admin=1&pass=' + encodeURIComponent(PASS) + '"' +
      ' style="border:0;width:100%;height:100%" allow="clipboard-write *"></iframe>' +
      '</div>';

    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  // QR (sem need de traceParams)
  if (path.startsWith('qr/')) {
    const slug = decodeURIComponent(path.slice(3));
    const r = await fetch(GAS + '?qr=' + encodeURIComponent(slug), { headers: forwardHeaders(req) });
    return passthrough(r);
  }

  // /s/<slug> ou /<slug>
  if (path) {
    const slug = path.startsWith('s/')
      ? decodeURIComponent(path.slice(2))
      : decodeURIComponent(path);

    if (slug && slug !== 'favicon.ico') {
      const trace = traceParams(req);

      // 1) Tentar via ?resolve=<slug> (texto puro) + trace
      let targetTxt = '';
      try {
        const lookup = await fetch(GAS + '?resolve=' + encodeURIComponent(slug) + trace, {
          headers: forwardHeaders(req),
          cache: 'no-store'
        });
        if (lookup.ok) targetTxt = (await lookup.text() || '').trim();
      } catch {
        // silencia e cai no 404 abaixo
      }

      // Encontrado → 302 sem cache
      if (targetTxt && targetTxt !== 'NOT_FOUND' && isPlainUrl(targetTxt)) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: targetTxt,
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            Pragma: 'no-cache',
            Expires: '0'
          }
        });
      }

      // NÃO encontrado → 404 amigável (evita iframe do GAS)
      return new Response(notFoundHtml(slug), {
        status: 404,
        headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }
  }

  return new Response('Não encontrado', { status: 404, headers: { 'Cache-Control': 'no-store' } });
}
