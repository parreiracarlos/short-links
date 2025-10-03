// Vercel Edge Function: proxy para o teu Google Apps Script
// Env vars: GAS_BASE, ADMIN_PASS, ADMIN_USER, ADMIN_SECRET

export const config = { runtime: 'edge' };

// ---------- Basic Auth ----------
function basicAuthOk(req) {
  const user = process.env.ADMIN_USER || '';
  const secret = process.env.ADMIN_SECRET || '';
  if (!user || !secret) return true; // sem credenciais → sem login
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

// ---------- Landing super simples (apenas texto/HTML básico) ----------
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

  // Health / home
  if (path === '' || path === 'health') {
    return new Response(landingHtml(GAS), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  // /admin → Basic Auth + iframe
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

  // /qr/<slug> → proxy para o GAS (?qr=)
  if (path.startsWith('qr/')) {
    const slug = decodeURIComponent(path.slice(3));
    const target = GAS + '?qr=' + encodeURIComponent(slug);
    const r = await fetch(target, { headers: forwardHeaders(req) });
    return passthrough(r);
  }

  // /s/<slug> ou /<slug> → resolve no GAS e faz 302 (sem página intermédia)
  if (path) {
    const slug = path.startsWith('s/') ? decodeURIComponent(path.slice(2)) : decodeURIComponent(path);
    if (slug && slug !== 'favicon.ico') {
      const lookupUrl = GAS + '?resolve=' + encodeURIComponent(slug);
      const lookup = await fetch(lookupUrl, { headers: forwardHeaders(req) });
      if (lookup.ok) {
        const targetTxt = (await lookup.text()).trim();
        if (targetTxt && targetTxt !== 'NOT_FOUND') {
          return Response.redirect(targetTxt, 302);
        }
      }
      // Fallback: devolve a página HTML do GAS (com meta refresh)
      const fallbackUrl = GAS + '?s=' + encodeURIComponent(slug);
      const r = await fetch(fallbackUrl, { headers: forwardHeaders(req) });
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
