// Local test server: serves /public and runs the /api functions the same way Vercel does.
// Run: node dev-server.js   (no npm install needed)
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(root, 'public');

for (const f of ['.env', '.env.local']) {
  const file = path.join(root, f);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const hasKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.OPENROUTER_API_KEY;
if (!hasKey) process.env.MOCK_AI = '1';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size < 6_000_000) chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch {
        resolve(null);
      }
    });
  });
}

async function api(req, res, name) {
  const file = path.join(root, 'api', `${name}.js`);
  if (!/^[a-z-]+$/.test(name) || !fs.existsSync(file)) return notFound(res);
  req.body = req.method === 'POST' ? await readBody(req) : null;
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (o) => (res.setHeader('Content-Type', 'application/json'), res.end(JSON.stringify(o)));
  res.send = (b) => res.end(b);
  const mod = await import(pathToFileURL(file).href);
  await mod.default(req, res);
}

function notFound(res) {
  res.statusCode = 404;
  res.end('Not found');
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname.slice(5).replace(/\/$/, ''));
    let p = path.normalize(path.join(pub, decodeURIComponent(url.pathname)));
    if (!p.startsWith(pub)) return notFound(res);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p) && fs.existsSync(`${p}.html`)) p = `${p}.html`;
    if (!fs.existsSync(p)) return notFound(res);
    res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(p).pipe(res);
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end('Server error');
  }
}

const port = Number(process.env.PORT) || 3000;
const certDir = path.join(root, '.cert');
const useHttps = fs.existsSync(path.join(certDir, 'key.pem')) && fs.existsSync(path.join(certDir, 'cert.pem'));
const server = useHttps
  ? https.createServer({ key: fs.readFileSync(path.join(certDir, 'key.pem')), cert: fs.readFileSync(path.join(certDir, 'cert.pem')) }, handle)
  : http.createServer(handle);

server.listen(port, () => {
  const scheme = useHttps ? 'https' : 'http';
  console.log(`\nEyes for Everyone is running:\n  Laptop: ${scheme}://localhost:${port}`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets || []) if (n.family === 'IPv4' && !n.internal) console.log(`  Phone:  ${scheme}://${n.address}:${port}`);
  }
  if (!useHttps) console.log('  (Phones need https for the camera. See README → "Open on your phone".)');
  console.log(hasKey ? '  AI keys found in .env' : '  No AI keys in .env → demo answers (MOCK mode)');
  console.log('');
});
