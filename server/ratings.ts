export const INITIAL_RATING = 700;
export const ELO_K_FACTOR = 32;

export function calculateElo(
  whiteRating: number,
  blackRating: number,
  result: '1-0' | '0-1' | '1/2-1/2',
): { whiteDelta: number; blackDelta: number } {
  const whiteActual = result === '1-0' ? 1 : result === '0-1' ? 0 : 0.5;
  const whiteExpected = 1 / (1 + 10 ** ((blackRating - whiteRating) / 400));
  const rawDelta = ELO_K_FACTOR * (whiteActual - whiteExpected);
  const whiteDelta = rawDelta < 0 ? -Math.round(-rawDelta) : Math.round(rawDelta);
  return { whiteDelta, blackDelta: -whiteDelta };
}
