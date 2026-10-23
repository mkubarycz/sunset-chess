// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
vi.mock('node:fs', () => ({
  chmodSync: vi.fn(), mkdirSync: vi.fn(), mkdtempSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn(),
}))

const argv = process.argv
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  process.argv = ['node', 'scripts/backup-database.ts']
})
afterEach(() => { process.argv = argv })

describe('database backup target guards', () => {
  it('rejects arguments before accessing Docker or creating files', async () => {
    process.argv.push('original-sunset-chess')
    await expect(import('./backup-database')).rejects.toThrow('accepts no arguments')
    expect(execFileSync).not.toHaveBeenCalled()
    expect(mkdirSync).not.toHaveBeenCalled()
  })

  it.each([
    { running: false, volume: 'working-memory-sunset-chess-1-4-data', port: '4176' },
    { running: true, volume: 'working-memory-sunset-chess-data', port: '4176' },
    { running: true, volume: 'working-memory-sunset-chess-1-4-data', port: '4175' },
  ])('refuses a mismatched deployment before creating a backup (%j)', async ({ running, volume, port }) => {
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify([{
      Id: 'container-id', Image: 'image-id', State: { Running: running },
      Mounts: [{ Type: 'volume', Name: volume, Destination: '/data' }],
      NetworkSettings: { Ports: { '4175/tcp': [{ HostIp: '127.0.0.1', HostPort: port }] } },
    }]))
    await expect(import('./backup-database')).rejects.toThrow('Refusing backup')
    expect(execFileSync).toHaveBeenCalledExactlyOnceWith(
      'docker', ['inspect', 'working-memory-sunset-chess-1-4'],
      expect.objectContaining({ encoding: 'utf8' }),
    )
    expect(mkdirSync).not.toHaveBeenCalled()
    expect(writeFileSync).not.toHaveBeenCalled()
  })
})
