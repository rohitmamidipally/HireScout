#!/usr/bin/env node
/**
 * HireScout Local Proxy Server
 * Handles Notion API calls (CORS bypass) and serves the app
 * Run: node server.js
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

// ── Config ──────────────────────────────────────────────────────────────────
const PORT = 3747;
const APP_FILE = path.join(__dirname, 'hiring-agent.html');

// ── CORS headers ─────────────────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Notion-Version');
}

// ── Forward to external API ───────────────────────────────────────────────────
function proxyRequest(targetHost, targetPath, method, headers, body, res) {
  const options = {
    hostname: targetHost,
    port: 443,
    path: targetPath,
    method: method,
    headers: {
      ...headers,
      'host': targetHost,
      'Content-Length': body ? Buffer.byteLength(body) : 0
    }
  };

  const req = https.request(options, (apiRes) => {
    cors(res);
    res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
    apiRes.pipe(res);
  });

  req.on('error', (err) => {
    cors(res);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy error', message: err.message }));
  });

  if (body) req.write(body);
  req.end();
}

// ── Read request body ─────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => resolve(body));
  });
}

// ── Server ────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url);
  const pathname = parsed.pathname;

  // Preflight
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // ── Serve the app ──
  if (pathname === '/' || pathname === '/index.html') {
    try {
      const html = fs.readFileSync(APP_FILE, 'utf8');
      cors(res);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`hiring-agent.html not found. Make sure it's in the same folder as server.js.\n\nExpected: ${APP_FILE}`);
    }
    return;
  }

  // ── Proxy: Notion API ──
  // All requests to /notion-proxy/* get forwarded to api.notion.com
  if (pathname.startsWith('/notion-proxy/')) {
    const notionPath = pathname.replace('/notion-proxy', '');
    const body = await readBody(req);

    const forwardHeaders = {
      'Authorization': req.headers['authorization'] || '',
      'Content-Type': 'application/json',
      'Notion-Version': req.headers['notion-version'] || '2022-06-28',
    };

    console.log(`[Notion] ${req.method} ${notionPath}`);
    proxyRequest('api.notion.com', notionPath, req.method, forwardHeaders, body || null, res);
    return;
  }

  // ── Proxy: Anthropic API ──
  if (pathname.startsWith('/anthropic-proxy/')) {
    const anthropicPath = pathname.replace('/anthropic-proxy', '');
    const body = await readBody(req);

    const forwardHeaders = {
      'x-api-key': req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '') || '',
      'Content-Type': 'application/json',
      'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
    };

    console.log(`[Anthropic] ${req.method} ${anthropicPath}`);
    proxyRequest('api.anthropic.com', anthropicPath, req.method, forwardHeaders, body || null, res);
    return;
  }

  // ── Health check ──
  if (pathname === '/health') {
    cors(res);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', port: PORT, time: new Date().toISOString() }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ┌─────────────────────────────────────────┐');
  console.log('  │         HireScout Proxy Server          │');
  console.log('  ├─────────────────────────────────────────┤');
  console.log(`  │  App:     http://localhost:${PORT}        │`);
  console.log(`  │  Health:  http://localhost:${PORT}/health │`);
  console.log('  │                                         │');
  console.log('  │  Proxying:                              │');
  console.log('  │    /notion-proxy/*  → api.notion.com   │');
  console.log('  │    /anthropic-proxy/* → api.anthropic  │');
  console.log('  │                                         │');
  console.log('  │  Press Ctrl+C to stop                  │');
  console.log('  └─────────────────────────────────────────┘');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✗ Port ${PORT} is already in use.`);
    console.error(`  Try: kill $(lsof -ti:${PORT}) then run again.\n`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});
