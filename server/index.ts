import { openDatabase } from './database.js';
import { createSunsetServer } from './httpServer.js';
import { ChessRepository } from './repository.js';

const port = Number(process.env.PORT ?? 4175);
const host = process.env.HOST ?? '127.0.0.1';
const db = openDatabase();
const server = createSunsetServer(new ChessRepository(db), db);

server.listen(port, host, () => {
  console.log(`Sunset Chess listening at http://${host}:${port}`);
});

function shutdown(): void {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
