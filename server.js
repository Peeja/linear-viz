// Zero-dependency local server for the Linear dependency graph.
//
// - Reads the Linear API key from config.json (never sent to the browser).
// - Serves linear-dep-graph.html at /
// - Proxies POST /api/graphql to Linear, injecting the key server-side.
// - Exposes GET /api/meta so the page knows the workspace slug for issue links.
//
// Run:  node server.js
// Config: copy config.example.json -> config.json and set linearApiKey.

const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'config.json');
const HTML_PATH = path.join(ROOT, 'linear-dep-graph.html');
const LINEAR_GQL = 'https://api.linear.app/graphql';

function loadConfig() {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch {
    console.error(`\nNo config.json found.\nCopy config.example.json to config.json and set your Linear API key.\n`);
    process.exit(1);
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    console.error(`\nconfig.json is not valid JSON: ${e.message}\n`);
    process.exit(1);
  }
  if (!cfg.linearApiKey || cfg.linearApiKey === 'YOUR_API_KEY_HERE') {
    console.error(`\nSet "linearApiKey" in config.json (currently a placeholder).\nGet one at https://linear.app/settings/api\n`);
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

const server = http.createServer(async (req, res) => {
  // Only same-origin browser calls; no CORS headers (key stays local).
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    fs.readFile(HTML_PATH, (err, buf) => {
      if (err) return send(res, 500, 'text/plain', 'Could not read HTML file.');
      send(res, 200, 'text/html; charset=utf-8', buf);
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/meta') {
    send(res, 200, 'application/json', JSON.stringify({ workspace: cfg.workspace || 'filecoin-foundation' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/graphql') {
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
