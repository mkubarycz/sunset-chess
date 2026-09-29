import { useId } from 'react'
import { faChessBishop } from '@fortawesome/free-solid-svg-icons/faChessBishop'
import { faChessPawn } from '@fortawesome/free-solid-svg-icons/faChessPawn'
import { faChessQueen } from '@fortawesome/free-solid-svg-icons/faChessQueen'

// Chess-piece paths are Font Awesome Free 7.3.1 by Fonticons, Inc., CC BY 4.0.
// The surrounding Sunset Chess landscape and composition are original to this project.
type ChessIconDefinition = typeof faChessQueen

function ChessIcon({
  definition,
  x,
  y,
  height,
  className,
}: {
  definition: ChessIconDefinition
  x: number
  y: number
  height: number
  className: string
}) {
  const [sourceWidth, sourceHeight, , , pathData] = definition.icon
  const scale = height / sourceHeight
  const left = x - (sourceWidth * scale) / 2
  const paths = Array.isArray(pathData) ? pathData : [pathData]

  return (
    <g
      className={className}
      data-fa-icon={definition.iconName}
      transform={`translate(${left} ${y}) scale(${scale})`}
      aria-hidden="true"
    >
      {paths.map((path, index) => <path d={path} key={index} />)}
    </g>
  )
}

export function SunsetChessLogo({
  compact = false,
  decorative = false,
}: {
  compact?: boolean
  decorative?: boolean
}) {
  const instanceId = useId()
  const titleId = `sunset-chess-logo-title-${instanceId}`
  const clipId = `sunset-chess-logo-clip-${instanceId}`

  return (
    <svg
      className={`sunset-chess-logo${compact ? ' sunset-chess-logo-compact' : ''}`}
      viewBox="0 0 360 180"
      preserveAspectRatio="xMidYMid meet"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-labelledby={decorative ? undefined : titleId}
      xmlns="http://www.w3.org/2000/svg"
    >
      {!decorative && (
        <title id={titleId}>Sunset Chess — queen, bishop, and pawns at sunset.</title>
      )}
      <defs>
        <clipPath id={clipId}>
          <rect width="360" height="180" rx="12" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${clipId})`}>
        <rect className="logo-sky" width="360" height="180" />
        <circle className="logo-sun-halo" cx="180" cy="72" r="55" />
        <circle className="logo-sun" cx="180" cy="72" r="45" />

        <path
          className="logo-horizon logo-horizon-far"
          d="M0 117C47 105 77 109 112 119c35 10 65-9 101-7 43 2 70 18 147 4v64H0Z"
        />
        <path
          className="logo-horizon logo-horizon-near"
          d="M0 139c53-18 99-8 139 3 45 12 76-14 121-10 34 3 65 15 100 7v41H0Z"
        />

        <ChessIcon
          definition={faChessPawn}
          x={42}
          y={106}
          height={45}
          className="logo-piece logo-pawn logo-pawn-far"
        />
        <ChessIcon
          definition={faChessPawn}
          x={82}
          y={106}
          height={54}
          className="logo-piece logo-pawn"
        />
        <ChessIcon
          definition={faChessPawn}
          x={286}
          y={106}
          height={54}
          className="logo-piece logo-pawn"
        />
        <ChessIcon
          definition={faChessPawn}
          x={329}
          y={106}
          height={45}
          className="logo-piece logo-pawn logo-pawn-far"
        />

        <ChessIcon
          definition={faChessQueen}
          x={143}
          y={48}
          height={120}
          className="logo-piece logo-queen"
        />
        <ChessIcon
          definition={faChessBishop}
          x={224}
          y={65}
          height={103}
          className="logo-piece logo-bishop"
        />
        <path className="logo-foreground" d="M0 163c76-7 121 4 180 2 57-2 108-9 180-2v17H0Z" />
      </g>
      <rect className="logo-frame" x="1" y="1" width="358" height="178" rx="11" />
    </svg>
  )
}
