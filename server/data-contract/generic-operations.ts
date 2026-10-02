export const genericResourceOperations = [
  {
    name: 'contract.discover',
    description: 'Discover the complete application contract.',
    transport: ['http', 'mcp'],
  },
  {
    name: 'resource.query',
    description: 'Query resource envelopes by kind.',
    transport: ['http', 'mcp'],
  },
  {
    name: 'resource.get',
    description: 'Read one resource envelope.',
    transport: ['http', 'mcp'],
  },
  {
    name: 'resource.create',
    description: 'Create through the resource domain operation.',
    transport: ['http', 'mcp'],
  },
  {
    name: 'resource.update',
    description: 'Update mutable resource specification.',
    transport: ['http', 'mcp'],
  },
  {
    name: 'resource.delete',
    description: 'Delete where lifecycle rules permit.',
    transport: ['http', 'mcp'],
  },
];
