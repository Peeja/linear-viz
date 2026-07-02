// Zero-dependency local server for the Linear dependency graph.
//
// - Reads the Linear API key from config.jsonc (never sent to the browser).
// - Serves linear-dep-graph.html at /
// - Proxies POST /api/graphql to Linear, injecting the key server-side.
// - Exposes GET /api/meta so the page knows the workspace slug for issue links.
//
// Run:  node server.js
// Config: copy config.example.jsonc -> config.jsonc and set linearApiKey.

const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = __dirname;
// Prefer config.jsonc (so editors treat comments as valid); fall back to
// config.json for existing setups.
const CONFIG_PATHS = ['config.jsonc', 'config.json'].map(f => path.join(ROOT, f));
const HTML_PATH = path.join(ROOT, 'linear-dep-graph.html');
const LINEAR_GQL = 'https://api.linear.app/graphql';

// Allow JSONC in config.json: // line and /* */ block comments, plus trailing
// commas. Both passes are string-aware, so comment markers or commas inside a
// quoted value (e.g. a URL containing "//") are left untouched.
function stripJsonComments(s) {
  let out = '', inStr = false, inLine = false, inBlock = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i], n = s[i + 1];
    if (inLine) { if (c === '\n') { inLine = false; out += c; } continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inStr) {
      out += c;
      if (c === '\\') { out += (n ?? ''); i++; }   // keep the escaped char verbatim
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    out += c;
  }
  return out;
}
function stripTrailingCommas(s) {
  let out = '', inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (c === '\\') { out += (s[i + 1] ?? ''); i++; }
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === ',') {
      let j = i + 1; while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === '}' || s[j] === ']') continue;   // drop comma before a closer
    }
    out += c;
  }
  return out;
}

function loadConfig() {
  const found = CONFIG_PATHS.find(p => fs.existsSync(p));
  if (!found) {
    console.error(`\nNo config.jsonc found.\nCopy config.example.jsonc to config.jsonc and set your Linear API key.\n`);
    process.exit(1);
  }
  const name = path.basename(found);
  let raw;
  try {
    raw = fs.readFileSync(found, 'utf8');
  } catch {
    console.error(`\nCould not read ${name}.\n`);
    process.exit(1);
  }
  let cfg;
  try {
    cfg = JSON.parse(stripTrailingCommas(stripJsonComments(raw)));
  } catch (e) {
    console.error(`\n${name} is not valid JSON (comments and trailing commas are allowed): ${e.message}\n`);
    process.exit(1);
  }
  if (!cfg.linearApiKey || cfg.linearApiKey === 'YOUR_API_KEY_HERE') {
    console.error(`\nSet "linearApiKey" in ${name} (currently a placeholder).\nGet one at https://linear.app/settings/api\n`);
    process.exit(1);
  }
  return cfg;
}

const cfg = loadConfig();
const PORT = cfg.port || 8787;

// Forward a GraphQL request body to Linear with the key attached.
function proxyToLinear(body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      LINEAR_GQL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': cfg.linearApiKey,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

// ── Live reload (dev) ──────────────────────────────────────────────────────
// The page opens an SSE stream at /api/reload; when the served HTML changes on
// disk (e.g. a `git pull` lands new work), we push a "reload" and the browser
// refreshes itself — no manual reload. watchFile (polling) is used because it
// survives the file being replaced wholesale, which git often does.
const reloadClients = new Set();
fs.watchFile(HTML_PATH, { interval: 400 }, (cur, prev) => {
  if (cur.mtimeMs && cur.mtimeMs !== prev.mtimeMs) {
    for (const c of reloadClients) { try { c.write('data: reload\n\n'); } catch {} }
  }
});

const server = http.createServer(async (req, res) => {
  // Match on the pathname only — the page puts the root issue in the query
  // string (/?issue=FIL-273), which must not defeat the route match.
  const pathname = (req.url || '/').split('?')[0];
  // Only same-origin browser calls; no CORS headers (key stays local).
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    fs.readFile(HTML_PATH, (err, buf) => {
      if (err) return send(res, 500, 'text/plain', 'Could not read HTML file.');
      send(res, 200, 'text/html; charset=utf-8', buf);
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/meta') {
    // Repos to attach to a "start this issue" Claude Code session. The skill
    // repo (where /start-issue lives) is always included, even if omitted from
    // startRepos. Repos must be accessible to the user's connected GitHub account.
    const skillRepo = cfg.skillRepo || 'Peeja/ff-claude';
    const startRepos = Array.isArray(cfg.startRepos) ? cfg.startRepos.slice() : [];
    if (!startRepos.includes(skillRepo)) startRepos.push(skillRepo);
    send(res, 200, 'application/json', JSON.stringify({
      workspace: cfg.workspace || 'filecoin-foundation',
      startRepos,
      startEnvironment: cfg.startEnvironment || '',
      pollMs: cfg.pollMs ?? 20000,   // live-refresh cadence (0 = off)
    }));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/reload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write('retry: 1000\n\n');
    reloadClients.add(res);
    req.on('close', () => reloadClients.delete(res));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/graphql') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1e6) req.destroy(); // basic guard
    });
    req.on('end', async () => {
      try {
        const result = await proxyToLinear(body);
        send(res, result.status, 'application/json', result.body);
      } catch (e) {
        send(res, 502, 'application/json', JSON.stringify({ errors: [{ message: 'Proxy error: ' + e.message }] }));
      }
    });
    return;
  }

  send(res, 404, 'text/plain', 'Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nLinear dependency graph running at  http://localhost:${PORT}\n`);
  console.log(`Workspace: ${cfg.workspace}`);
});
