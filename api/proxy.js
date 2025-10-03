// Vercel Edge Function: proxy para o teu Google Apps Script
// Env vars: GAS_BASE (obrigatório), ADMIN_PASS (opcional), ADMIN_USER + ADMIN_SECRET (opcionais p/ Basic Auth)

export const config = { runtime: 'edge' };

// --- Basic Auth (Edge Runtime) ---
function basicAuthOk(req) {
  const user = process.env.ADMIN_USER || '';
  const secret = process.env.ADMIN_SECRET || '';
  // Se não definires ADMIN_USER/ADMIN_SECRET, não exige login
  if (!user || !secret) return true;

  const h = req.headers.get('authorization') || '';
  if (!h.startsWith('Basic ')) return false;

  try {
    // Credenciais vêm como Base64("user:pass")
    const decoded = atob(h.slice(6));
    const idx = decoded.indexOf(':');
    if (idx === -1) return false;
    const u = decoded.slice(0, idx);
    const p = decoded.slice(idx + 1);
    return u === user && p === secret;
  } catch (_) {
    return false;
  }
}

const landing = (gas) => `<!doctype html><meta charset="utf-8"><title>link/</title>
<style>
:root{--bg:#f5f7fb;--card:#fff;--line:#e5e7eb;--text:#111827;--muted:#6b7280;--btn:#374151;--btnH:#111827}
*{box-sizing:border-box}body{font-family:system-ui,Segoe UI,Roboto;background:var(--bg);color:var(--text);margin:0;padding:40px}
.wrap{max-width:860px;margin:0 auto}.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:26px;box-shadow:0 10px 35px rgba(0,0,0,.06)}
h1{margin:0 0 8px}p{color:var(--muted)}code{background:#eef2f7;padding:2px 6px;border-radius:8px}
.actions{display:flex;gap:10px;margin-top:16px}
a.btn{background:var(--btn);color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700}
a.btn:hover{background:var(--btnH)}
</style>
<div class="wrap"><div class="card">
<h1>Short links</h1>
<p>Este subdomínio encaminha para o teu Apps Script.</p>
<ul style="color:var(--muted)">
<li>Formato: <code>https://link.seu-dominio.com/&lt;slug&gt;</code> (ou <code>/s/&lt;slug&gt;</code>)</li>
<li>QR: <code>/qr/&lt;slug&gt;</code></li>
<li>Painel: <code>/admin</code> (se ativado)</li>
</ul>
<div class="actions">
  <a class="btn" href="${gas}?ping=1" target="_blank" rel="noreferrer noopener">Testar GAS</a>
</div>
</div></div>`;

export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/+/, '');
  const GAS = (process.env.GAS_BASE || '').replace(/\/+$/, '');

  if (!GAS) return new Response('GAS_BASE em falta', { status: 500 });

  // / ou /health → landing
  if (path === '' || path === 'health') {
    return new Response(landing(GAS), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  }

  // /admin → exige Basic Auth (se definido) e redireciona com pass para o painel do GAS
  if (path === 'admin') {
    if (!basicAuthOk(req)) {
      return new Response('Autenticação requerida', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="admin"' }
      });
    }
    const PASS = process.env.ADMIN_PASS || '';
    if (!PASS) return new Response('ADMIN_PASS não configurado', { status: 403 });
    return Response.redirect(`${GAS}?admin=1&pass=${encodeURIComponent(PASS)}`, 302);
  }

  // /qr/<slug> → passa para o GAS
  if (path.startsWith('qr/')) {
    const slug = decodeURIComponent(path.slice(3));
    const target = `${GAS}?qr=${encodeURIComponent(slug)}`;
    const r = await fetch(target, { headers: forwardHeaders(req) });
    return passthrough(r);
  }

  // /s/<slug> ou /<slug>
  const slug = path.startsWith('s/') ? decodeURIComponent(path.slice(2)) : decodeURIComponent(path);
  if (slug) {
    const target = `${GAS}/s/${encodeURIComponent(slug)}`;
    const r = await fetch(target, { headers: forwardHeaders(req) });
    const resp = passthrough(r);
    resp.headers.set('Cache-Control', 'no-store'); // não cachear p/ A/B/GEO
    return resp;
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
  return new Response(r.body, {
    status: r.status,
    statusText: r.statusText,
    headers: r.headers
  });
}
