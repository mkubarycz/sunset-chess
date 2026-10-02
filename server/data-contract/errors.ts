export const sunsetChessErrors = [
  {
    code: 'validation',
    description: 'Input or state violates a declared constraint.',
    httpStatus: 400,
  },
  {
    code: 'not_found',
    description: 'The identified resource does not exist.',
    httpStatus: 404,
  },
  {
    code: 'conflict',
    description: 'The operation conflicts with lifecycle or relationship state.',
    httpStatus: 409,
  },
  {
    code: 'capability_not_supported',
    description: 'The resource does not expose the requested capability.',
    httpStatus: 405,
  },
];
