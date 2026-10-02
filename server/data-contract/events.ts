export const sunsetChessEvents = [
  { type: 'resource.created', description: 'A resource was durably created.' },
  { type: 'resource.updated', description: 'A mutable resource specification changed.' },
  { type: 'resource.deleted', description: 'A deletable resource was removed.' },
  {
    type: 'check-in.placed',
    description: 'A check-in atomically produced or preserved game placement.',
  },
  {
    type: 'game.finalized',
    description: 'A game result and both rating ledger entries committed.',
  },
];
