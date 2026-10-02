import type { z } from 'zod';

export type ResourceCapability = 'create' | 'read' | 'update' | 'delete' | 'query';
export type ResourceMethod = 'get' | 'post' | 'put' | 'delete';

export type ResourceOperationDefinition = {
  method: ResourceMethod;
  description: string;
  input: z.ZodType;
  output: z.ZodType;
};

export type ResourceDescriptor = {
  description: string;
  spec: z.ZodType;
  status: z.ZodType;
  relationships: Record<string, string>;
  constraints: string[];
  lifecycle: string[];
  effects: string[];
  fields: {
    generated: string[];
    mutable: string[];
    immutable: string[];
  };
};

export type ResourceDefinition = ResourceDescriptor & {
  capabilities: Record<ResourceCapability, boolean>;
  operationSchemas: {
    createInput?: z.ZodType;
    updateInput?: z.ZodType;
  };
};
