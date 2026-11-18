import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Service } from '@opencode/client/service';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const port = Number(process.env.PORT ?? 5180);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
};

/** The shared OpenCode background service: same sessions, models and providers as the CLI. */
let service = null;
const opencode = async () => {
  if (!service) {
    const endpoint = await Service.ensure();
    service = { url: endpoint.url, headers: Service.headers(endpoint) };
  }
  return service;
};

const proxy = async (req, res) => {
  let target;
  try {
    target = await opencode();
  } catch (error) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `OpenCode is not available: ${error instanceof Error ? error.message : String(error)}` }));
    return;
  }

  const url = new URL(req.url.replace(/^\/oc/, ''), target.url);
  const headers = { ...target.headers };
  for (const [key, value] of Object.entries(req.headers)) {
    if (['host', 'connection', 'content-length', 'authorization'].includes(key)) continue;
    if (typeof value === 'string') headers[key] = value;
  }

  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req,
      duplex: 'half',
    });
    res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
    if (upstream.body) {
      for await (const chunk of upstream.body) res.write(chunk);
    }
    res.end();
  } catch (error) {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
};

const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent((req.url ?? '/').split('?')[0]);

  if (pathname === '/app/info') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ directory: process.cwd() }));
    return;
  }

  if (pathname.startsWith('/oc/')) {
    await proxy(req, res);
    return;
  }

  const file = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolved = path.resolve(dist, file);
  if (!resolved.startsWith(dist)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const info = await stat(resolved);
    if (!info.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'content-type': MIME[path.extname(resolved)] ?? 'application/octet-stream',
      'cache-control': resolved.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
    });
    createReadStream(resolved).pipe(res);
  } catch {
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
    createReadStream(path.join(dist, 'index.html')).pipe(res);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`niceui  http://localhost:${port}`);
});
