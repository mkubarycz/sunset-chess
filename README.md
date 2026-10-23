# Sunset Chess 1.4

A local-first QR camera scanner with a SQLite/MCP control plane.

## Features

- A full-height dashboard with an accessible Leaderboard / Recent Games
  tabbed primary workspace and one persistent, independently scrolling Ongoing
  Games rail. The Leaderboard provides Add player in a shared modal alongside
  the ranked roster. Leaderboard rows open a reusable,
  focus-trapped player card with an auto-saving name field, compact ID/Elo
  identity, guarded deletion, ongoing table assignments, and recent game cards.
  Every player card also provides one-inch round-sticker printing.
- Compact Start/Stop Camera and Settings controls share the responsive header,
  leaving the primary tab workspace at full height. Camera state and recovery
  detail remain available to assistive technology, with compact notices shown
  only when action is required.
- A versioned local settings menu beside the camera control. Diagnostics are off
  by default; corrupt preferences reset visibly. The menu supports Escape,
  outside-click dismissal, and narrow viewports.
- Fixed responsive ActionZone geometry adapts to the full-viewport camera
  coordinate space without user setup, preserving mirrored camera mapping on
  desktop and mobile.
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
- Result recording returns authoritative post-game ratings and per-player
  deltas; the camera remains visible for a three-second accessible
  acknowledgement, then the acknowledgement and camera fade together. The
  completed pair stays re-entry blocked, while a newly scanned player restores
  the camera and normal interaction immediately.
- The green activity notice uses concise result and check-in summaries. Draw
  acknowledgements use an emphasized `DRAW`, and completed draw cards give both
  players the same green treatment.
- Two unrelated detected players retain stable left/right ownership. Each lane
  independently shows its ongoing game card or enables its own check-in
  ActionZone; score reporting remains available only when both pieces belong to
  the same result-ready game.
- Friendly player labels while retaining support for arbitrary QR strings
- Persistent players and chess games through a local MCP endpoint
- Responsive ongoing-game thumbnail rail with a compact two-rank board showing
  both standard back ranks between Black and White player details, a
  high-contrast table badge, and automatic refresh about every two seconds.
  Selecting a clean thumbnail opens a shared, focus-trapped game detail modal
  containing seat assignment/replacement and eligible cancellation controls,
  plus finished/cancelled game audit details.
- Player-card game history remains at the organizer's chosen horizontal scroll
  position during background refreshes, without snapping to card boundaries.
  Open cards refresh in place without discarding focus or unsaved name edits.
- Twenty most recently completed games with compact W/L/D plus signed Elo
  changes and each player's Elo at the beginning of that game
- One Club Sessions dropdown for creating a session, opening one of the five
  most recent sessions, or choosing Find Past Sessions to open an all-sessions
  dashboard tab with dates, status, player/game counts, and a clear empty state.
  Close the active session before creating another. Closed sessions open read-only details, session standings,
  and their complete recorded game history (not just the twenty latest games).
  Session URLs also support reload and browser Back/Forward. Overall records
  and Elo remain current club totals; the Session Record column is session-only.
- Leaderboard and session record columns use `5W 1D 2L` order without game
  counts: high-contrast green wins, neutral draws, and red losses. Letter labels
  and expanded accessible names keep the meaning independent of color.
- Empty session pages (active or closed) offer a top-right trash icon with
  confirmation. Deletion is soft: the database row and cohort snapshots are
  retained, but the session is hidden from menus, archives, and resource reads.
  The server atomically requires zero check-ins and zero games, including
  completed or cancelled games. Deleting an active empty session frees the
  active-session slot.
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
After qualification, a same-identity authoritative decode or high-confidence
visual observation refreshes a 240 ms qualification grace. During that bounded
window, a lower-confidence fallback observation may continue a check-in hold only
while its decoded authority remains fresh and its visual geometry remains within
the existing 320 ms coast bound. The grace cannot seed qualification, cross an
identity change or retain stale geometry.

Final-result holds have a separate, stricter 180 ms authority grace. It applies
only after a direct-authority result hold has started and both already matched
identities still have geometry within the 320 ms coast bound and decoded anchors
within the 900 ms result-action bound. The game, identity set, lane binding, and
non-conflicting assignment key must all remain unchanged, and each player must
have had direct result authority within the grace window. Grace never seeds a
hold, crosses a context change, survives a conflict, or submits a result; a
completed hold waits for a direct-authority frame before submission.

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
Each visible track also records hold-qualification source, tracker confidence,
remaining qualification grace, decoded-anchor age, and visual-evidence age.

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
is an explicit conflict. Valid pairs share exactly one accumulated 1.5-second timer. Direct authority from
both detections starts the timer; a qualifying 180 ms result-specific grace may
continue an already-started timer through a brief confidence dip under the
constraints above. Other missing authority pauses progress for at most 450 ms and
re-acquisition resumes it, but submission is possible only on a currently direct-authority
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
Stale pre-finalization tracking therefore cannot start a new hold. Result holds
start only from decoded or high-confidence, recently decode-anchored visual
detections. Lower-confidence tracking may continue an existing hold for the
bounded 180 ms grace but cannot seed or submit an irreversible choice. Successful
check-in still promotes the table and uses the QR-to-table
animation (or the reduced-motion highlight); failures remain explicit.

New player QR codes contain only a compact, versioned uppercase alphanumeric
reference such as `SC1:YA` for player 1234. The server persists the player and
authoritatively allocates a collision-safe random available ID from 1000–2000
before the browser creates or displays this QR. A persistence failure displays
an error and no QR. Compact scans resolve the name through
`GET /api/players/resolve?scanningIdentifier=...`;
successful lookups are cached, concurrent lookups are deduplicated, stale camera
generation requests are aborted/ignored, and unresolved IDs never check in with
a blank or invented name. Distinct raw compact payloads remain distinct tracking
identities while asynchronous lookups complete.

Player records may have a unique scanning identifier independent of their
database ID. A null identifier falls back to the player ID, so existing compact
codes continue to work. The player card's **Scan Code** action opens the existing
camera scanner and requires holding the scanned code in the upper-right
confirmation zone before assigning it. If another player already owns that code,
the confirmation names both players and transfers it through the same gesture.
After confirmation, the scanner locks, acknowledges the save, and fades back to
the still-open player card. Transfers swap effective codes without deleting or
merging either record.

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
`SUNSET_CHESS_DB_PATH`. Schema v10 physically migrates the legacy v9 tables to
first-class STRICT resource tables: `PlayerResource`, `GameResource`,
`ClubSessionResource`, `CheckInResource`, `RatingEventResource`, and
`PairingCohortResource`. Foreign keys and transactional `schema_migrations`
preserve v9 identities, games, sessions, rating history, cohorts, and constraints.
`GameResource.tableNumber` is positive and unique
among ongoing games; completed games retain their historical table number.
`createdAt` records creation, `finishedAt` records finalization, and either or
both sides may be empty only while ongoing. Cancelling an unfinished game
deletes it. `cancelledAt` and optional `cancellationReason` preserve finished
game cancellation as an auditable state.
`GameResource.result` is null while ongoing, or one of the standard PGN tokens
`1-0`, `0-1`, and `1/2-1/2`. A non-null result is final and immutable through
normal APIs.
Database triggers prevent a player from occupying any side of more than one
non-cancelled ongoing game.
Creation atomically assigns the lowest free number and reuses gaps.
Before v3 changes any legacy table, migration checks active-player participation.
Duplicate seats stop startup without changing or renaming the legacy table. The
operator-facing error identifies a duplicate player and requires the operator to
back up the database and resolve every duplicate before restarting. Valid,
non-conflicting legacy databases continue to migrate transactionally.

`RatingEventResource` is the append-only rating source of truth. Each row records
the player, optional game, previous/new rating, integer delta, ISO timestamp,
and an explicit `baseline`, `game`, `migration`, or `compensation` reason; game and
compensation events also
record opponent and canonical result. A partial unique index permits one event per player/game/reason. Ledger foreign keys use
`ON DELETE RESTRICT`. Original events are never changed or removed. A finished
game can be cancelled only when it is the most recent non-cancelled finished
game for both players, ordered by `finishedAt` then game ID. Cancellation
atomically appends the exact inverse event for each player and updates the
rating projection. It is idempotent. A later game for either player blocks the
whole transaction with an administrator-contact error; there is no override.
Cancelled games never contribute to Elo starts, leaderboard records, W/L/D,
pairing, or profile recent games. A player may be deleted only while
unreferenced by every game and represented by exactly one baseline rating event;
cleanup deletes that baseline and the player in one transaction. Game references
or any non-baseline history permanently block deletion.
`PlayerResource.rating` remains a transactionally maintained projection
for compatibility and efficient game-card joins. Reads verify it against the
latest ledger row (or 700 when no row exists) and fail explicitly on divergence.
Migration replays completed games in `finishedAt`, then ID order using the same
production Elo function. A player whose reconstructed total matches the cached
rating receives a 700 baseline and real game events. A mismatch receives one
`migration` event at the preserved cached rating; no delta or unavailable
pre-ledger history is fabricated. Startup is transactional and idempotent.

Club Sessions persist a pairing mode and a frozen four-cohort Elo snapshot.
`Club Session Pairing 1` is the default. At session creation, the full club
roster is sorted by rating descending and player ID ascending, then divided as
evenly as possible into cohorts A through D, with remainder slots assigned from
A downward. A player added after session creation joins the cohort matching the
frozen rating boundaries without moving existing players. Check-in considers
only waiting opponents in the same cohort who have not already played the
incoming player during that session. For second and later games, it first
prefers opponents with the same cumulative session record sign (positive,
even, or negative), then the longest-waiting eligible opponent. If none is
eligible, check-in reuses an empty table or creates a new one.

Session standings show a Cohort column instead of rank numbers or
gold/silver/bronze badges, without grouping or reordering players by cohort.
Letter badges distinguish A (blue), B (purple), C (green), and D (orange), with
text labels so identification does not depend on color alone. The badges
use the frozen session assignments, not a fresh split of today's Elo ratings,
so they continue to show the algorithm's actual pairing boundaries as ratings
change. Player readiness, table links, Elo, lifetime records, and session records
remain available. If a session member has no recorded cohort, the view explicitly
shows a neutral dash labeled "No cohort assigned" rather than guessing an assignment.
The overall club leaderboard retains its existing ranks and podium badges.

## Resource contract and adapters

Sunset Chess 1.2 publishes a self-describing Zod application contract at
`GET /api/contract` and `GET /.well-known/sunset-chess-contract`. The common
resource envelope is `{ kind, metadata, spec, status, relationships }`. The
contract describes every resource's JSON schemas, relationships, CRUD/query
capabilities, constraints, lifecycle rules, effects, errors, and events.

The source contract lives in `server/data-contract/`. Each resource owns a
small `<resource>.ts` descriptor, while each supported generic method owns its
input/output schemas and operation documentation in a discoverable
`<resource>.<method>.ts` file. `server/data-contract/index.ts` is the small
public assembler/export surface consumed by the runtime transports and tests.

Generic HTTP operations are:

- `GET /api/resources/:kind` with optional `limit`, `eventId`, and `playerId`
  relationship filters;
- `GET /api/resources/:kind/:id`;
- `POST /api/resources/:kind`;
- `PATCH /api/resources/:kind/:id`;
- `DELETE /api/resources/:kind/:id`.

MCP exposes the same model through `contract-discover`, `resource-query`,
`resource-get`, `resource-create`, `resource-update`, and `resource-delete`.
The existing UI-focused `/api` endpoints and named MCP tools remain compatibility
adapters over the same repository behavior.

`DELETE /api/sessions/:id` and generic `club-session` resource deletion share
the empty-session guard. Schema v13 records `deletedAt` and deactivates a
soft-deleted session; its retained row cannot be renamed, reopened, or used
for new games. The generic delete response reports lifecycle `deleted`, while
subsequent reads return not found. There is no automatic restore action.

`check-in` is a first-class immutable resource. Creating it atomically upserts
the constrained 1000–2000 player identity, preserves or assigns the frozen
session cohort, records attendance, and preserves or produces game/table
placement. Its response includes player and game effect envelopes. A failed
placement rolls the check-in, cohort assignment, player change, and game change
back together. v9 stored attendance but not an immutable original placement;
migration reconstructs active placements and explicitly marks older
unrecoverable placement status as `migrated` instead of inventing history.

MCP for 1.4 is published at <http://localhost:4176/mcp>. Compatibility tools are `player-list`,
`player-get`, `player-create`, `player-upsert`, `player-name-update`,
`player-check-in`, `player-check-out`, `player-delete`,
`game-list`, `game-get`, `game-create`, `game-result-set`, `game-cancel`,
`game-seat-update`, `game-start`, and the backward-compatible `game-delete`.
Read tools also include `leaderboard-list` and `player-profile-get` for ranked
records, recent games, and chronological rating history.
Club Session tools create, list, rename, select the pairing mode, and close
sessions.
Use `game-result-set` to finalize a fully seated game. It accepts only canonical
PGN results and atomically applies the rating update; a finalized result cannot
be changed. Use `player-create` with a name for
natural-language creation; it uniformly chooses an available ID from 1000–2000.
`player-upsert` remains idempotent for known QR/scanner IDs. `game-create`
accepts only black and white player IDs and assigns the table. A quick protocol
smoke can be run with any Streamable HTTP MCP client.

`POST /api/sessions/:id/check-ins` accepts `{ "playerId": 1234, "name": "Ada" }`
and checks the player into that specific active session. Closed or stale session
requests fail without changing player or attendance data. The main leaderboard
does not offer check-in or checkout controls; use the active session's
**Add player to session** selector or its attendance controls. Camera check-in
selects the active session and submits its explicit ID; without an active
session, the browser reports an error instead of creating standalone attendance.

Attendance survives scoring. After a result is recorded, eligible checked-in
players are automatically paired within their frozen cohort, without repeating
opponents in that session. Existing waiting tables are filled first. Players
without an eligible opponent remain **Checked in · Available for pairing**;
they are not placed into new single-player waiting games just because a result
was recorded. An arriving player can pair with these available attendees.

**Check out** appears next to session players. Waiting and paired players can
check out before their game starts: their seat is cleared, any opponent remains
waiting, and an empty game is removed. Once the game starts, checkout is blocked
both in the UI and on the server until it finishes or is cancelled.
`DELETE /api/sessions/:id/check-ins/:playerId` records checkout while preserving
attendance and historical results. Checked-out players without completed games
are hidden from session standings; those with completed results remain listed
as **Checked out · Unavailable** with a **Check in** button. They are excluded from automatic
pairing and seat pickers, and cannot be assigned manually, by QR seat scan, or by
HTTP/MCP resource operations. Explicit check-in reactivates their existing
attendance row. Session closure checks everyone out without creating new games.
Cancelling an unfinished game does not trigger automatic re-pairing, so its
players can then check out. Historical sessions remain read-only.

`player-check-in` and generic `check-in` creation accept `eventId` to select the
session; `player-check-out` requires it. Generic `check-in` updates accept
`{ "checkOut": true }`. The old `POST /api/check-ins` endpoint and unscoped MCP
check-in remain compatibility paths for older standalone clients, but are not
used by browser check-in. Migration 14 adds nullable checkout timestamps and
recovers attendance for existing active-session manual game seats.

The read-only `GET /api/games` endpoint returns `games` (ongoing, ordered by
table) and `recentGames` (the 20 most recently finished). `PATCH
/api/games/:id/result` with JSON `{ "result": "1-0" }` (or either other
canonical token) finalizes a fully seated game. `PATCH
/api/games/:id/seats/:side` accepts `{ "playerId": 1234 }` or
`{ "playerId": null }` to assign, replace, or remove one active seat.
`GET /api/players?gameId=:id` returns the player roster (not the
200-entry leaderboard subset), excluding players checked out of that game's
session and including check-in and source-table context.
Selecting an unchecked player creates session membership and a pairing cohort,
then seats them directly without invoking automatic pairing. Selecting someone
at another table in the same event moves them, leaves their former seat empty,
and keeps the old table. Players in a different event remain visible but cannot
be moved across events. Seating, movement, and check-in changes are atomic;
none change Elo.

`POST /api/games/:id/start` explicitly marks a fully seated unfinished game as
**Playing**. This persists `startedAt`, displays a yellow lock icon beside the
table number on the card, and
locks seat edits and unfinished-game cancellation behind organizer consent.
For cancellation in the table popup, choosing Cancelled supplies that consent;
unfinished games are removed immediately without an additional confirmation.
Both the destination and a moved player's source table are checked. A blocked
seat request returns HTTP 409 with `requiresStartedOverride: true`; the
organizer can keep both games unchanged or explicitly retry with
`"overrideStarted": true`. Automatic pairing never fills Started tables, even
if a seat was emptied by an override. Normal result reporting remains available
without requiring Start first.
The same endpoint accepts JSON `{ "start": false }` to return an unfinished
game to **Paired**, clearing `startedAt` and unlocking seat edits without changing
players, check-ins, cohorts, or ratings. JSON `{ "start": true }` explicitly
starts play; omitting the body retains the original start behavior. Completed
and cancelled games cannot change between Paired and Playing. Generic resource
updates and MCP `game-start` also accept `start: false`; a later start records a
new timestamp. Existing persisted/API lifecycle codes remain backward-compatible.

`POST /api/games/:id/switch-sides` accepts JSON `{}` (or
`{ "overrideStarted": true }`) and atomically exchanges both seats and check-in
colors. It returns the joined game, preserves `startedAt`, and returns HTTP 409
with `requiresStartedOverride: true` when a Started game needs consent.
Generic HTTP/MCP resource updates expose the same operation as `swapSides: true`,
which cannot be combined with explicit replacement seat IDs. Switching is not
idempotent: each successful request exchanges the colors again, so clients must
not automatically repeat successful switches. The generic MCP update tool is
therefore advertised as non-idempotent.

`DELETE /api/games/:id` deletes an unfinished
game or audit-cancels an eligible finished game and may accept JSON
`{ "reason": "...", "overrideStarted": true }`. The override is required only
for an unfinished Started game. Optional `"unfinishedOnly": true` rejects the
request with HTTP 409 if a result has been recorded, without changing the game
or Elo; the popup uses this guard for immediate cancellation. Generic resource updates support `start` and
`overrideStarted`; MCP `game-start`, `game-seat-update`, `game-cancel`, and
`game-delete` enforce the same rules. Generic resource deletion cannot bypass
Started consent; use an explicit update with `cancel` and `overrideStarted`.
The existing **Move To...** waiting-player workflow, its HTTP endpoint, and
`waiting-player-move` also support explicit `overrideStarted` consent. Unlike
choosing a player through a game card, this dedicated workflow retains its
existing behavior of closing the vacated waiting table.
Explicitly closing a session still resolves all its games through its existing
confirmation workflow. Existing games migrate with no Started timestamp;
they are not automatically locked. Finished cancellation follows the guarded
compensation policy above. The browser loads it immediately,
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
returns record/rank, the player's ongoing games, newest-first non-cancelled
completed games (maximum 50), and full chronological Elo history. Malformed
bounds return 400 and missing players 404.
Game-related history includes the opponent's name, pre-game Elo, signed Elo
change, and the player's win/loss/draw outcome, independent of the Elo delta.
The player card displays reasons such as “Win v Alice 700 -16”, with the
opponent's pre-game Elo in smaller, vertically centered text and their change
colored by gain/loss. These values come from the historical ledger, not the
opponent's current rating. Selecting a game-linked history date or an
ongoing/recent game saves any pending name edit, then replaces the player card
with the standard game-details dialog. `GET /api/games/:id` supplies the full
joined game, including original timestamps, players, rating changes, and
cancellation eligibility, even for older or cancelled games. Missing games
return 404; failed navigation leaves the player card open with an error.
Top-level dashboard tabs use the History API and a `view` query parameter:
`?view=leaderboard`, `?view=recent-games`, or `?view=session-4` for session ID 4.
Clicking or keyboard-selecting a tab adds a history entry; selecting the current
tab does not. Browser Back/Forward restores the corresponding view, and refresh
or a shared URL restores the selected session or Recent Games tab. Existing
query parameters, URL fragments, and history state are preserved. Without a
`view` parameter, the saved dashboard preference supplies the initial view.
Session links wait for session data before validation. Unavailable/closed
sessions and invalid view links return to Leaderboard with a visible explanation.
Creating a session navigates to it; closing it replaces its current URL with
Leaderboard. Navigation does not restart or otherwise change camera state.

The Elo Leaderboard occupies its dashboard tab, with player creation available
from its Add player modal. Rows are native keyboard buttons and open the shared
player card. The ARIA modal
supports focus entry/return, Escape/close/backdrop dismissal, player editing,
guarded deletion, ongoing game cards, and up to ten horizontally scrolling
recent game cards. It also prints a one-inch round player sticker. A
chronological Elo ledger appears below the game cards.
Name edits save on blur or before the modal
closes, and the footer retains a text-only Delete player action.

Player cards, seat assignment, and game cancellation use one shared modal
widget for the backdrop, X close control, Escape handling, focus trap, and
focus restoration. Each table card opens a keyboard-accessible detail dialog
with searchable Black and White player fields; the special Empty option clears
an occupied seat. Player fields and winner/draw actions appear at the top of
the detail dialog. Status and timestamps sit to the left of a compact,
right-aligned table preview, stacking on narrow screens. A Status dropdown
replaces the Start/Cancel links and shows the current status and eligible next
statuses: **Paired**, **Playing**, **Completed**, and **Cancelled**.
Choosing Playing explicitly starts a fully seated unfinished game; choosing
Paired returns a Playing game to its not-started state, removing the lock.
Completed is not a manual transition: it appears only after declaring a winner
or draw, with the recorded outcome displayed separately under Result.
Choosing Cancelled depends on whether a result is recorded: without a result, it
immediately removes the table, including Started tables, with no confirmation.
With a recorded result, it opens the confirmation before eligible Elo compensation.
The immediate request is guarded against a result arriving concurrently; it fails
visibly rather than silently undoing that result. Seat/switch Started-game
override rules remain unchanged. Results still use the
winner/draw controls; Completed and Cancelled games cannot return to Paired or
Playing through this dropdown.
Audit labels and values use matching text sizing and baseline alignment.
The detail dialog closes through its top-right X, Escape, or the backdrop,
without a redundant bottom Close button.
Player search options float below the active field over the dialog content
instead of moving the result controls, timestamps, or table preview.
The larger table dialog remains bounded by the viewport. Its player dropdown
escapes the dialog's scroll clipping, follows its field during scrolling and
resizing, and opens above the field when there is more room there. The list
scrolls within the available screen space, including with a mobile keyboard open.
The full roster includes unchecked players and players at
other live tables. Current table, Started, and check-in context remains available
in hover titles and assistive labels rather than separate visible lines.
For a Club Session table with an opposing player selected, a Suggested section
puts players from that opponent's saved session cohort first. Suggestions do
not duplicate players in Other players, and players assigned to another event
are not suggested. The full eligible roster remains searchable. Each candidate
uses two compact lines: `Player Name 700 (vs. Opponent 2-1-0)` with the rating
smaller and vertically centered, then `Last Played: date` (or `Never`).
The reusable `PlayerMatchupSummary` component renders both dropdown options and
the selected player inside each closed selector. Opening game details loads
matchup metadata for both selected players without requiring a field click.
Focusing a selector switches it to searchable text; Escape, Tab, or moving focus
away restores the selected player's rich summary, discarding no seat assignments.
The small square-loop arrow icon button between the centered player labels/selectors
exchanges the black and white
players in one atomic update (including moving a lone player to the empty color).
It preserves the table, session, check-ins, frozen cohorts, and Started timestamp,
and requires explicit override confirmation on a Started table. Both empty seats
disable the control. Result buttons read **Black Wins**, **Draw**, and **White Wins**.
Beside Last Played, seated candidates show `Playing Opponent · not started` or
`Playing Opponent · started 10 minutes ago`; an empty opposing seat shows the
table number instead. Unseated candidates show their latest completed,
noncancelled result (`Last Result: Lost to Opponent`, `Won against Opponent`,
or `Drew with Opponent`), or `No completed games`. This latest result spans all
opponents and sessions, not just the current matchup. Activity/result context
also appears when the table has no opposing player selected.
The record is all-time wins-losses-draws from
the candidate's perspective against the opposing player.
History includes completed, noncancelled games across all sessions and standalone
play. No prior games means 0W-0L-0D. Empty opposing seats and standalone tables do
not show cohort suggestions. Seat changes refresh opponent-specific context.
Current/opposing occupants and unknown player identities cannot be selected.
An authoritatively decoded piece uses the same manual seat-assignment flow.
Ordinary selections apply immediately; modifications affecting a Started table
require the explicit override prompt before either table changes.
To manually pair during check-in, check in player A normally. Clicking **Check in**
in club or session standings automatically opens their assigned table popup
after successful check-in (including waiting or already-checked-in responses).
This uses the same editable popup as the table links; failed check-ins do not
open a table. The separate Add Player to Session picker and scanner check-in
flows keep their existing behavior. In the table popup,
choose player B for the other seat from the full list. Player B is checked
in automatically if needed. Once the organizer is satisfied with both seats,
choose **Playing** in the Status dropdown. Server-provided finished-game deltas use signed, tabular,
positive/negative/neutral styling. Cancelled cards retain the subdued original
result and cancellation time, omit deltas and management controls, and remain
available as audit records in Recent Games.

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
mention, for example `@sunset-chess-1-4 show me current games` or
`@sunset-chess-1-4 add Elliot as a new player`. The managed container must already
be running and healthy, and its current ContainerClaim must advertise the MCP
endpoint. Read tools run directly; create, update, and delete tools require
confirmation in chat.

```sh
curl --fail http://localhost:4176/health
```

## Pull request reviews

The repository's active [protect-main ruleset](https://github.com/mkubarycz/sunset-chess/rules/25726646)
matches Working Memory's default-branch policy. GitHub Copilot automatically
reviews non-draft pull requests targeting the default branch and reviews again
on subsequent pushes; draft pull requests are excluded.

Changes must go through a pull request, all review threads must be resolved
before merging, and force pushes and branch deletion are blocked. The policy
does not require a human approval count. Review findings should be examined and
addressed before merging; automatic review does not merge a pull request.

This is a GitHub repository setting, not a local agent or Actions workflow.
Checking out this repository does not install the policy in another repository.

## Container

```sh
npm run deploy:docker
```

The Compose definition applies the same ownership labels, port mapping, and
named volume expected by the Working Memory desktop launcher. Use this command
instead of a manual `docker run`; an unlabeled container is intentionally
rejected by the launcher. Container recreation and restart preserve the
database. This branch deploys **Sunset Chess 1.4** using image `sunset-chess:1.4`,
container `working-memory-sunset-chess-1-4`, claim and Compose project
`sunset-chess-1-4`, host port 4176 (container port 4175), and named volume
`working-memory-sunset-chess-1-4-data`. Open <http://localhost:4176>;
its MCP endpoint is <http://localhost:4176/mcp>.
The volume is external: it must be created/seeded before the first deployment,
and Compose will neither silently create an empty database volume nor delete it
with `down --volumes`.

The original **Sunset Chess** remains on port 4175 with claim `sunset-chess`,
container `working-memory-sunset-chess`, and volume
`working-memory-sunset-chess-data`. Do not redeploy, stop, migrate, or delete
that environment during the preservation period. Its retirement is a separate,
explicitly approved operation after the week of October 18, 2026; nothing in
this deployment schedules deletion.

The 1.4 volume was seeded before testing using SQLite's online backup API,
with the original volume mounted read-only in a temporary helper container.
The backup passed `PRAGMA integrity_check` and all seven application/migration
tables had matching row counts. Never copy a live SQLite file directly (it may
have WAL state), mount the original volume writable, or overwrite an existing
1.4 database when deploying. After cloning, both environments are independent:
changes in one are not synchronized to the other.

To reset only the 1.4 environment,
stop/remove the container and explicitly remove the volume yourself; the
application never deletes the volume automatically.

### Back up before development

```sh
npm run backup:database
```

Requires Docker, the running 1.4 container, and Node 22.13+ with the repository's
installed dependencies. The command checks the container's volume and port,
then uses SQLite's online backup API with a read-only source connection. It
saves a snapshot to a unique private directory under
`~/Documents/SunsetChess-backups/`, outside the repository and Docker volume.
The downloaded copy must pass integrity and foreign-key checks before a
`manifest.json` is written with its SHA-256, all table row counts, timestamp,
and source container/image/volume identity. Failures exit nonzero; an incomplete
backup without a manifest is not verified. No backups are automatically pruned.
The temporary container snapshot is removed; the host backup is retained.
The app does not need to stop, and the original Sunset Chess is never touched.
This helper currently supports only the documented 1.4 deployment; it is not
the repository's permanent target selection policy. If the confirmed instance
changes, update and validate the backup tooling for that instance before use.

### Agent session defaults

[Repository instructions](.github/copilot-instructions.md) tell new Copilot
sessions to discover targets from the current branch's deployment configuration
and running environment, confirm the selected instance once, take a verified
backup before development, and deploy validated app changes to that instance
unless the user requests otherwise. No version, port, or container is a
permanent preference. A target explicitly named in the request counts as
confirmation, subject to verification. Backup and deployment tooling must match
the selected target; target-specific helpers must be adapted and validated
when the deployment changes. Documentation-only changes do not need deployment.
`npm run deploy:docker` waits up to 120 seconds for container health; agents
must also verify `/health` and the changed behavior on the live URL.

These always-on instructions are the right default for this repository-wide
workflow; no separate agent or manually invoked skill is required. They guide
agent behavior rather than enforce it as a hook. Commit and merge the
instructions and scripts into the branch used for new sessions so future
worktrees inherit them. They do not configure sessions using older branches.

To restore, stop only `working-memory-sunset-chess-1-4` first. Preserve its
current database and any `-wal`/`-shm` sidecars in a separate recovery directory.
Using a helper container mounting only `working-memory-sunset-chess-1-4-data`,
replace `/data/sunset-chess.sqlite` with the verified snapshot and ensure no old
sidecars remain at the database path. Transfer the snapshot and its manifest
with `docker cp` if Docker cannot bind-mount the host backup directory. Verify
the manifest hash, integrity, and foreign keys before replacing the database.
Restart the current application so its pending schema migrations run, and verify
`/health`, players, sessions, and results. Never restore over a running SQLite
database or touch the original Sunset Chess environment.
