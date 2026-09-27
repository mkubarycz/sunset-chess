import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { DatabaseSync } from 'node:sqlite';
import { checkDatabase } from './database.js';
import { DomainError } from './errors.js';
import { createMcpServer } from './mcp.js';
import type { ChessRepository } from './repository.js';

const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

export function allowedHostAuthority(authority: string | undefined): boolean {
  if (!authority || /[/?#@\s]/.test(authority)) return false;
  try {
    const url = new URL(`http://${authority}/`);
    return !url.username && !url.password && loopbackHosts.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function allowedOriginValue(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:'
      && loopbackHosts.has(url.hostname.toLowerCase())
      && !url.username
      && !url.password
      && url.pathname === '/'
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

async function parseJson(req: IncomingMessage, maximumBytes = 1_000_000): Promise<unknown> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('aborted', onAborted);
      req.off('error', onError);
    };
    const reject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectBody(error);
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maximumBytes) {
        reject(new Error('Request body is too large.'));
        req.resume();
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolveBody(body ? JSON.parse(body) : undefined);
      } catch (error) {
        rejectBody(error);
      }
    };
    const onAborted = () => reject(new Error('Request was aborted.'));
    const onError = (error: Error) => reject(error);
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('aborted', onAborted);
    req.on('error', onError);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function createSunsetServer(
  repository: ChessRepository,
  db: DatabaseSync,
  publicDirectory = resolve(process.cwd(), 'dist'),
) {
  return createServer(async (req, res) => {
    try {
      if (!allowedHostAuthority(req.headers.host) || !allowedOriginValue(req.headers.origin)) {
        sendJson(res, 403, { error: 'Forbidden host or origin.' });
        return;
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/health') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });
        checkDatabase(db);
        return sendJson(res, 200, { ok: true, service: 'sunset-chess', database: 'available' });
      }
      if (url.pathname === '/mcp') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'MCP requires POST.' });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        const server = createMcpServer(repository);
        res.on('close', () => void transport.close());
        await server.connect(transport);
        await transport.handleRequest(req, res, await parseJson(req));
        return;
      }
      if (url.pathname === '/api/games') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });
        return sendJson(res, 200, {
          games: repository.listJoinedGames('ongoing'),
          recentGames: repository.listJoinedGames('finished', 20),
        });
      }
      if (url.pathname === '/api/players') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
        if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          return sendJson(res, 400, { error: 'Content-Type must be application/json.' });
        }
        let body: unknown;
        try {
          body = await parseJson(req, 4096);
        } catch (error) {
          return sendJson(res, 400, {
            error: error instanceof Error ? error.message : 'Invalid JSON body.',
          });
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).length !== 1 || typeof (body as { name?: unknown }).name !== 'string') {
          return sendJson(res, 400, { error: 'Body must contain only a string name.' });
        }
        try {
          return sendJson(res, 201, {
            player: repository.createPlayer((body as { name: string }).name),
          });
        } catch (error) {
          if (error instanceof DomainError) {
            return sendJson(res, error.code === 'conflict' ? 409 : 400, {
              error: error.message,
              code: error.code,
            });
          }
          throw error;
        }
      }
      const playerMatch = url.pathname.match(/^\/api\/players\/(\d+)$/);
      if (playerMatch) {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });
        try {
          return sendJson(res, 200, {
            player: repository.getPlayer(Number(playerMatch[1])),
          });
        } catch (error) {
          if (error instanceof DomainError) {
            return sendJson(res, error.code === 'not_found' ? 404 : 400, {
              error: error.message,
              code: error.code,
            });
          }
          throw error;
        }
      }
      const resultMatch = url.pathname.match(/^\/api\/games\/(\d+)\/result$/);
      if (resultMatch) {
        if (req.method !== 'PATCH') return sendJson(res, 405, { error: 'Method not allowed.' });
        if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          return sendJson(res, 400, { error: 'Content-Type must be application/json.' });
        }
        let body: unknown;
        try {
          body = await parseJson(req, 1024);
        } catch (error) {
          return sendJson(res, 400, {
            error: error instanceof Error ? error.message : 'Invalid JSON body.',
          });
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).length !== 1 || !('result' in body)) {
          return sendJson(res, 400, { error: 'Body must contain only result.' });
        }
        try {
          return sendJson(res, 200, {
            game: repository.finalizeGame(
              Number(resultMatch[1]),
              (body as { result: '1-0' | '0-1' | '1/2-1/2' }).result,
            ),
          });
        } catch (error) {
          if (error instanceof DomainError) {
            return sendJson(res, error.code === 'conflict' ? 409 : error.code === 'not_found' ? 404 : 400, {
              error: error.message,
              code: error.code,
            });
          }
          throw error;
        }
      }
      if (url.pathname === '/api/check-ins') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
        if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          return sendJson(res, 400, { error: 'Content-Type must be application/json.' });
        }
        let body: unknown;
        try {
          body = await parseJson(req, 4096);
        } catch (error) {
          return sendJson(res, 400, {
            error: error instanceof Error ? error.message : 'Invalid JSON body.',
          });
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some((key) => key !== 'playerId' && key !== 'name')) {
          return sendJson(res, 400, { error: 'Body must contain only playerId and name.' });
        }
        const { playerId, name } = body as Record<string, unknown>;
        if (!Number.isInteger(playerId) || typeof name !== 'string') {
          return sendJson(res, 400, { error: 'playerId must be an integer and name must be a string.' });
        }
        try {
          return sendJson(res, 200, repository.checkInPlayer({
            id: playerId as number,
            name,
          }));
        } catch (error) {
          if (error instanceof DomainError) {
            return sendJson(res, error.code === 'conflict' ? 409 : 400, {
              error: error.message,
              code: error.code,
            });
          }
          throw error;
        }
      }
      if (url.pathname.startsWith('/api/')) {
        return sendJson(res, 404, { error: 'Unknown API path.' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: 'Method not allowed.' });
      }
      const requested = url.pathname === '/' ? '/index.html' : normalize(url.pathname);
      const file = resolve(publicDirectory, `.${requested}`);
      const withinPublic = file.startsWith(`${resolve(publicDirectory)}/`);
      if (withinPublic && existsSync(file) && statSync(file).isFile()) {
        res.writeHead(200, { 'content-type': mimeTypes[extname(file)] ?? 'application/octet-stream' });
        if (req.method === 'HEAD') return res.end();
        createReadStream(file).pipe(res);
        return;
      }
      const acceptsHtml = req.headers.accept?.includes('text/html');
      if (acceptsHtml && !extname(url.pathname)) {
        const index = join(publicDirectory, 'index.html');
        res.writeHead(200, { 'content-type': mimeTypes['.html'] });
        if (req.method === 'HEAD') return res.end();
        createReadStream(index).pipe(res);
        return;
      }
      sendJson(res, 404, { error: 'Not found.' });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}
