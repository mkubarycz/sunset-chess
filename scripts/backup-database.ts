import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const container = 'working-memory-sunset-chess-1-4'
const volume = 'working-memory-sunset-chess-1-4-data'
const databasePath = '/data/sunset-chess.sqlite'

function docker(...args: string[]) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
}

function main() {
  if (process.argv.length > 2) throw new Error('This command accepts no arguments and only backs up Sunset Chess 1.4.')
  const inspected: {
    Id: string
    Image: string
    State: { Running: boolean }
    Mounts: { Type: string; Name?: string; Destination: string }[]
    NetworkSettings: { Ports: Record<string, { HostIp: string; HostPort: string }[] | null> }
  }[] = JSON.parse(docker('inspect', container))
  const source = inspected[0]
  if (!source?.State.Running
    || !source.Mounts.some((mount) => mount.Type === 'volume'
      && mount.Name === volume && mount.Destination === '/data')
    || !source.NetworkSettings.Ports['4175/tcp']?.some((port) =>
      port.HostIp === '127.0.0.1' && port.HostPort === '4176')) {
    throw new Error('Refusing backup: the running container does not match the expected 1.4 volume and port 4176.')
  }

  const createdAt = new Date().toISOString()
  const root = join(homedir(), 'Documents', 'SunsetChess-backups')
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const directory = mkdtempSync(join(root, `${createdAt.replace(/[:.]/g, '-')}-session-`))
  const snapshot = join(directory, 'sunset-chess.sqlite')
  const temporary = `/tmp/sunset-chess-backup-${randomUUID()}.sqlite`
  console.log(`Backing up ${container} to ${directory}`)

  try {
    docker('exec', source.Id, 'node', '--experimental-sqlite', '-e', `
      const {DatabaseSync, backup} = require('node:sqlite');
      const db = new DatabaseSync(${JSON.stringify(databasePath)}, {readOnly: true});
      backup(db, ${JSON.stringify(temporary)})
        .then(() => db.close())
        .catch(error => { db.close(); console.error(error); process.exitCode = 1; });
    `)
    docker('cp', `${source.Id}:${temporary}`, snapshot)
    chmodSync(snapshot, 0o600)

    const db = new DatabaseSync(snapshot, { readOnly: true })
    let tableCounts: Record<string, number>
    try {
      const integrity = db.prepare('PRAGMA integrity_check').all()
      if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
        throw new Error(`Backup integrity check failed: ${JSON.stringify(integrity)}`)
      }
      const violations = db.prepare('PRAGMA foreign_key_check').all()
      if (violations.length) throw new Error(`Backup foreign-key check failed: ${JSON.stringify(violations)}`)
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
      tableCounts = Object.fromEntries(tables.map(({ name }) => {
        if (typeof name !== 'string') throw new Error('Invalid SQLite table name.')
        const count = db.prepare(`SELECT count(*) AS count FROM "${name.replace(/"/g, '""')}"`).get()
        if (typeof count?.count !== 'number') throw new Error(`Invalid row count for ${name}.`)
        return [name, count.count]
      }))
    } finally {
      db.close()
    }
    const sha256 = createHash('sha256').update(readFileSync(snapshot)).digest('hex')
    writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify({
      createdAt, container, containerId: source.Id, imageId: source.Image,
      volume, databasePath, url: 'http://localhost:4176', snapshot,
      integrity: 'ok', foreignKeyViolations: 0, tableCounts, sha256,
    }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    console.log(`Verified backup: ${snapshot}\nIntegrity: ok; foreign-key violations: 0\nSHA-256: ${sha256}`)
    console.log(`Row counts: ${JSON.stringify(tableCounts)}`)
  } finally {
    docker('exec', source.Id, 'node', '-e', `require('node:fs').rmSync(${JSON.stringify(temporary)}, {force: true})`)
  }
}

main()
