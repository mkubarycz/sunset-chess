import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
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
  '.wasm': 'application/wasm',
};

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

type PathSemantics = Pick<typeof posix, 'isAbsolute' | 'relative' | 'sep'>;

export function isContainedPath(
  root: string,
  candidate: string,
  paths: PathSemantics = { isAbsolute, relative, sep },
): boolean {
  const fromRoot = paths.relative(root, candidate);
  return fromRoot !== ''
    && !paths.isAbsolute(fromRoot)
    && fromRoot !== '..'
    && !fromRoot.startsWith(`..${paths.sep}`);
}

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
      if (url.pathname === '/api/sessions') {
        if (req.method === 'GET') {
          return sendJson(res, 200, { sessions: repository.listClubSessions() });
        }
        if (req.method === 'POST') {
          return sendJson(res, 201, { session: repository.createClubSession() });
        }
        return sendJson(res, 405, { error: 'Method not allowed.' });
      }
      const sessionCloseMatch = url.pathname.match(/^\/api\/sessions\/(\d+)\/close$/);
      if (sessionCloseMatch) {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
        if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          return sendJson(res, 400, { error: 'Content-Type must be application/json.' });
        }
        const body = await parseJson(req, 4096);
        const resolution = (body as { resolution?: unknown } | null)?.resolution;
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).length !== 1
          || (resolution !== 'draw' && resolution !== 'cancel')) {
          return sendJson(res, 400, { error: 'Body must contain only resolution: draw or cancel.' });
        }
        return sendJson(res, 200, {
          session: repository.closeClubSession(
            Number(sessionCloseMatch[1]),
            resolution,
          ),
        });
      }
      const sessionPairingModeMatch = url.pathname.match(/^\/api\/sessions\/(\d+)\/pairing-mode$/);
      if (sessionPairingModeMatch) {
        if (req.method !== 'PATCH') return sendJson(res, 405, { error: 'Method not allowed.' });
        if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          return sendJson(res, 400, { error: 'Content-Type must be application/json.' });
        }
        const body = await parseJson(req, 4096);
        const pairingMode = (body as { pairingMode?: unknown } | null)?.pairingMode;
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).length !== 1 || pairingMode !== 'club-session-pairing-1') {
          return sendJson(res, 400, {
            error: 'Body must contain only pairingMode: club-session-pairing-1.',
          });
        }
        return sendJson(res, 200, {
          session: repository.updateClubSessionPairingMode(
            Number(sessionPairingModeMatch[1]),
            pairingMode,
          ),
        });
      }
      const sessionMatch = url.pathname.match(/^\/api\/sessions\/(\d+)$/);
      if (sessionMatch) {
        if (req.method !== 'PATCH') return sendJson(res, 405, { error: 'Method not allowed.' });
        if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          return sendJson(res, 400, { error: 'Content-Type must be application/json.' });
        }
        const body = await parseJson(req, 4096);
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).length !== 1 || typeof (body as { name?: unknown }).name !== 'string') {
          return sendJson(res, 400, { error: 'Body must contain only a string name.' });
        }
        return sendJson(res, 200, {
          session: repository.updateClubSessionName(
            Number(sessionMatch[1]),
            (body as { name: string }).name,
          ),
        });
      }
      if (url.pathname === '/api/games') {
        const rawEventId = url.searchParams.get('eventId');
        if (rawEventId !== null && !/^\d+$/.test(rawEventId)) {
          return sendJson(res, 400, { error: 'eventId must be a positive integer.' });
        }
        const eventId = rawEventId === null ? undefined : Number(rawEventId);
        if (req.method === 'GET') {
          return sendJson(res, 200, {
            games: repository.listJoinedGames('ongoing', undefined, eventId),
            recentGames: repository.listJoinedGames('finished', 20, eventId),
          });
        }
        if (req.method === 'POST') {
          return sendJson(res, 201, {
            game: repository.createEmptyGame(() => new Date().toISOString(), eventId),
          });
        }
        return sendJson(res, 405, { error: 'Method not allowed.' });
      }
      if (url.pathname === '/api/leaderboard') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });
        const rawLimit = url.searchParams.get('limit');
        const rawEventId = url.searchParams.get('eventId');
        if (rawLimit !== null && !/^\d+$/.test(rawLimit)) {
          return sendJson(res, 400, { error: 'limit must be an integer between 1 and 200.' });
        }
        if (rawEventId !== null && !/^\d+$/.test(rawEventId)) {
          return sendJson(res, 400, { error: 'eventId must be a positive integer.' });
        }
        try {
          return sendJson(res, 200, {
            leaderboard: repository.listLeaderboard(
              rawLimit === null ? 100 : Number(rawLimit),
              rawEventId === null ? undefined : Number(rawEventId),
            ),
          });
        } catch (error) {
          if (error instanceof DomainError) {
            return sendJson(res, 400, { error: error.message, code: error.code });
          }
          throw error;
        }
      }
      if (url.pathname === '/api/players') {
        if (req.method === 'GET') {
          const rawGameId = url.searchParams.get('gameId');
          if (rawGameId !== null && !/^\d+$/.test(rawGameId)) {
            return sendJson(res, 400, { error: 'gameId must be a positive integer.' });
          }
          try {
            return sendJson(res, 200, {
              players: rawGameId === null
                ? repository.listLeaderboard(200)
                : repository.listSeatOptions(Number(rawGameId)),
            });
          } catch (error) {
            if (error instanceof DomainError) {
              return sendJson(res, error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 400, {
                error: error.message,
                code: error.code,
              });
            }
            throw error;
          }
        }
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
      const playerMoveMatch = url.pathname.match(/^\/api\/players\/(\d+)\/move$/);
      if (playerMoveMatch) {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
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
          || Object.keys(body).length !== 1
          || !Number.isInteger((body as { destinationGameId?: unknown }).destinationGameId)) {
          return sendJson(res, 400, { error: 'Body must contain only destinationGameId as an integer.' });
        }
        try {
          return sendJson(res, 200, {
            game: repository.moveWaitingPlayer(
              Number(playerMoveMatch[1]),
              (body as { destinationGameId: number }).destinationGameId,
            ),
          });
        } catch (error) {
          if (error instanceof DomainError) {
            return sendJson(res, error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 400, {
              error: error.message,
              code: error.code,
            });
          }
          throw error;
        }
      }
      const profileMatch = url.pathname.match(/^\/api\/players\/(\d+)\/profile$/);
      if (profileMatch) {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });
        const rawLimit = url.searchParams.get('recentLimit');
        if (rawLimit !== null && !/^\d+$/.test(rawLimit)) {
          return sendJson(res, 400, { error: 'recentLimit must be an integer between 1 and 50.' });
        }
        try {
          return sendJson(res, 200, {
            profile: repository.getPlayerProfile(
              Number(profileMatch[1]),
              rawLimit === null ? 10 : Number(rawLimit),
            ),
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
      const playerMatch = url.pathname.match(/^\/api\/players\/(\d+)$/);
      if (playerMatch) {
        if (req.method !== 'GET' && req.method !== 'DELETE' && req.method !== 'PATCH') {
          return sendJson(res, 405, { error: 'Method not allowed.' });
        }
        try {
          if (req.method === 'PATCH') {
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
            return sendJson(res, 200, {
              player: repository.updatePlayerName(
                Number(playerMatch[1]),
                (body as { name: string }).name,
              ),
            });
          }
          return sendJson(res, 200, {
            player: req.method === 'DELETE'
              ? repository.deletePlayer(Number(playerMatch[1]))
              : repository.getPlayer(Number(playerMatch[1])),
          });
        } catch (error) {
          if (error instanceof DomainError) {
            return sendJson(res, error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 400, {
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
          const gameId = Number(resultMatch[1]);
          repository.finalizeGame(
            gameId,
            (body as { result: '1-0' | '0-1' | '1/2-1/2' }).result,
          );
          const game = repository.listJoinedGames('finished').find(
            (candidate) => candidate.id === gameId,
          );
          if (!game) throw new Error('Completed game could not be reloaded.');
          return sendJson(res, 200, { game });
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
      const seatMatch = url.pathname.match(/^\/api\/games\/(\d+)\/seats\/(black|white)$/);
      if (seatMatch) {
        if (req.method !== 'PATCH') return sendJson(res, 405, { error: 'Method not allowed.' });
        if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          return sendJson(res, 400, { error: 'Content-Type must be application/json.' });
        }
        let body: unknown;
        try {
          body = await parseJson(req, 1024);
        } catch (error) {
          return sendJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid JSON body.' });
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).length !== 1 || !('playerId' in body)
          || ((body as { playerId: unknown }).playerId !== null
            && !Number.isInteger((body as { playerId: unknown }).playerId))) {
          return sendJson(res, 400, { error: 'Body must contain only playerId as an integer or null.' });
        }
        try {
          return sendJson(res, 200, {
            game: repository.updateGameSeat(
              Number(seatMatch[1]),
              seatMatch[2] as 'black' | 'white',
              (body as { playerId: number | null }).playerId,
            ),
          });
        } catch (error) {
          if (error instanceof DomainError) {
            return sendJson(res, error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 400, {
              error: error.message, code: error.code,
            });
          }
          throw error;
        }
      }
      const gameMatch = url.pathname.match(/^\/api\/games\/(\d+)$/);
      if (gameMatch) {
        if (req.method !== 'DELETE') return sendJson(res, 405, { error: 'Method not allowed.' });
        let reason: string | undefined;
        if (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0') {
          if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
            return sendJson(res, 400, { error: 'Content-Type must be application/json.' });
          }
          let body: unknown;
          try {
            body = await parseJson(req, 2048);
          } catch (error) {
            return sendJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid JSON body.' });
          }
          if (!body || typeof body !== 'object' || Array.isArray(body)
            || Object.keys(body).some((key) => key !== 'reason')
            || ('reason' in body && typeof (body as { reason: unknown }).reason !== 'string')) {
            return sendJson(res, 400, { error: 'Body may contain only a string reason.' });
          }
          reason = (body as { reason?: string }).reason;
        }
        try {
          return sendJson(res, 200, { game: repository.cancelGame(Number(gameMatch[1]), reason) });
        } catch (error) {
          if (error instanceof DomainError) {
            return sendJson(res, error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 400, {
              error: error.message, code: error.code,
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
      const requested = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = resolve(publicDirectory, `.${requested}`);
      const withinPublic = isContainedPath(resolve(publicDirectory), file);
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
      if (error instanceof DomainError) {
        return sendJson(res, error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 400, {
          error: error.message,
          code: error.code,
        });
      }
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}
