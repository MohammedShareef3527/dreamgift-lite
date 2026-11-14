/**
 * dev-server.mjs — local preview that behaves like Vercel: clean URLs,
 * the rewrites and the security headers from vercel.json (so CSP problems
 * show up locally, not after deploy). No dependencies.
 *
 *   node tools/dev-server.mjs          → http://localhost:5173
 *   PORT=8080 node tools/dev-server.mjs
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const config = JSON.parse(await readFile(join(ROOT, 'vercel.json'), 'utf8'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

/** Vercel source pattern → RegExp. Supports :params and (.*). */
function toRegExp(source) {
  const pattern = source
    .replace(/[.+?^${}|[\]\\]/g, '\\$&')
    .replace(/\\\.\*|\(\.\*\)/g, '(.*)')
    .replace(/:(\w+)/g, '([^/]+)');
  return new RegExp(`^${pattern}$`);
}

const rewrites = (config.rewrites ?? []).map((r) => ({ re: toRegExp(r.source), to: r.destination }));
const headerRules = (config.headers ?? []).map((h) => ({ re: toRegExp(h.source), headers: h.headers }));

async function isFile(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

/** Map a URL path to a file on disk, the way Vercel's cleanUrls does. */
async function resolveFile(pathname) {
  for (const rule of rewrites) {
    if (rule.re.test(pathname)) { pathname = rule.to; break; }
  }
  const safe = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  if (safe.split(sep).includes('..')) return null;
  const base = join(ROOT, safe);
  const candidates = pathname.endsWith('/') ? [join(base, 'index.html')] : [base, `${base}.html`, join(base, 'index.html')];
  for (const file of candidates) if (await isFile(file)) return file;
  return null;
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const headers = {};
  for (const rule of headerRules) {
    if (rule.re.test(pathname)) for (const { key, value } of rule.headers) headers[key] = value;
  }
  // upgrade-insecure-requests would push http://localhost to https and break the preview.
  if (headers['Content-Security-Policy']) {
    headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace(/;\s*upgrade-insecure-requests/, '');
  }
  headers['Cache-Control'] = 'no-store';

  // cleanUrls: /page.html → /page
  if (config.cleanUrls && pathname.endsWith('.html')) {
    res.writeHead(308, { Location: pathname.replace(/(index)?\.html$/, '') || '/' });
    return res.end();
  }

  let file = await resolveFile(pathname);
  let status = 200;
  if (!file) {
    status = 404;
    file = (await isFile(join(ROOT, '404.html'))) ? join(ROOT, '404.html') : null;
  }
  if (!file) {
    res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  res.writeHead(status, { ...headers, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(await readFile(file));
});

server.listen(PORT, () => console.log(`DreamGift Lite → http://localhost:${PORT}`));
