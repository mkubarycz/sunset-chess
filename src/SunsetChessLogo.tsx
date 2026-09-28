export function SunsetChessLogo({
  compact = false,
  decorative = false,
}: {
  compact?: boolean
  decorative?: boolean
}) {
  return (
    <svg
      className={`sunset-chess-logo${compact ? ' sunset-chess-logo-compact' : ''}`}
      viewBox="0 0 320 180"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-labelledby={decorative ? undefined : 'sunset-chess-logo-title'}
    >
      {!decorative && <title id="sunset-chess-logo-title">Sunset Chess</title>}
      <defs>
        <linearGradient id="sunset-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2d2038" />
          <stop offset="1" stopColor="#8e3f2f" />
        </linearGradient>
      </defs>
      <rect className="logo-sky" width="320" height="180" fill="url(#sunset-sky)" />
      <circle className="logo-sun" cx="160" cy="84" r="45" />
      <path className="logo-horizon" d="M0 119Q62 105 118 118T220 114T320 119V180H0Z" />
      <g className="logo-piece logo-queen" transform="translate(96 79)">
        <path d="M8 73h50l-5-13H13Zm7-18h36l4-36-13 17-9-25-10 25L5 19Z" />
        <circle cx="5" cy="16" r="5" /><circle cx="33" cy="7" r="5" /><circle cx="57" cy="16" r="5" />
      </g>
      <g className="logo-piece logo-bishop" transform="translate(174 82)">
        <path d="M10 70h43l-5-12H15Zm7-17h29l-5-18c7-7 3-22-9-29-12 7-16 22-9 29Z" />
        <path className="logo-bishop-cut" d="m34 15-9 17" />
      </g>
      {[28, 55, 235, 264, 291].map((x, index) => (
        <g className="logo-piece logo-pawn" transform={`translate(${x} ${118 + Math.abs(2 - index) * 3})`} key={x}>
          <circle cx="9" cy="7" r="7" />
          <path d="M4 15h10l4 20H0Zm-7 25h32v8H-3Z" />
        </g>
      ))}
    </svg>
  )
}
