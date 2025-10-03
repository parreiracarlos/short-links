export const config = { runtime: 'edge' };

/* =========================
   Config simples
   ========================= */
const HOME_URL = 'https://carlosparreira.pt'; // destino do botão "Ir à home"

/* =========================
   Helpers
   ========================= */

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
  return new Response(r.body, {
    status: r.status,
    statusText: r.statusText,
    headers: r.headers
  });
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

// junta UA / referer / ip / country como querystring para o GAS
function traceParams(req) {
  const ua = req.headers.get('user-agent') || '';
  const ref = req.headers.get('referer') || '';
  const ip  = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '';
  const cc  = req.headers.get('x-vercel-ip-country') || req.headers.get('cf-ipcountry') || '';
  const q = new URLSearchParams({ ua, ref, ip, cc }).toString();
  return '&' + q; // vai a seguir a ?resolve=… ou ?s=…
}

// página 404 bonita — apenas 1 botão “Ir à home”
function notFoundHtml(slug) {
  const esc = String(slug || '').replace(/[&<>"']/g, s =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])
  );
  return '<!doctype html><meta charset="utf-8"><title>Link não encontrado</title>' +
    '<style>' +
    '  :root{--bg:#f7f8fb;--card:#fff;--line:#e5e7eb;--text:#111827;--muted:#6b7280;--btn:#374151;--btnH:#111827;}' +
    '  *{box-sizing:border-box} body{margin:0;background:var(--bg);font-family:system-ui,Segoe UI,Roboto;color:var(--text);}' +
    '  .wrap{max-width:960px;margin:8vh auto;padding:20px}' +
    '  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px;box-shadow:0 10px 35px rgba(0,0,0,.06)}' +
    '  h2{margin:0 0 8px} p{color:var(--muted);margin:0 0 12px}' +
    '  .actions{display:flex;gap:10px;margin-top:8px}' +
    '  a.btn{background:var(--btn);color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700;display:inline-block}' +
    '  a.btn:hover{background:var(--btnH)}' +
    '</style>' +
    '<div class="wrap"><div class="card">' +
    '<h2>Link não encontrado</h2>' +
    '<p>O slug <code>' + esc + '</code> não existe ou está inativo.</p>' +
    '<div class="actions">' +
    '<a class="btn" href="' + HOME_URL + '">Ir à home</a>' +
    '</div>' +
    '</div></div>';
}

/* =========================
   Handler
   ========================= */

export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/+/, '');
  const GAS  = (process.env.GAS_BASE || '').replace(/\/+$/, '');
  if (!GAS) return new Response('GAS_BASE em falta', { status: 500 });

  // health
  if (path === '' || path === 'health') {
    return new Response(landingHtml(GAS), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  }

  // admin (painel em iframe) – protegido com Basic Auth se definido
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
    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  }

  // QR (aqui não é preciso traceParams)
  if (path.startsWith('qr/')) {
    const slug = decodeURIComponent(path.slice(3));
    const r = await fetch(GAS + '?qr=' + encodeURIComponent(slug), {
      headers: forwardHeaders(req)
    });
    return passthrough(r);
  }

  // /s/<slug> ou /<slug>
  if (path) {
    const slug = path.startsWith('s/')
      ? decodeURIComponent(path.slice(2))
      : decodeURIComponent(path);

    if (slug && slug !== 'favicon.ico') {
      const trace = traceParams(req);

      // 1) pedir ao GAS o destino em texto (resolve)
      let targetTxt = '';
      try {
        const lookup = await fetch(
          GAS + '?resolve=' + encodeURIComponent(slug) + trace,
          { headers: forwardHeaders(req), cache: 'no-store' }
        );
        if (lookup.ok) targetTxt = (await lookup.text() || '').trim();
      } catch { /* ignore */ }

      // se não existe, mostra 404 com 1 botão "Ir à home"
      if (!targetTxt || targetTxt === 'NOT_FOUND') {
        return new Response(notFoundHtml(slug), {
          status: 404,
          headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
        });
      }

      // se existir e for URL válido → redirect
      if (isPlainUrl(targetTxt)) {
        return new Response(null, {
          status: 302,
          headers: { 'Location': targetTxt, 'Cache-Control': 'no-store' }
        });
      }

      // fallback: servir a página HTML do GAS (?s=<slug>) — raríssimo
      const r = await fetch(GAS + '?s=' + encodeURIComponent(slug) + trace, {
        headers: forwardHeaders(req),
        cache: 'no-store'
      });
      const resp = passthrough(r);
      resp.headers.set('Cache-Control', 'no-store');
      return resp;
    }
  }

  // 404 “direto” (rota desconhecida)
  return new Response(notFoundHtml(''), {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
