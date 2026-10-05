import { z } from 'zod';
import {
  CapabilityNotSupportedError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from './errors.js';
import {
  CheckInCreateInputSchema,
  ClubSessionCreateInputSchema,
  ClubSessionUpdateInputSchema,
  GameCreateInputSchema,
  GameUpdateInputSchema,
  PlayerCreateInputSchema,
  PlayerUpdateInputSchema,
  ResourceEnvelopeSchema,
  ResourceKindSchema,
  sunsetChessResources,
  type ResourceKind,
} from './data-contract/index.js';
import type {
  CheckIn,
  ChessGame,
  ChessRepository,
  ClubSession,
  PairingCohort,
  Player,
  RatingEvent,
} from './repository.js';

export type ResourceEnvelope = z.infer<typeof ResourceEnvelopeSchema>;
export type ResourceQuery = {
  limit?: number;
  eventId?: number;
  playerId?: number;
};

const EPOCH = '1970-01-01T00:00:00.000Z';

function lifecycle(game: ChessGame): 'waiting' | 'playing' | 'finished' | 'cancelled' {
  if (game.cancelledAt) return 'cancelled';
  if (game.result) return 'finished';
  if (game.blackPlayerId !== null && game.whitePlayerId !== null) return 'playing';
  return 'waiting';
}

function parseContractInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map(({ message }) => message).join(' '));
  }
  return parsed.data;
}

export class ResourceService {
  constructor(private readonly repository: ChessRepository) {}

  query(rawKind: string, query: ResourceQuery = {}): ResourceEnvelope[] {
    const kind = ResourceKindSchema.parse(rawKind);
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 200);
    let resources: ResourceEnvelope[];
    switch (kind) {
      case 'player':
        resources = this.repository.listPlayers().map((player) => this.player(player));
        break;
      case 'club-session':
        resources = this.repository.listClubSessions().map((session) => this.session(session));
        break;
      case 'check-in':
        resources = this.repository.listCheckIns(query.eventId, query.playerId)
          .map((checkIn) => this.checkIn(checkIn));
        break;
      case 'game':
        resources = this.repository.listGames()
          .filter((game) => query.eventId === undefined || game.eventId === query.eventId)
          .map((game) => this.game(game));
        break;
      case 'rating-event':
        resources = this.repository.listRatingEvents(query.playerId)
          .map((event) => this.ratingEvent(event));
        break;
      case 'pairing-cohort':
        resources = this.repository.listPairingCohorts(query.eventId, query.playerId)
          .map((cohort) => this.pairingCohort(cohort));
        break;
    }
    return resources.slice(0, limit);
  }

  get(rawKind: string, id: string): ResourceEnvelope {
    const kind = ResourceKindSchema.parse(rawKind);
    if (kind === 'pairing-cohort') {
      const match = id.match(/^(\d+):(\d+)$/);
      if (!match) throw new ValidationError('Pairing cohort id must be sessionId:playerId.');
      const cohort = this.repository.listPairingCohorts(Number(match[1]), Number(match[2]))[0];
      if (!cohort) throw new NotFoundError(`Pairing cohort ${id} was not found.`);
      return this.pairingCohort(cohort);
    }
    const numericId = this.numericId(id);
    switch (kind) {
      case 'player': return this.player(this.repository.getPlayer(numericId));
      case 'club-session': return this.session(this.repository.getClubSession(numericId));
      case 'check-in': return this.checkIn(this.repository.getCheckIn(numericId));
      case 'game': return this.game(this.repository.getGame(numericId));
      case 'rating-event': return this.ratingEvent(this.repository.getRatingEvent(numericId));
      default: throw new NotFoundError(`${kind} ${id} was not found.`);
    }
  }

  create(rawKind: string, input: unknown): { resource: ResourceEnvelope; effects?: ResourceEnvelope[] } {
    const kind = ResourceKindSchema.parse(rawKind);
    this.assertCapability(kind, 'create');
    const record = this.record(input);
    switch (kind) {
      case 'player': {
        const parsed = parseContractInput(PlayerCreateInputSchema, record);
        let player = parsed.id === undefined
          ? this.repository.createPlayer(parsed.name)
          : this.repository.upsertPlayer(parsed.id, parsed.name);
        if (parsed.scanningIdentifier !== undefined && parsed.scanningIdentifier !== null) {
          player = this.repository.assignPlayerScanningIdentifier(
            player.id,
            parsed.scanningIdentifier,
          ).player;
        }
        return { resource: this.player(player) };
      }
      case 'club-session': {
        const parsed = parseContractInput(ClubSessionCreateInputSchema, record);
        return { resource: this.session(this.repository.createClubSession(parsed.name)) };
      }
      case 'check-in': {
        const parsed = parseContractInput(CheckInCreateInputSchema, record);
        const result = this.repository.checkInPlayer({ id: parsed.playerId, name: parsed.name });
        return {
          resource: this.checkIn(result.checkIn),
          effects: [this.player(this.repository.getPlayer(parsed.playerId)), this.game(result.game)],
        };
      }
      case 'game': {
        const parsed = parseContractInput(GameCreateInputSchema, record);
        const game = parsed.blackPlayerId !== undefined && parsed.whitePlayerId !== undefined
          && parsed.blackPlayerId !== null && parsed.whitePlayerId !== null
          ? this.repository.createGame(parsed.blackPlayerId, parsed.whitePlayerId, parsed.eventId)
          : this.repository.createEmptyGame(() => new Date().toISOString(), parsed.eventId);
        return { resource: this.game(game) };
      }
      default:
        throw new ConflictError(`${kind} creation is not supported.`);
    }
  }

  update(rawKind: string, id: string, input: unknown): ResourceEnvelope {
    const kind = ResourceKindSchema.parse(rawKind);
    this.assertCapability(kind, 'update');
    const numericId = this.numericId(id);
    const record = this.record(input);
    if (kind === 'player') {
      const parsed = parseContractInput(PlayerUpdateInputSchema, record);
      let player = this.repository.getPlayer(numericId);
      if (parsed.name !== undefined) {
        player = this.repository.updatePlayerName(numericId, parsed.name);
      }
      if (parsed.scanningIdentifier !== undefined) {
        if (parsed.scanningIdentifier === null) {
          this.repository.clearPlayerScanningIdentifier(numericId);
          player = this.repository.getPlayer(numericId);
        } else {
          player = this.repository.assignPlayerScanningIdentifier(
            numericId,
            parsed.scanningIdentifier,
          ).player;
        }
      }
      return this.player(player);
    }
    if (kind === 'club-session') {
      const parsed = parseContractInput(ClubSessionUpdateInputSchema, record);
      let session = this.repository.getClubSession(numericId);
      if (parsed.name !== undefined) session = this.repository.updateClubSessionName(numericId, parsed.name);
      if (parsed.pairingMode !== undefined) {
        session = this.repository.updateClubSessionPairingMode(numericId, parsed.pairingMode);
      }
      return this.session(session);
    }
    if (kind === 'game') {
      const parsed = parseContractInput(GameUpdateInputSchema, record);
      return this.game(this.repository.updateGameResource(numericId, parsed));
    }
    throw new ConflictError(`${kind} update is not supported.`);
  }

  delete(rawKind: string, id: string): ResourceEnvelope {
    const kind = ResourceKindSchema.parse(rawKind);
    this.assertCapability(kind, 'delete');
    const numericId = this.numericId(id);
    if (kind === 'player') return this.player(this.repository.deletePlayer(numericId));
    if (kind === 'game') return this.game(this.repository.deleteGame(numericId));
    throw new ConflictError(`${kind} deletion is not supported.`);
  }

  private player(player: Player): ResourceEnvelope {
    const createdAt = this.repository.listRatingEvents(player.id)[0]?.recordedAt ?? EPOCH;
    return this.envelope('player', String(player.id), createdAt, {
      name: player.name,
      scanningIdentifier: player.scanningIdentifier,
    }, {
      rating: player.rating,
    }, {});
  }

  private session(session: ClubSession): ResourceEnvelope {
    return this.envelope('club-session', String(session.id), session.createdAt, {
      name: session.name,
      pairingMode: session.pairingMode,
    }, {
      lifecycle: session.active ? 'active' : 'closed',
      closedAt: session.closedAt,
      playerCount: session.playerCount,
      gameCount: session.gameCount,
      activeGameCount: session.activeGameCount,
    }, {});
  }

  private checkIn(checkIn: CheckIn): ResourceEnvelope {
    const player = this.repository.getPlayer(checkIn.playerId);
    return this.envelope('check-in', String(checkIn.id), checkIn.checkedInAt, {
      playerId: checkIn.playerId,
      name: player.name,
    }, {
      placement: checkIn.placement ?? 'migrated',
      side: checkIn.side,
      checkedInAt: checkIn.checkedInAt,
    }, {
      player: String(checkIn.playerId),
      session: checkIn.eventId === null ? null : String(checkIn.eventId),
      game: checkIn.gameId === null ? null : String(checkIn.gameId),
      cohort: checkIn.eventId === null ? null : `${checkIn.eventId}:${checkIn.playerId}`,
    });
  }

  private game(game: ChessGame): ResourceEnvelope {
    return this.envelope('game', String(game.id), game.createdAt, {
      tableNumber: game.tableNumber,
    }, {
      lifecycle: lifecycle(game),
      result: game.result,
      finishedAt: game.finishedAt,
      cancelledAt: game.cancelledAt,
      cancellationReason: game.cancellationReason,
    }, {
      blackPlayer: game.blackPlayerId === null ? null : String(game.blackPlayerId),
      whitePlayer: game.whitePlayerId === null ? null : String(game.whitePlayerId),
      session: game.eventId === null ? null : String(game.eventId),
    });
  }

  private ratingEvent(event: RatingEvent & { playerId: number }): ResourceEnvelope {
    return this.envelope('rating-event', String(event.id), event.recordedAt, {
      previousRating: event.previousRating,
      rating: event.rating,
      delta: event.delta,
      reason: event.reason,
      result: event.result,
    }, { recordedAt: event.recordedAt }, {
      player: String(event.playerId),
      game: event.gameId === null ? null : String(event.gameId),
      opponent: event.opponentId === null ? null : String(event.opponentId),
    });
  }

  private pairingCohort(cohort: PairingCohort): ResourceEnvelope {
    const session = this.repository.getClubSession(cohort.eventId);
    return this.envelope('pairing-cohort', `${cohort.eventId}:${cohort.playerId}`, session.createdAt, {
      cohort: cohort.cohort,
      snapshotRating: cohort.snapshotRating,
    }, { frozen: true }, {
      player: String(cohort.playerId),
      session: String(cohort.eventId),
    });
  }

  private envelope(
    kind: ResourceKind,
    id: string,
    createdAt: string,
    spec: Record<string, unknown>,
    status: Record<string, unknown>,
    relationships: Record<string, string | string[] | null>,
  ): ResourceEnvelope {
    sunsetChessResources[kind].spec.parse(spec);
    sunsetChessResources[kind].status.parse(status);
    return ResourceEnvelopeSchema.parse({
      kind,
      metadata: { id, createdAt, version: 1 },
      spec,
      status,
      relationships,
    });
  }

  private assertCapability(kind: ResourceKind, capability: 'create' | 'update' | 'delete'): void {
    if (!sunsetChessResources[kind].capabilities[capability]) {
      throw new CapabilityNotSupportedError(`${kind} does not support ${capability}.`);
    }
  }

  private numericId(id: string): number {
    if (!/^\d+$/.test(id) || Number(id) < 1) throw new ValidationError('Resource id must be a positive integer.');
    return Number(id);
  }

  private record(input: unknown): Record<string, unknown> {
    const parsed = z.record(z.string(), z.unknown()).safeParse(input);
    if (!parsed.success) throw new ValidationError('Resource input must be an object.');
    return parsed.data;
  }
}
