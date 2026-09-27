# Sunset Chess Scanner v2

A local-first QR camera scanner with a SQLite/MCP control plane.

## Features

- Smooth camera capture using `requestVideoFrameCallback` (with RAF fallback), an ideal
  1920×1080/60 FPS request, and a non-exclusive 3840×2160 ceiling
- Automatic camera startup on mount, with manual retry when permission or hardware is unavailable
- Five-minute camera inactivity shutdown, reset by every decoded QR code (including arbitrary payloads), with a restart action
- Native Chromium `BarcodeDetector` QR scanning at up to 20 detections per second,
  with one detection request in flight and concurrent tracking of multiple returned codes
- Automatic timeout and fallback to off-main-thread `jsQR` when native QR detection is unavailable
- Mirrored, responsive polygon and bounded payload label that follow `object-fit: cover`
- Display-frame QR marker interpolation, short bounded prediction, and explicit
  tracking/coasting/lost behavior decoupled from QR decode cadence
- On-screen negotiated camera settings, optional-control state, camera/decode/paint
  cadence, and fresh/present tracking diagnostics
- Persisted player QR producer with 2-inch card and 0.9-inch sticker print modes
- Reusable ActionZones for top-corner check-in and lane-aware per-player
  Win/Draw/Lose choices, with exact two-second holds and bounded DOM-only
  progress updates
- Friendly player labels while retaining support for arbitrary QR strings
- Persistent players and chess games through a local MCP endpoint
- Responsive, horizontally scrollable ongoing-game thumbnail rail with a compact
  two-rank board showing both standard back ranks between Black and White player details, and
  automatic refresh about every two seconds
- Twenty most recently completed games with canonical PGN results, winner/draw
  treatment, and current player Elo
- Successful QR check-ins optimistically promote the assigned table to the
  rail's left edge, then animate a decorative identity token from the detected
  QR label (reduced-motion users receive only a stationary highlight)

Camera frames remain in the browser and are never transmitted. Native
`BarcodeDetector` decoding remains capped at 20 attempts/second with one request
in flight; a native response may contain multiple distinct codes, which are
smoothed and painted independently. It receives the full-resolution video
element directly—there is no downscaled native-path canvas. `jsQR` remains the
worker fallback, scans at most a 1440-pixel longest edge at a bounded cadence,
and can decode only one code per frame, so dual-QR result reporting is unavailable
on that fallback path. The increased 1440 cap retains more detail than the former
960 cap but costs more worker CPU per attempt. Marker painting runs at delivered
video/display frames and interpolates between decoder observations, predicts only
briefly, coasts on misses, disappears when stale, and snaps on reacquisition after
loss. This reduces visible stepping but cannot create detector accuracy or camera
frames that the browser/hardware did not provide. It does not claim direct GPU
acceleration. Future QR-as-pointer/hover targets should consume the smoothed
geometry but require separate dwell, hysteresis, accessibility, and false-trigger
design.

Some browsers can leave a registered `requestVideoFrameCallback` pending even while
the video clock and decoded frames continue after a source replacement or reload.
A 500 ms watchdog treats that callback path as stalled, cancels it, and moves the
entire paint/decode loop—not merely diagnostics—to a bounded timer fallback for the
remainder of that camera generation. This also keeps decode alive when a background
tab throttles animation frames while its camera stream continues. Browsers may
throttle the timer, but each delivered tick still runs the real single-flight decoder.
Restarting the camera probes the preferred video-frame callback path again.

ActionZones share one typed model and renderer across all camera interactions:
stable ID, semantic action, mirrored screen lane, responsive rectangle, copy,
occupant, status (including paused/reacquiring), hold duration/progress,
accessibility, and reset/completion
identity. Check-in uses mirrored fixed, inset squares in the upper-left and
upper-right of the preview. Their sides are 42% of the preview's shortest
dimension, clamped to 130–190 CSS pixels, with a 4% inset clamped to 12–20
pixels. They render only while at least one valid player QR is present; an
empty stage instead says “Scan your chess piece to log in”. Only a valid
player QR whose mapped center is inside its lane's square can occupy it. Fresh
detections start an uninterrupted two-second hold. A brief decode miss keeps
the zone, name, and game context mounted through the
existing 900 ms presence horizon, but pauses and resets its hold without a
global reacquisition banner. Fresh detection starts a new full two-second hold
without remounting the zones. If multiple distinct codes overlap the squares,
the current occupant is stable; otherwise the center-nearest identity wins
deterministically. Only one player can check in at a time. Coasting/loss,
target exit or identity changes,
camera generation changes, and result
mode reset holds immediately. The single-code `jsQR` fallback supports this
one-player path only.

When a visible player belongs to an ongoing game, a larger instance of the
shared, CSS-sizeable game card is centered in the camera overlay while the rail
keeps its compact card sizing. A fully seated absent opponent is named in a
top header; a one-seat game says that it is waiting for an opponent. Until both
players are present, both lanes' Win, Draw, and Lose zones remain visibly
disabled.
When both players from the same fully seated game are present in
opposite lanes, each player's own lane receives vertically stacked square Win,
Draw, and Lose ActionZones. The stack is inset 12–20 CSS pixels from its outer
preview edge and scales down to a tested 32-pixel minimum for very short stages;
the centered game card remains clear. Win + Lose or Lose + Win records a
decisive result by seat, while Draw + Draw records `1/2-1/2`. Every other pair
is an explicit conflict. Valid pairs share exactly one two-second timer with
both detections fresh. Coasting preserves result mode but pauses actions and
resets the shared timer. The displayed preview is
mirrored, so source coordinates are transformed through the same mirrored
`object-fit: cover` mapping used by tracking before lane and zone matching.
Identity-to-lane assignment is latched from mapped preview x-order with center
hysteresis: a small crossing cannot swap the players mid-hold, while a true
rebind resets the shared timer. Both engaged zones render the same timer
progress. Invalid pairs render an explicit conflict, and switching either choice
starts a fresh hold. More than two actively tracked valid player codes produce
an explicit no-action warning rather than an arbitrary selection.
Leaving a zone, loss of fresh evidence, identity/game/lane changes, or restarting the
camera resets both result holds immediately. The winner maps to canonical PGN
`1-0` or `0-1`, and Draw + Draw maps to `1/2-1/2`; submission remains
single-flight through the immutable endpoint.

Successful finalization refreshes ongoing and recent games, reports explicit
success, and returns still-visible players to check-in-shaped ActionZones with a
move-away/re-enter guard. The guard reopens only after zero qualifying active
detections persist for a short debounce, so a one-frame miss cannot re-arm it.
Stale pre-finalization tracking therefore cannot start a new hold. Result holds
advance only from actively tracked detections; the existing smoothing/coasting
window absorbs brief detector misses without treating coasting geometry as an
irreversible choice. Successful check-in still promotes the table and uses the QR-to-table
animation (or the reduced-motion highlight); failures remain explicit.

New player QR codes contain only a compact, versioned uppercase alphanumeric
reference such as `SC1:YA` for player 1234. The server persists the player and
authoritatively allocates a collision-safe random available ID from 1000–2000
before the browser creates or displays this QR. A persistence failure displays
an error and no QR. Compact scans resolve the name through `GET /api/players/:id`;
successful lookups are cached, concurrent lookups are deduplicated, stale camera
generation requests are aborted/ignored, and unresolved IDs never check in with
a blank or invented name. Distinct raw compact payloads remain distinct tracking
identities while asynchronous lookups complete.

Existing version-1 JSON player codes remain self-contained and compatible:

```json
{"v":1,"kind":"player","playerId":1234,"name":"Ada"}
```

Names are trimmed and limited to 80 characters. The producer's **Print card**
keeps the existing 2-inch layout; **Print sticker** prints crisp vector QR
artwork at exactly 0.9 inches square with name and ID omitted from the symbol.
There is intentionally no PNG download action.

## Development

```sh
npm install
npm run dev
npm run build && npm start
npm test
npm run lint
npm run build
```

Camera access requires HTTPS or localhost. The app asks for permission automatically
when mounted and starts a muted, inline preview. The request uses ideals rather than
exact/minimum resolution constraints, so lower-capability webcams can still negotiate.
After acquisition, the app requests continuous focus, exposure, and white balance only
when each mode is advertised by `getCapabilities()`, then reads back `getSettings()`.
Unsupported controls and optional `applyConstraints()` failures are shown explicitly in
scanner diagnostics and never fail startup. Hardware zoom support and current zoom are
also reported, but zoom is not changed automatically: enlarging one code would reduce
the dual-player field of view, so it remains an opt-in/future control.
Once active, the camera pauses after
five minutes without a successful QR detection; every detected player or arbitrary QR
code resets the full timeout. Focus and visibility changes do not count as QR activity.
The restart action always creates a fresh scanner session. For physical-camera
verification, confirm the inset upper-left square is mirrored correctly; inside-only
single-card check-in and stable selection when two cards overlap the target;
the centered game card and opposite-lane waiting copy; each player's square,
outer-edge Win/Draw/Lose choices; every invalid pair; Draw + Draw; both decisive
mappings; exact two-second simultaneous result
hold; immediate reset when either result code leaves, changes lane, or tracking coasts;
post-result move-away/re-entry; and one request/animation per completion. Also verify
the diagnostics against the actual camera's negotiated resolution/frame rate and
control readback. Unit tests use mocked media
streams and generated QR pixels, so they do not require camera hardware.

### Physical QR limits

New compact stickers use QR error correction Level H, black modules on white,
no logo or decorative intrusion, and an exact four-module quiet zone. The
compact references fit QR Version 1: **21 data modules + four quiet-zone modules
on each edge = 29 modules total**. At 0.9 inches (22.86 mm), each printed module
is approximately **22.86 / 29 = 0.788 mm**. The SVG `viewBox` is 29×29 and uses
crisp vector paths, so printing must not stretch or crop it.

Level H can recover about 30% of **codewords**, not arbitrary image area. A
finger covering a finder pattern, timing pattern, or quiet zone can still make
the code unreadable; alignment and occlusion cannot be solved entirely in
software. Use matte black-on-white stock, no lamination glare, 300+ DPI or the
vector original, no stretching, even front lighting, and close-range testing.
Continuous focus may still hunt, and motion blur can destroy module edges even
at a nominal 60 FPS because exposure time is controlled by the camera.
Browser `BarcodeDetector` implementations, lenses, sensors, and negotiated modes vary.
The 0.9-inch sticker will not reliably scan at 5+ feet; use a larger sticker or
move closer for that distance. The scanner
intentionally does not use unbounded tiling, parallel detectors, blind digital zoom, or
automatic hardware zoom.

The Node 22 server serves the built Vite SPA and stateless Streamable HTTP MCP
on one port. SQLite defaults to `.data/sunset-chess.sqlite`; override it with
`SUNSET_CHESS_DB_PATH`. The v4 schema uses STRICT `Player` and `ChessGame` tables,
foreign keys with `ON DELETE RESTRICT`, and transactional `schema_migrations`.
Every migrated game is ongoing. `ChessGame.tableNumber` is positive and unique
among ongoing games; completed games retain their historical table number.
`createdAt` records creation, `finishedAt` records finalization, and either side
may be empty only while ongoing.
`ChessGame.result` is null while ongoing, or one of the standard PGN tokens
`1-0`, `0-1`, and `1/2-1/2`. A non-null result is final and immutable through
normal APIs.
Database triggers prevent a player from occupying any side of more than one
ongoing game.
Creation atomically assigns the lowest free number and reuses gaps.
When migrating v2 data that contains duplicate participation, each player keeps
their seat in the lowest-ID game; later occurrences are cleared, and games left
with both seats empty are removed. IDs and table numbers of retained games are
unchanged, and the migration verifies the uniqueness invariant before commit.

MCP is published at <http://localhost:4175/mcp>. Tools are `player-list`,
`player-get`, `player-create`, `player-upsert`, `player-check-in`, `player-delete`,
`game-list`, `game-get`, `game-create`, `game-result-set`, and `game-delete`.
Use `game-result-set` to finalize a fully seated game. It accepts only canonical
PGN results and atomically applies the rating update; a finalized result cannot
be changed. Use `player-create` with a name for
natural-language creation; it uniformly chooses an available ID from 1000–2000.
`player-upsert` remains idempotent for known QR/scanner IDs. `game-create`
accepts only black and white player IDs and assigns the table. A quick protocol
smoke can be run with any Streamable HTTP MCP client.

`POST /api/check-ins` accepts a validated player QR identity, updates that player,
and atomically returns their existing game, fills the oldest waiting game, or
creates a waiting game with a cryptographically random side. The read-only `GET /api/games` endpoint returns `games` (ongoing, ordered by
table) and `recentGames` (the 20 most recently finished). `PATCH
/api/games/:id/result` with JSON `{ "result": "1-0" }` (or either other
canonical token) finalizes a fully seated game. The browser loads it immediately,
polls without overlapping requests, refreshes on focus/visibility, preserves
the last successful view on errors, and offers retry. A locally checked-in game
stays first across polls by its immutable ID/creation-time pair without changing
server order; it is cleared when that exact game disappears, so a later game
reusing the same ID is not promoted. A later local check-in replaces that
presentation priority. Other `/api` paths return
JSON 404 responses. Process and database
health are available at:

`POST /api/players` accepts only `{ "name": "Ada" }`, allocates and persists a
player, and returns HTTP 201 before compact QR generation. `GET
/api/players/:id` safely resolves compact references and returns 404 when the
player does not exist.

## Elo rating policy

Players start at **700**. Finalization uses the standard logistic expectation
`E_A = 1 / (1 + 10^((R_B - R_A) / 400))`, fixed **K = 32**, and actual score
`1`, `0`, or `0.5`. The formula is evaluated for White: PGN `1-0` gives White
an actual score of 1, while `0-1` gives White 0. White's delta is rounded to the
nearest integer (halves away from zero), and the exact opposite delta is applied
to Black, guaranteeing a zero-sum integer update. Both ratings and the result commit in one SQLite
`BEGIN IMMEDIATE` transaction, exactly once.

Pre-production policy decisions are intentionally explicit:

- K-factor/provisional handling: fixed K=32 for every player; no provisional tier.
- Rating floor: none yet (ratings may fall below 700).
- Federation compatibility: local ratings are not FIDE/USCF ratings and are not
  interchangeable with federation records.
- Inactivity: no decay.
- Retroactive migration/audit: existing players begin at 700 and migrated games
  remain ongoing; no historical results are inferred. Preserve database backups
  before any future replay/audit migration.
- Result correction/admin workflow: normal mutation is immutable; correction
  requires a future audited admin workflow that reverses the original rating
  transaction before applying a replacement.
- Concurrency: SQLite `BEGIN IMMEDIATE`, a conditional result update, and the
  immutable-result rule serialize finalization and prevent double rating.

From Working Memory Desktop chat, use natural language with the canonical app
mention, for example `@sunset-chess show me current games` or
`@sunset-chess add Elliot as a new player`. The managed container must already
be running and healthy, and its current ContainerClaim must advertise the MCP
endpoint. Read tools run directly; create, update, and delete tools require
confirmation in chat.

```sh
curl --fail http://localhost:4175/health
```

## Container

```sh
npm run deploy:docker
```

The Compose definition applies the same ownership labels, port mapping, and
named volume expected by the Working Memory desktop launcher. Use this command
instead of a manual `docker run`; an unlabeled container is intentionally
rejected by the launcher. Container recreation and restart preserve the
database. To reset it, stop/remove the container and explicitly remove
`working-memory-sunset-chess-data` yourself; the application never deletes the
volume automatically.
