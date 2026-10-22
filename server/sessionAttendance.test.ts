// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './database.js';
import { ChessRepository } from './repository.js';

let db: DatabaseSync;
afterEach(() => db?.close());

function fixture(count = 16) {
  db = openDatabase(':memory:');
  const repository = new ChessRepository(db);
  for (let id = 1000; id < 1000 + count; id++) repository.upsertPlayer(id, `Player ${id}`);
  const session = repository.createClubSession('Attendance');
  const checkIn = (id: number) => repository.checkInPlayer(
    { id, name: `Player ${id}` }, () => 0, undefined, session.id,
  );
  return { repository, session, checkIn };
}

describe('session attendance and automatic pairing', () => {
  it('keeps attendance after scoring without creating a waiting game or repeating opponents', () => {
    const { repository, session, checkIn } = fixture();
    const first = checkIn(1000);
    checkIn(1001);
    const attendance = repository.listCheckIns(session.id);
    repository.finalizeGame(first.game.id, '0-1');
    expect(repository.listJoinedGames()).toEqual([]);
    expect(repository.listLeaderboard(100, session.id).map(({ checkInStatus }) => checkInStatus))
      .toEqual(['available', 'available']);
    expect(repository.listCheckIns(session.id)).toEqual(attendance.map((entry) => ({
      ...entry, gameId: null, placement: null, side: null,
    })));
    repository.finalizeGame(first.game.id, '0-1');
    expect(repository.listCheckIns(session.id)).toHaveLength(2);
    expect(repository.listJoinedGames()).toEqual([]);
    expect(repository.listRatingEvents().filter(({ reason }) => reason === 'game')).toHaveLength(2);
  });

  it('automatically pairs available players by record within cohorts after scoring either API path', () => {
    const { repository, session, checkIn } = fixture();
    const first = checkIn(1000);
    checkIn(1001);
    const second = checkIn(1002);
    checkIn(1003);
    repository.finalizeGame(first.game.id, '0-1');
    expect(repository.listJoinedGames()).toHaveLength(1);
    repository.updateGameResource(second.game.id, { result: '0-1' });
    const games = repository.listJoinedGames();
    expect(games).toHaveLength(2);
    expect(games.map((game) => [game.blackPlayerId, game.whitePlayerId].sort()).sort())
      .toEqual([[1000, 1002], [1001, 1003]]);
    for (const attendance of repository.listCheckIns(session.id)) {
      expect(attendance.checkedOutAt).toBeNull();
      expect(attendance.placement).toBe('paired');
      expect(games.some((game) => game.id === attendance.gameId)).toBe(true);
    }
  });

  it('fills an eligible waiting table and leaves unmatched players available to check out', () => {
    const { repository, session, checkIn } = fixture();
    const first = checkIn(1000);
    checkIn(1001);
    const waiting = checkIn(1002);
    repository.finalizeGame(first.game.id, '1/2-1/2');
    const games = repository.listJoinedGames();
    expect(games).toHaveLength(1);
    expect(games[0].id).toBe(waiting.game.id);
    expect([games[0].blackPlayerId, games[0].whitePlayerId]).toContain(1002);
    const available = repository.listLeaderboard(100, session.id)
      .find(({ checkInStatus }) => checkInStatus === 'available')!;
    expect(repository.checkOutPlayer(session.id, available.id)).toMatchObject({
      playerId: available.id, checkedOutAt: expect.any(String),
    });
  });

  it('blocks checkout while waiting, paired, or started, then allows it after cancellation', () => {
    const { repository, session, checkIn } = fixture();
    const first = checkIn(1000);
    expect(() => repository.checkOutPlayer(session.id, 1000)).toThrow(/Finish or cancel Table/);
    checkIn(1001);
    expect(() => repository.checkOutPlayer(session.id, 1000)).toThrow(/Finish or cancel Table/);
    repository.updateGameResource(first.game.id, { start: true });
    expect(() => repository.checkOutPlayer(session.id, 1000)).toThrow(/Finish or cancel Table/);
    repository.cancelGame(first.game.id, undefined, undefined, true);
    expect(repository.listJoinedGames()).toEqual([]);
    const checkedOut = repository.checkOutPlayer(session.id, 1000);
    expect(checkedOut.checkedOutAt).toEqual(expect.any(String));
    expect(repository.checkOutPlayer(session.id, 1000)).toEqual(checkedOut);
    expect(repository.listLeaderboard(100, session.id)).toContainEqual(
      expect.objectContaining({ id: 1000, checkInStatus: 'checked-out' }),
    );
  });

  it('excludes checked-out players from automatic pairing and every manual assignment path', () => {
    const { repository, session, checkIn } = fixture();
    const first = checkIn(1000);
    checkIn(1001);
    repository.finalizeGame(first.game.id, '0-1');
    repository.checkOutPlayer(session.id, 1000);
    const next = checkIn(1002);
    checkIn(1003);
    expect(repository.listSeatOptions(next.game.id).some(({ id }) => id === 1000)).toBe(false);
    expect(() => repository.createGame(1000, 1004, session.id)).toThrow(/checked out/);
    expect(() => repository.updateGameSeat(next.game.id, 'white', 1000)).toThrow(/checked out/);
    expect(() => repository.updateGameResource(next.game.id, { blackPlayerId: 1000 })).toThrow(/checked out/);
    repository.finalizeGame(next.game.id, '0-1');
    expect(repository.listJoinedGames().some((game) =>
      game.blackPlayerId === 1000 || game.whitePlayerId === 1000)).toBe(false);
    expect(repository.listCheckIns(session.id, 1000)[0].checkedOutAt).not.toBeNull();
  });

  it('reactivates a checked-out player only through explicit check-in without duplicating attendance', () => {
    const { repository, session, checkIn } = fixture();
    const first = checkIn(1000);
    repository.cancelGame(first.game.id);
    const checkedOut = repository.checkOutPlayer(session.id, 1000);
    const again = checkIn(1000);
    expect(again.checkIn).toMatchObject({ id: checkedOut.id, checkedOutAt: null });
    expect(repository.listCheckIns(session.id, 1000)).toHaveLength(1);
    expect(again.game.blackPlayerId).toBe(1000);
  });

  it('does not carry attendance into another session or allow a stale session check-in', () => {
    const { repository, session, checkIn } = fixture();
    const first = checkIn(1000);
    repository.cancelGame(first.game.id);
    repository.closeClubSession(session.id, 'cancel');
    const next = repository.createClubSession('Next session');
    expect(repository.listLeaderboard(100, next.id)).toEqual([]);
    expect(() => checkIn(1001)).toThrow(/closed/);
    expect(repository.listCheckIns(next.id)).toEqual([]);
    expect(() => repository.checkOutPlayer(session.id, 1000)).toThrow(/closed/);
    expect(() => repository.createEmptyGame(undefined, session.id)).toThrow(/closed/);
    expect(repository.checkInPlayer({ id: 1000, name: 'Player 1000' }, () => 0, undefined, next.id)
      .checkIn.eventId).toBe(next.id);
    expect(repository.listCheckIns(session.id, 1000)[0].checkedOutAt).not.toBeNull();
  });

  it('rejects cross-session game adoption and rolls back player/attendance changes', () => {
    const { repository, session } = fixture();
    repository.createGame(1000, 1001, null);
    expect(() => repository.checkInPlayer(
      { id: 1000, name: 'Unexpected rename' }, () => 0, undefined, session.id,
    )).toThrow(/another session/);
    expect(repository.getPlayer(1000).name).toBe('Player 1000');
    expect(repository.listCheckIns(session.id)).toEqual([]);
  });

  it('records attendance for manual seating and never auto-pairs while closing the session', () => {
    const { repository, session } = fixture();
    repository.createGame(1000, 1001, session.id);
    const other = repository.createEmptyGame(undefined, session.id);
    repository.updateGameSeat(other.id, 'black', 1002);
    repository.updateGameSeat(other.id, 'white', 1003);
    expect(repository.listCheckIns(session.id)).toHaveLength(4);
    repository.closeClubSession(session.id, 'draw');
    expect(repository.listJoinedGames()).toEqual([]);
    expect(repository.listGames()).toHaveLength(2);
    expect(repository.listCheckIns(session.id).every(({ checkedOutAt }) => checkedOutAt !== null)).toBe(true);
  });
});
