import { checkInResource } from './check-in.js';
import { checkInGetOperation } from './check-in.get.js';
import { checkInPostOperation } from './check-in.post.js';
import { clubSessionResource } from './club-session.js';
import { clubSessionGetOperation } from './club-session.get.js';
import { clubSessionPostOperation } from './club-session.post.js';
import { clubSessionPutOperation } from './club-session.put.js';
import { gameResource } from './game.js';
import { gameDeleteOperation } from './game.delete.js';
import { gameGetOperation } from './game.get.js';
import { gamePostOperation } from './game.post.js';
import { gamePutOperation } from './game.put.js';
import { pairingCohortResource } from './pairing-cohort.js';
import { pairingCohortGetOperation } from './pairing-cohort.get.js';
import { playerResource } from './player.js';
import { playerDeleteOperation } from './player.delete.js';
import { playerGetOperation } from './player.get.js';
import { playerPostOperation } from './player.post.js';
import { playerPutOperation } from './player.put.js';
import { ratingEventResource } from './rating-event.js';
import { ratingEventGetOperation } from './rating-event.get.js';
import type { ResourceKind } from './resource-kind.js';
import type {
  ResourceCapability,
  ResourceDefinition,
  ResourceDescriptor,
  ResourceOperationDefinition,
} from './types.js';

function assembleResource(
  descriptor: ResourceDescriptor,
  operations: ResourceOperationDefinition[],
): ResourceDefinition {
  const methods = new Map(operations.map((operation) => [operation.method, operation]));
  const capabilities: Record<ResourceCapability, boolean> = {
    create: methods.has('post'),
    read: methods.has('get'),
    update: methods.has('put'),
    delete: methods.has('delete'),
    query: methods.has('get'),
  };
  return {
    ...descriptor,
    capabilities,
    operationSchemas: {
      createInput: methods.get('post')?.input,
      updateInput: methods.get('put')?.input,
    },
  };
}

export const sunsetChessResources: Record<ResourceKind, ResourceDefinition> = {
  player: assembleResource(playerResource, [
    playerGetOperation,
    playerPostOperation,
    playerPutOperation,
    playerDeleteOperation,
  ]),
  'club-session': assembleResource(clubSessionResource, [
    clubSessionGetOperation,
    clubSessionPostOperation,
    clubSessionPutOperation,
  ]),
  'check-in': assembleResource(checkInResource, [
    checkInGetOperation,
    checkInPostOperation,
  ]),
  game: assembleResource(gameResource, [
    gameGetOperation,
    gamePostOperation,
    gamePutOperation,
    gameDeleteOperation,
  ]),
  'rating-event': assembleResource(ratingEventResource, [ratingEventGetOperation]),
  'pairing-cohort': assembleResource(pairingCohortResource, [pairingCohortGetOperation]),
};
