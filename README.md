# Sunset Chess 1.0

A local-first QR camera scanner with a SQLite/MCP control plane.

## Features

- A full-height dashboard with an accessible Leaderboard / Recent Games / Players
  tabbed primary workspace and one persistent, independently scrolling Ongoing
  Games rail. The Players tab pairs Add New Player with a responsive roster:
  player names open a focus-trapped editor with recent game cards, while each
  row's keyboard-operable gear menu provides Edit, one-inch round-sticker
  printing, and guarded deletion.
- Compact Start/Stop Camera and Settings controls share the responsive header,
  leaving the primary tab workspace at full height. Camera state and recovery
  detail remain available to assistive technology, with compact notices shown
  only when action is required.
- A versioned local settings menu beside the camera control. Diagnostics are off
  by default; corrupt preferences reset visibly. The menu supports Escape,
  outside-click dismissal, and narrow viewports.
- A three-step live camera calibration flow for usable framing, representative
  marker evidence, and ActionZone alignment. Versioned inset/offset/scale values
  are clamped to the preview and can be reset.
- Presence-driven camera presentation: capture and decoding continue while the
  fixed, full-viewport mirrored interaction overlay is visually hidden; a valid
  tracked player piece fades it over the unchanged dashboard, and the existing
  bounded tracking expiry fades it out rather than reacting to individual missed
  decode frames. The camera is never a dashboard column or idle placeholder.
- When enabled in Settings, a compact debug-only strip exposes diagnostics and
  recording, which explicitly forces the camera layer visible for its 10-second
  run. Permission and recovery states remain available from the header while
  the mirror is hidden.
- A locally bundled inline-vector Sunset Chess scene places professional queen,
  bishop, and pawn silhouettes against a restrained amber/coral sunset, with
  accessible SVG naming and no runtime network asset
- A high-contrast ink/ivory/amber palette, restrained 3–6px surface corners,
  visible keyboard focus, tabular standings numerals, and distinct
  success/error/draw colors
- Responsive reflow keeps the tabbed workspace and Ongoing Games usable without
  horizontal page overflow on desktop and mobile.
- Smooth camera capture using `requestVideoFrameCallback` (with RAF fallback), an ideal
  1920×1080/60 FPS request, and a non-exclusive 3840×2160 ceiling
- Automatic camera startup on mount, with manual retry when permission or hardware is unavailable
- Five-minute camera inactivity shutdown, reset by every decoded QR code (including arbitrary payloads), with a Start Camera action
- Complementary native `BarcodeDetector` and ZXing-C++ WebAssembly multi-QR
  scanning, with worker-based `jsQR` as an additional staggered attempt
- Mirrored, responsive dual polygons and bounded payload label that follow
  `object-fit: cover`: dashed amber is the last decoded QR anchor and solid cyan
  is the current accepted tracked object
- Identity-bound visual QR object tracking between decodes, with explicit
  decoded/visual/coasting/lost state, confidence, anchor age, and stale expiry

  Tracking continuity is deliberately separated from irreversible evidence:

  - qualified visual gaps now coast for **320ms** (formerly 180ms), reducing
    1.5-second hold resets during intermittent decoder/tracker gaps;
  - geometry may remain visible for **700ms**, decoded identity authority is
    bounded to **1,600ms**, and result action authority is capped at **900ms**;
  - check-in accumulated progress retains for 650ms and results for 450ms, but
    result completion still requires both distinct players with fresh,
    non-ambiguous evidence;
  - the full-screen overlay appears immediately, delays hide for **650ms**, cancels
    that hide on reacquisition, and clears hold/ActionZone state after true
    removal. Reduced-motion users receive no fade transitions.
- Debug-only on-screen negotiated camera settings, optional-control state, camera/decode/paint
  cadence, fresh/present state, and compact per-track source/confidence/age diagnostics
- Explicit 10-second local tracking diagnostic capture with a composited WebM
  (when supported) and synchronized bounded JSON telemetry
- Persisted player QR producer with a 2-inch card plus exact 1×1-inch square and
  1-inch-diameter round-substrate sticker print modes
- Reusable ActionZones for top-corner check-in and lane-aware per-player
  Win/Draw/Lose choices, with motion-tolerant accumulated 1.5-second holds and
  bounded DOM-only progress updates
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

Camera frames remain in the browser and are never transmitted. Decoder
orchestration is complementary rather than an exclusive fallback chain:

### Marker format decision

Sunset Chess retains standards-compliant **QR Version 1 / error correction H**
for identity markers. Standard QR has the strongest maintained browser pipeline
here (`BarcodeDetector`, ZXing-C++ WASM, and jsQR), permissive library licensing,
multi-detector redundancy, and ample capacity for compact `SC1:` base-36 IDs
through 10,000. Micro QR is smaller but is not supported across the existing
three-decoder pipeline. Data Matrix has good density but would require replacing
QR-specific tracking/decoding assumptions. AprilTag and ArUco offer excellent
pose tracking, but require a new maintained detector/WASM and their square
fiducial dictionaries provide no useful benefit for this identity workflow.
No speculative dependency was added.

“Round sticker” therefore means a circular one-inch substrate containing an
uncropped square QR and its complete four-module quiet zone—not rounded modules,
cropping, or a non-standard code. Square stickers remain exactly 1×1 inch.

1. native `BarcodeDetector` receives the original `HTMLVideoElement` at its
   negotiated source resolution every eligible 50 ms cycle;
2. `zxing-wasm` 3.x receives an RGBA `ImageData` frame in a module worker at
   120 ms high, 150 ms balanced, or 320 ms economy cadence;
3. `jsQR` is lazily started after 900 ms without a decode and attempts at most
   every 1.2 seconds, staggered behind ZXing.

An ordinary empty result is not a decoder failure and never disables another
decoder. Native and worker results are normalized into source-video coordinates,
merged within 250 ms, and deduplicated by payload while retaining every distinct
identity. Each decoder is generation-guarded and permits at most one request in
flight, so there is no queue. ZXing is QR-only, searches at most four symbols,
and enables `tryHarder`, rotation, and normal/inverted luminance attempts. jsQR
uses both inversion polarities and remains intentionally single-symbol; it never
fabricates another identity. Canvas capture is unmirrored source RGBA. ZXing
receives that RGBA as `ImageData`, jsQR converts it internally, and OpenCV alone
converts RGBA to luminance with `COLOR_RGBA2GRAY`. Mirroring and
`object-fit: cover` are applied only when source polygons are mapped to preview
coordinates.

The preferred tracker is OpenCV.js pyramidal Lucas–Kanade optical flow in a
dedicated module worker. The maintained `@opencvjs/worker` package is built
specifically for web workers and Vite bundles its version-matched Emscripten
module into the worker asset; no CDN or runtime network dependency is used. Up
to 48 Shi–Tomasi corners are selected with OpenCV `goodFeaturesToTrack` only
inside a 90%-inset decoded quadrilateral mask. Candidates are round-robin
distributed over a 3×3 grid and carry their source cell through LK; arbitrary
background padding is never eligible. Points are tracked forward and backward
with a 31×31 LK window through pyramid level 4. A deterministic robust estimator
then fits every eligible model independently: similarity requires 4 survivors
over two cells, affine requires 6 over three cells, and homography requires 10
over four cells. Models use a 2.5 px reprojection gate and at least a 62–65%
inlier ratio. Selection starts at the lowest-complexity valid fit. Affine can
replace similarity, and homography can replace the current simpler fit, only
when it preserves inlier evidence within 8% and reduces mean robust reprojection
error by more than both 0.18 px and 15% of the simpler model's error. This
explicit complexity penalty prevents projective terms from fitting subpixel LK
noise while retaining homography for materially perspective motion.

Accepted geometry must retain winding and convexity, finite in-frame corners,
at least 64 px² area, bounded per-frame area/edge changes, bounded projective
terms, displacement, and acceleration. Mean LK error must remain ≤24 px and
forward/backward drift ≤1.5 px; UI confidence must remain ≥0.52. A fit is
rejected rather than predicted into a new location. When inlier features fall
below 20 or fewer than three cells remain, features are reseeded inside the
accepted transformed inset quad without changing identity. Converging/ambiguous
or crossing identities are dropped. The roughly 0.9-second center trail is
presentation-only, color-coded by model/confidence, and ages out with evidence;
it is never ActionZone geometry. Final-result ActionZone authority requires
confidence ≥0.82 and a decode
anchor no older than 650 ms; frame gaps over 220 ms expire. Check-in may additionally
accumulate on accepted visual evidence at confidence ≥0.78 while its decode identity
anchor remains within the hard 1.6-second bridge. Fresh high-confidence visual
evidence may preserve display continuity through a hard 1.6-second decode-anchor
TTL, while evidence itself expires after 450 ms without another accepted flow.

Every decoder result still refreshes identity authority, decode time, and the
amber dashed decoded anchor. It does not automatically replace cyan geometry.
A repeated registered decode is suppressed when the current track has
confidence ≥0.78, visual evidence no older than 180 ms, center disagreement
≤6% of √area, bounding-box IoU ≥0.72, corner RMS disagreement ≤8% of √area,
area ratio 0.80–1.25, and aspect ratio 0.85–1.18. Thus alternating native/ZXing
corner estimates cannot repeatedly replay the track. A new identity, stale or
rejected evidence, low confidence, material disagreement, capture
dimension/generation change, or the 2.5-second drift-control interval forces a
registered chronological replay. An unregistered decode can refresh authority
but cannot seed geometry on a later frame.

Accepted visual quads pass through one coherent per-identity adaptive filter;
raw evidence remains diagnostic-only. With object size `s = √area`, stationary
entry requires five consecutive measurements with center change ≤`0.020 × s` and
translation-removed corner-shape RMS ≤`0.035 × s`. Stationary exit occurs immediately
at center change >`0.040 × s`, raw-to-filtered corner RMS >`0.055 × s`, or accumulated
center residual >`0.025 × s`. Stationary cutoff is 0.55 Hz with a `0.003 × s` deadband.
Moving cutoff is `min(24, 4 + 5v)` Hz, where `v` is center speed in object
widths/second, and gain is `1 − exp(−2π·cutoff·Δt)`. Trustworthy displacement
≥`0.35 × s` snaps/reacquires. There is no extrapolation without visual evidence.
Both cyan display geometry and ActionZone hit testing consume the same filtered
quad; the trail also records filtered centers.

At 960×540, deterministic tests drive ±2 px per-corner stationary noise plus
periodic decoder offsets for five seconds and require settled center RMS
≤0.35 px and corner RMS ≤0.60 px. A one-width 320 ms ramp must reach at least
85% within 160 ms after the move ends with <2 px overshoot; slow motion must
advance continuously rather than stair-step. Boundary-noise tests require one
stable ActionZone occupant and uninterrupted hold completion.

If OpenCV fails initialization, lacks required APIs, times out, or fails at
runtime, diagnostics explicitly switch to the existing bounded normalized-template
tracker. It follows the same historical registration and chronological replay
rule; it never seeds delayed geometry directly on a new frame. Failed fallback
replay leaves only the dashed decoded reference. Neither tracker creates payload
identities: only a decoder can identify one.

### Tracking diagnostic capture

While the camera is active, choose **Record 10s tracking diagnostic**. The click
is required; capture never starts automatically. Status announces that camera
imagery is being recorded locally and counts down. A dedicated canvas reproduces
the preview's `object-fit: cover` crop, mirrors camera pixels exactly once, then
composites the decoded anchor, accepted fit, trail, ActionZones, legend,
timestamps, decoder timing, registration/replay timing, model,
feature/survivor/inlier counts, reprojection/forward-backward error, confidence,
dimensions/cadence, identity, and rejection reason. It also reports all
candidate-model errors and the selection reason, decode refresh/suppressed/forced
reanchor counters and reason, stationary/moving state, raw and filtered
centers/quads, raw-filter delta, normalized speed, cutoff, and gain.

At ten seconds, matching timestamp/session-ID downloads appear:

- `sunset-chess-tracking-<session>.webm`
- `sunset-chess-tracking-<session>.json`

JSON includes browser/camera settings and capabilities, preview/source mapping,
device pixel ratio, quality tier, policy constants, at most 720 per-frame
records, at most 400 events, and ActionZone state. WebM is bounded to 40
one-second chunks. Replacing a bundle revokes old object URLs. No capture is
uploaded, sent to the server, written to SQLite, or mixed with unrelated app
data. Camera imagery exists only in the explicitly requested WebM; JSON contains
geometry and diagnostics, not pixels.

Canvas `captureStream` and `MediaRecorder` WebM work in current Chromium and
Firefox; Safari support varies. If either API is missing or recorder creation
fails, the UI explicitly provides JSON only. Reproduce the issue during the
countdown, download both matching files, and attach the `.webm` and `.json` to
the next message. If only JSON is offered, attach it and mention the displayed
browser limitation.

The current-object box disappears after 450 ms without accepted visual evidence;
the separate decoded anchor may remain as a location reference until its 1.6-second
TTL, and never counts as current presence by itself. These conservative gates let
strong visual evidence bridge momentary blur without allowing lower-confidence
geometry to complete check-in or result actions. They
also avoid a global “Reacquiring… actions paused” banner: labels and zones can
remain mounted while their local progress pauses. Diagnostics report each active
track as decoded or visual with confidence, decode-anchor age, and visual-evidence age.

Quality is capability- and latency-driven, never UA-driven. Decode and tracking
resolution are independent. The initial tier uses
the negotiated camera resolution/rate, `hardwareConcurrency`, `deviceMemory`
when exposed, WebAssembly/SIMD, OffscreenCanvas, and page visibility. High uses
1920 px decode / 960 px tracking at 120/33 ms; balanced uses 1920/640 at
150/55 ms; economy uses 1280/480 at 320/90 ms. A 1920×1080 source therefore
reaches both native and ZXing at the full 1920×1080 in high and balanced tiers.
Sources above a tier's worker cap receive a full-source attempt at least once
per second; intervening 4K worker attempts are bounded to 1920 px while native
continues to see the full source. Decode latency above 260 ms or
tracking above 75 ms steps the tier down, and decode cadence expands to at least
1.35× measured latency (capped at 1 second). A hidden page uses economy. This makes
capable Apple Silicon Macs naturally high quality without excluding equally
capable non-Mac systems. Camera acquisition still requests the existing high
ideals and safely accepts lower negotiated modes.

Decode and tracking are independent single-flight pipelines. Every native dispatch
registers a tracking-resolution copy on the same video tick; ZXing/jsQR derive
their copy from the exact unmirrored decoder canvas. Regular tracking captures
continue independently. Registration history is chronological and bounded to 12
frames, 650 ms, and 24 MiB (whichever limit is reached first); high-tier
960×540 RGBA therefore retains 12 frames/about 23.7 MiB, while balanced
640×360 retains all 12/about 10.5 MiB. Generation, tier, or dimensions changing,
and camera stop, clear it.

When decoded geometry returns, its own decoder and `capturedAt` remain paired.
The freshest geometry per identity wins; timestamps are never borrowed from a
different decoder. The anchor must match an exact/nearest compatible historical
frame within 24 ms. OpenCV seeds on those historical pixels and replays the
bounded chronological history to its newest frame before publishing the cyan
current-object box. Reanchor has priority over the next live frame, is
single-flight/no-queue, and explicitly resets/reseeds worker tracks from all
currently registered identities. Missing history, mismatched generation/tier/
dimensions, excessive latency, ambiguous/crossing tracks, or failed LK validation
rejects current evidence fail-closed; the historical dashed anchor may remain,
but cannot advance an ActionZone hold.

History keeps its own pixel buffers and only transferred copies are detached.
Diagnostics report capture→completion latency, history depth/age/memory,
registration delta, replay frame count/latency, current visual-evidence age,
last registration/replay rejection, tracking-capture FPS/cost, optical
requests/completions, accepted/rejected counts, tracker ready/busy state, source
resolution, and per-decoder input dimensions/cadence. Source video, decoder
canvases, history, and LK coordinates stay unmirrored. CSS mirrors the video once,
and source polygons are mirrored exactly once during preview mapping.

### Long-range regression fixed

Commit `dbb5ffa` accidentally changed decoder *selection* as well as adding the
portable workers. Once ZXing initialized, the 6cff31e native path was no longer
called after normal zero-result frames; native ran only after worker
initialization/runtime failure. On a 1920×1080 camera, high-tier ZXing received
1440×810 (balanced 1080×608, economy 720×405), while OpenCV capture also ran
before decode scheduling. The previous native path had received the full
1920×1080 every 50 ms. ZXing additionally had `tryHarder: false`.

The corrected pipeline restores full-source native detection every eligible
cycle, supplies full 1920×1080 RGBA to ZXing on the target Mac, enables the
difficult-code options, preserves periodic full-detail attempts under adaptation,
keeps tracking at its independent lower resolution, and merges complementary
results instead of treating “no symbols” as failure or exclusivity.

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
occupant, status (including paused), hold duration/progress,
accessibility, and reset/completion
identity. Check-in uses mirrored fixed, inset squares in the preview. Their preferred
sides are 42% of the preview's shortest dimension, clamped to 130–190 CSS pixels.
Both lanes target an 11% stage-width horizontal inset clamped to 32–112 pixels;
narrow stages reduce the square only when needed to preserve a 16-pixel lane gap.
Their upper inset targets 8% of stage height, clamped to 12–48 pixels, with
very-short-stage fit protection. Moving the targets toward the optical center makes
camera optics and QR detection more reliable while preserving recognizable
upper-left and upper-right placement. They render only while at least one valid player QR is present; an
empty stage instead says “Scan your chess piece to log in”. Only a valid
player QR whose mapped center is inside its lane's square can occupy it. Once occupied,
the center may move within an exit boundary expanded by 20% of the square (at least
18 CSS pixels); new occupants must still enter the original square. Fresh decoded or
accepted high-confidence visual evidence accumulates toward the 1.5-second hold.
A brief decode miss with weaker evidence keeps
the zone, name, and game context mounted through the
bounded visual-presence horizon and pauses the hold for up to 650 ms without a
global reacquisition banner. Requalification resumes preserved progress; only a
longer gap, changed identity, camera generation, re-entry reset, or completion clears
it. If multiple distinct codes overlap the squares,
the current occupant is stable; otherwise the center-nearest identity wins
deterministically. Only one player can check in at a time. Coasting or a larger target exit pauses first; identity and camera-generation changes
reset immediately. The single-code `jsQR` fallback supports this
one-player path only.

When a visible player belongs to an ongoing game, a larger instance of the
shared, CSS-sizeable game card is centered in the camera overlay while the rail
keeps its compact card sizing. A fully seated absent opponent is named in a
top header; a one-seat game says that it is waiting for an opponent. Until both
players are present, both lanes' Win, Draw, and Lose zones remain visibly
disabled.
When both players from the same fully seated game are present in
opposite lanes, each player's own lane receives vertically stacked square Win,
Draw, and Lose ActionZones. Each stack targets the shared 11%-of-stage-width
inset (32–112 pixels), then moves outward or scales down only as needed to preserve
the centered game card, modeled as a 15%-of-stage half-width clamped to 75–140
pixels, plus a 2.5%-of-stage safety gap clamped to 6–16 pixels. This central-safe
positioning improves optical/detection reliability without overlapping the card,
the opposite lane, or stage bounds, including narrow and very short stages.
Win + Lose or Lose + Win records a
decisive result by seat, while Draw + Draw records `1/2-1/2`. Every other pair
is an explicit conflict. Valid pairs share exactly one accumulated 1.5-second timer with both detections
strictly authoritative. Missing authority pauses progress for at most 450 ms and
re-acquisition resumes it, but submission is possible only on a currently authoritative
frame. The displayed preview is
mirrored, so source coordinates are transformed through the same mirrored
`object-fit: cover` mapping used by tracking before lane and zone matching.
Identity-to-lane assignment is latched from mapped preview x-order with center
hysteresis: a small crossing cannot swap the players mid-hold, while a true
rebind resets the shared timer. Both engaged zones render the same timer
progress. A selected result zone has an 8% (minimum 6 CSS pixels) exit hysteresis;
new choices still require the original rectangle. Invalid pairs render an explicit
conflict and reset, and switching either choice starts a fresh hold. More than two actively tracked valid player codes produce
an explicit no-action warning rather than an arbitrary selection.
Leaving beyond hysteresis or loss of fresh evidence pauses within the 450 ms retention;
identity/game/lane changes, conflicting choices, or restarting the camera reset
immediately. The winner maps to canonical PGN
`1-0` or `0-1`, and Draw + Draw maps to `1/2-1/2`; submission remains
single-flight through the immutable endpoint.

Successful finalization refreshes ongoing and recent games, reports explicit
success, and returns still-visible players to check-in-shaped ActionZones with a
move-away/re-enter guard. The guard reopens only after zero qualifying active
detections persist for a short debounce, so a one-frame miss cannot re-arm it.
Stale pre-finalization tracking therefore cannot start a new hold. Result holds advance only from decoded or high-confidence, recently
decode-anchored visual detections. Lower-confidence tracking can preserve context
but cannot be treated as an irreversible choice. Successful check-in still promotes the table and uses the QR-to-table
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
inward Win/Draw/Lose choices; every invalid pair; Draw + Draw; both decisive
mappings; exact 1.5-second simultaneous result
hold with short authority gaps and natural hand wiggle; reset after retention,
choice conflicts, lane changes, and camera restart;
post-result move-away/re-entry; and one request/animation per completion. Also verify
the diagnostics against the actual camera's negotiated resolution/frame rate and
control readback. Unit tests use mocked media
streams and generated QR pixels, so they do not require camera hardware.

Browser capture remains permissioned by design: `getUserMedia`, device selection,
preview, frame capture, and lifecycle stay inside the browser security model.
There is no Electron, Tauri, native helper, permission bypass, or camera upload.
Chromium, Firefox, and Safari builds with WebAssembly and workers can use ZXing;
native `BarcodeDetector` is an optional acceleration/fallback, not a requirement.
Older browsers without WASM can reach native or `jsQR`; if no decoder initializes,
the scanner fails explicitly. OpenCV costs roughly 15.5 MiB uncompressed on disk
plus WASM/heap memory at runtime, so lower-memory systems use smaller frames and
slower cadence. ZXing's reader WASM is about 0.95 MiB in the production build.

### Vision dependencies and licenses

- `zxing-wasm` 3.1.4: MIT; packages the ZXing-C++ reader WASM locally.
- ZXing-C++ within that package: Apache-2.0.
- `@opencvjs/worker` 5.0.0-release.2: Apache-2.0; maintained worker-specific
  OpenCV.js package bundled locally by Vite.
- `jsQR` 1.4.0: Apache-2.0; retained as the last decoder fallback.

The lockfile pins resolved artifacts; no computer-vision assets are fetched from
a CDN or vendored separately from their packages.

### Brand artwork and attribution

The sunset, landscape, spacing, and overall scene composition are the Sunset
Chess brand artwork. The queen, bishop, and pawn SVG definitions are from
**Font Awesome Free 7.3.1** by Fonticons, Inc. Font Awesome Free SVG/JS icons are
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), and its
code is MIT licensed. They are imported individually from
`@fortawesome/free-solid-svg-icons` so Vite can include only the three required
definitions. The icons are bundled locally and make no runtime requests.

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the attribution and
license links. Font Awesome and Fonticons do not endorse Sunset Chess.

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
`SUNSET_CHESS_DB_PATH`. The v5 schema uses STRICT `Player`, `ChessGame`, and
`PlayerRatingEvent` tables,
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
Before v3 changes any legacy table, migration checks active-player participation.
Duplicate seats stop startup without changing or renaming the legacy table. The
operator-facing error identifies a duplicate player and requires the operator to
back up the database and resolve every duplicate before restarting. Valid,
non-conflicting legacy databases continue to migrate transactionally.

`PlayerRatingEvent` is the append-only rating source of truth. Each row records
the player, optional game, previous/new rating, integer delta, ISO timestamp,
and an explicit `baseline`, `game`, or `migration` reason; game events also
record opponent and canonical result. A partial unique index permits one event
per player/game. Ledger foreign keys use `ON DELETE RESTRICT`. A player may be deleted only while
unreferenced by every game and represented by exactly one baseline rating event;
cleanup deletes that baseline and the player in one transaction. Game references
or any non-baseline history permanently block deletion.
`Player.rating` remains a transactionally maintained projection
for compatibility and efficient game-card joins. Reads verify it against the
latest ledger row (or 700 when no row exists) and fail explicitly on divergence.
Migration replays completed games in `finishedAt`, then ID order using the same
production Elo function. A player whose reconstructed total matches the cached
rating receives a 700 baseline and real game events. A mismatch receives one
`migration` event at the preserved cached rating; no delta or unavailable
pre-ledger history is fabricated. Startup is transactional and idempotent.

MCP is published at <http://localhost:4175/mcp>. Tools are `player-list`,
`player-get`, `player-create`, `player-upsert`, `player-name-update`,
`player-check-in`, `player-delete`,
`game-list`, `game-get`, `game-create`, `game-result-set`, and `game-delete`.
Read tools also include `leaderboard-list` and `player-profile-get` for ranked
records, recent games, and chronological rating history.
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
player, and returns HTTP 201 before compact QR generation. `GET /api/players`
lists the complete ranked roster with Elo and W/L/D. `PATCH
/api/players/:id` accepts only `{ "name": "New name" }` and preserves identity,
games, and rating history. `GET
/api/players/:id` safely resolves compact references and returns 404 when the
player does not exist. `DELETE /api/players/:id` is the narrow rollback endpoint
for an unreferenced, baseline-only player and returns 409 once games or rating
history make deletion unsafe. If browser QR encoding fails after persistence, the
producer attempts this cleanup and reports cleanup failure explicitly. Compact
lookup retries transient network/server failures with capped exponential
cooldown, retains the visible error while cooling down, and resets retry state
when the camera restarts or the reference leaves and re-enters view.

Static files are served only when a path-relative containment check places the
resolved file strictly below the public directory. The pure check rejects
absolute, parent, cross-drive, and sibling-prefix escapes under both POSIX and
Windows path semantics.

`GET /api/leaderboard?limit=100` returns ordinal ranks in stable order: rating
descending, games played descending, case-insensitive name ascending, then ID.
The bounded limit is 1–200. `GET /api/players/:id/profile?recentLimit=10`
returns record/rank, newest-first completed games (maximum 50), and full
chronological Elo history. Malformed bounds return 400 and missing players 404.
The Elo Leaderboard occupies its dashboard tab. Rows are native keyboard buttons. The profile is an
ARIA modal with focus entry/return, Escape/close/backdrop dismissal, a textual
recent-game/history table, and an accessible SVG sparkline.

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
- Retroactive migration/audit: the v5 migration reconstructs only verifiable
  completed-game history; mismatches preserve current Elo in a migration marker.
  Preserve database backups before any future replay/audit migration.
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
