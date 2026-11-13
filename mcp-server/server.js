#!/usr/bin/env node
// long-novel-mcp — MCP server for the long-novel-workflow skill.
// Transports: stdio (default; WorkBuddy / Claude / Cursor via npx) and
// streamable HTTP (Doubao desktop via an http://127.0.0.1:PORT/mcp URL).
// HTTP is stateless: each request gets a fresh server and a JSON response
// (no SSE stream, no session to track). All book state lives in files, so
// there is no session state to keep. The server never calls a model API;
// the host model writes, the server manages state and runs the repo's
// deterministic Python checks.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createNovelServer } from './src/tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SKILL_ROOT = path.resolve(__dirname, '..');

function usage() {
  return `long-novel-mcp v1.0.0 — MCP server for the long-novel-workflow skill.

Usage:
  node server.js [--transport stdio|http] [--port 8765] [--host 127.0.0.1]
                 [--books ./books] [--scans ./scans] [--python python3]
                 [--skill-root <repo root>]

Options:
  --transport  stdio (default) or http
  --port       HTTP port (default 8765). HTTP binds 127.0.0.1 only by default.
  --host       HTTP bind host (default 127.0.0.1 — do not expose publicly)
  --books      Books root directory (default ./books, relative to the working directory)
  --scans      Weekly-report scan files directory (default ./scans)
  --python     Python for the deterministic audit scripts (default python3, need 3.9+)
  --skill-root Skill repo root (default: the parent of this mcp-server/ directory)

Env overrides: LONG_NOVEL_TRANSPORT, LONG_NOVEL_PORT, LONG_NOVEL_HOST,
LONG_NOVEL_BOOKS, LONG_NOVEL_SCANS, LONG_NOVEL_PYTHON.

Books stay on your own machine. The server never calls a model API and never
invents book data.`;
}

function parseArgs(argv) {
  const args = {
    transport: process.env.LONG_NOVEL_TRANSPORT || 'stdio',
    port: Number(process.env.LONG_NOVEL_PORT || 8765),
    host: process.env.LONG_NOVEL_HOST || '127.0.0.1',
    books: process.env.LONG_NOVEL_BOOKS || './books',
    scans: process.env.LONG_NOVEL_SCANS || './scans',
    python: process.env.LONG_NOVEL_PYTHON || 'python3',
    skillRoot: DEFAULT_SKILL_ROOT,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    if (a === '--help' || a === '-h') {
      console.log(usage());
      process.exit(0);
    } else if (a === '--transport') args.transport = next();
    else if (a === '--port') args.port = Number(next());
    else if (a === '--host') args.host = next();
    else if (a === '--books') args.books = next();
    else if (a === '--scans') args.scans = next();
    else if (a === '--python') args.python = next();
    else if (a === '--skill-root') args.skillRoot = next();
    else throw new Error(`unknown argument: ${a} (see --help)`);
  }
  if (!['stdio', 'http'].includes(args.transport)) throw new Error(`--transport must be stdio or http, got ${args.transport}`);
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) throw new Error(`bad --port: ${args.port}`);
  return {
    booksRoot: path.resolve(args.books),
    scansDir: path.resolve(args.scans),
    python: args.python,
    skillRoot: path.resolve(args.skillRoot),
    transport: args.transport,
    port: args.port,
    host: args.host,
  };
}

async function runStdio(config) {
  const server = createNovelServer(config);
  await server.connect(new StdioServerTransport());
  console.error(`long-novel-mcp v1.0.0 listening on stdio (books: ${config.booksRoot})`);
}

async function runHttp(config) {
  const httpServer = http.createServer(async (req, res) => {
    if (req.url !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found — POST JSON-RPC to /mcp');
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain' }).end('method not allowed — POST JSON-RPC to /mcp');
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) req.destroy();
    });
    req.on('end', async () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain' }).end('invalid JSON');
        return;
      }
      const server = createNovelServer(config);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, parsed);
      } catch (err) {
        console.error(err);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' }).end('internal error');
      } finally {
        await transport.close().catch(() => {});
        await server.close().catch(() => {});
      }
    });
  });
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.host, resolve);
  });
  console.error(`long-novel-mcp v1.0.0 listening on http://${config.host}:${config.port}/mcp (books: ${config.booksRoot})`);
}

async function main() {
  let config;
  try {
    config = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`error: ${err.message}\n\n${usage()}`);
    process.exit(2);
  }
  if (config.transport === 'http') await runHttp(config);
  else await runStdio(config);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
