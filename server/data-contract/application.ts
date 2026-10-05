import { z } from 'zod';
import { ResourceEnvelopeSchema } from './envelope.js';
import { sunsetChessErrors } from './errors.js';
import { sunsetChessEvents } from './events.js';
import { genericResourceOperations } from './generic-operations.js';
import { sunsetChessResources } from './registry.js';

const OperationSchema = z.object({
  name: z.string(),
  description: z.string(),
  transport: z.array(z.enum(['http', 'mcp'])),
});

export const ApplicationContractSchema = z.object({
  contractVersion: z.literal('1.0'),
  application: z.object({
    id: z.literal('sunset-chess'),
    name: z.literal('Sunset Chess'),
    version: z.literal('1.3.0'),
    description: z.string(),
  }),
  envelope: z.object({
    fields: z.tuple([
      z.literal('kind'),
      z.literal('metadata'),
      z.literal('spec'),
      z.literal('status'),
      z.literal('relationships'),
    ]),
    jsonSchema: z.record(z.string(), z.unknown()),
  }),
  resources: z.record(z.string(), z.object({
    description: z.string(),
    schemas: z.object({
      spec: z.record(z.string(), z.unknown()),
      status: z.record(z.string(), z.unknown()),
      createInput: z.record(z.string(), z.unknown()).nullable(),
      updateInput: z.record(z.string(), z.unknown()).nullable(),
    }),
    relationships: z.record(z.string(), z.string()),
    capabilities: z.object({
      create: z.boolean(),
      read: z.boolean(),
      update: z.boolean(),
      delete: z.boolean(),
      query: z.boolean(),
    }),
    constraints: z.array(z.string()),
    lifecycle: z.array(z.string()),
    effects: z.array(z.string()),
    fields: z.object({
      generated: z.array(z.string()),
      mutable: z.array(z.string()),
      immutable: z.array(z.string()),
    }),
  })),
  operations: z.array(OperationSchema),
  errors: z.array(z.object({
    code: z.string(),
    description: z.string(),
    httpStatus: z.number().int(),
  })),
  events: z.array(z.object({ type: z.string(), description: z.string() })),
});

export const sunsetChessContract = ApplicationContractSchema.parse({
  contractVersion: '1.0',
  application: {
    id: 'sunset-chess',
    name: 'Sunset Chess',
    version: '1.3.0',
    description: 'Resource-oriented club chess pairing, game, and Elo ledger application.',
  },
  envelope: {
    fields: ['kind', 'metadata', 'spec', 'status', 'relationships'],
    jsonSchema: z.toJSONSchema(ResourceEnvelopeSchema),
  },
  resources: Object.fromEntries(Object.entries(sunsetChessResources).map(([kind, definition]) => [
    kind,
    {
      description: definition.description,
      schemas: {
        spec: z.toJSONSchema(definition.spec),
        status: z.toJSONSchema(definition.status),
        createInput: definition.operationSchemas.createInput
          ? z.toJSONSchema(definition.operationSchemas.createInput)
          : null,
        updateInput: definition.operationSchemas.updateInput
          ? z.toJSONSchema(definition.operationSchemas.updateInput)
          : null,
      },
      relationships: definition.relationships,
      capabilities: definition.capabilities,
      constraints: definition.constraints,
      lifecycle: definition.lifecycle,
      effects: definition.effects,
      fields: definition.fields,
    },
  ])),
  operations: genericResourceOperations,
  errors: sunsetChessErrors,
  events: sunsetChessEvents,
});
