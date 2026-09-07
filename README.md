# The Little Boat — v0.1.1

A tiny cooperative browser game: two players share one boat and each controls one oar. This release improves rowing feedback and handling across the same three handcrafted levels.

## Run

Use Node.js 22.12 or newer. No frontend build step is needed.

```bash
npm install
npm run dev
# or: npm start
```

Open two tabs at `http://localhost:3000`, enter nicknames, and press **Space** or **Enter** to row. Holding a key does not repeat strokes. The server enforces each oar's cooldown.

For two computers on a LAN, open `http://<server-LAN-IP>:3000` on both and allow incoming traffic to that port. Internet hosting must support WebSocket forwarding. Pairing is public and automatic.

Copy `.env.example` to `.env` for optional configuration:

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP and WebSocket port; default `3000`. |
| `MONGODB_URI` | Optional completed-run storage. Leave empty to play without MongoDB. |

MongoDB is used only after Level 3. Connection/write failures disable persistence while gameplay continues.

## What's changed

- Accepted strokes produce a stronger oar sweep, a water splash, and small visual hull rocking.
- The orange left and blue right HUD oars show each partner's cadence. A synchronized pair pulses both, briefly shows **PERFECT ROW**, and makes slightly larger splashes on both sides.
- Oar animation and cooldown feedback use server confirmation. Rejected strokes have no visual or audio response. Feedback clears on countdown, disconnect, replacement, and level reset.
- A bounded pool of fading foam marks stays behind the stern, making speed, momentum, and turns visible.
- The fixed camera interpolates a short snapshot history and uses frame-rate-independent following, with a small velocity-based look ahead. It never rotates with the boat.
- Banks retain motion along the shore and gently turn the bow inward. Rock contacts reduce momentum on entry without repeatedly multiplying away sliding speed.
- Collision counting tracks each obstacle contact, with a small separation tolerance to prevent contact jitter. A new impact counts after separation, without a global collision cooldown.
- Sustained unsuccessful rowing against an obstacle can receive a small velocity/turn nudge. Ordinary movement and idle contact do not trigger recovery; it never teleports the boat.
- Brief control reminders appear before gameplay on each level. Every level shows time, bumps, total strokes, synchronized pairs, and sync percentage, with a 5.5-second pause to read them. The final screen shows Level 3 alongside whole-run totals. Checkpoints use a small notice that leaves the boat visible.
- Web Audio synthesizes splashes, sync notes, bumps, checkpoints, and completion sounds. **Mute sound** is available in the corner. Audio starts after a user gesture; unsupported audio leaves the game fully playable. No audio assets or dependencies were added.

## Physics tuning

Gameplay values are centralized in `server/constants.js`. Visual and audio tuning lives separately in `public/js/presentation.js` and cannot change simulation rules.

| Constant | v0.1.0 | v0.1.1 |
| --- | ---: | ---: |
| `strokeImpulse` | 0.65 | 0.8 |
| `turnImpulse` | 0.65 | 0.52 |
| `drag` | 0.95 | 0.968 |
| `angularDrag` | 0.94 | 0.91 |
| `maxSpeed` | 7.3 | 6.5 |
| `maxAngularSpeed` | 3.4 | 2.2 |
| `rowCooldownMs` | 520 | 560 |
| `syncWindowMs` | 210 | 220 |
| `syncForwardBonus` | 1.2 | 1.25 |
| `bankBounce` | 0.45 | 0.08 |
| `rockBounce` | 0.58 | 0.22 |
| `levelAdvanceDelayMs` | 3300 | 5500 |

The larger stroke and gentler linear drag provide a longer glide. Lower turning impulse, stronger angular damping, and lower speed caps reduce twitchiness. A synchronized pair receives 25% more combined forward impulse. The second stroke applies the pair's bonus once and consumes the pending pair. The synchronization window includes its exact boundary; cooldown accepts a stroke at its exact boundary.

Drag is a multiplier per 30 Hz tick, adjusted by elapsed simulation time. Unchanged values include `tickRate=30`, `broadcastRate=18` (effectively about 15 Hz when sampled on ticks), `boatRadius=0.92`, and `currentScale=1.7`. Downstream is +Z; screen-right is -X in the fixed camera. Left strokes rotate clockwise toward screen-right.

Additional centralized collision values:

| Constant | Value / meaning |
| --- | --- |
| `bankFriction` | 0.7; tangential damping per second while pushing into shore |
| `bankSteer` | 0.8; gentle inward steering rate |
| `rockTangentRetention` | 0.82; momentum retention on contact entry |
| `rockTurnImpulse` | 0.12; limited impact rotation |
| `collisionIterations` | 8 alternating rock/bank constraint passes |
| `contactReleaseDistance` | 0.12 world units; contact separation tolerance |
| `recoveryDelayMs` | 1800 ms of unsuccessful rowing contact |
| `recoveryMovement` | 0.22 world units; displacement that resets recovery tracking |
| `recoveryRowRecencyMs` | 900 ms; rowing must still be active |
| `recoveryProbeDistance` | 0.65 world units |
| `recoveryDirections` / `recoveryGeometryWeight` | 16 probes / 100 penalty weight for blocked geometry |
| `recoveryImpulse` / `recoveryTurnImpulse` | 0.65 / 0.3; velocity and turn nudges |

## Statistics

The server records `leftStrokes`, `rightStrokes`, `strokes` (their sum), `synchronizedStrokes` (pairs), `collisions`, and playing time separately for the current level and the whole run.

```text
syncPercentage = round(100 × 2 × synchronizedStrokes / strokes)
```

With zero strokes the result is 0%. Thus one synchronized pair among three accepted strokes gives 67%; fully paired rowing gives 100%. Each stroke belongs to at most one pair. Countdown/transition time is excluded. Loading the next level clears its counters, contact history, recovery tracking, and oar cooldowns while preserving run totals and completed level summaries. A restart or replacement partner starts a fresh run.

These numbers are informational: there are no grades, rewards, rankings, or progression additions.

## Architecture and protocol

The existing single-process architecture is preserved:

- Express serves `public/`, `/health`, `/api/levels`, and Three.js.
- `server/server.js` runs one global tick; `game-server.js` pairs players and updates rooms.
- `room.js` owns seats, lifecycle, accepted-input broadcasts, and persistence.
- `simulation.js` owns rowing acceptance, physics, synchronization, contacts, recovery, checkpoints, timers, and statistics.
- The browser owns animation, wake, rocking, camera, HUD effects, and audio.

Clients still send only intent:

```json
{ "type": "join", "name": "Rower" }
{ "type": "row" }
{ "type": "restart" }
```

The first player receives the left seat, the second the right; later players enter another room. Seat and synchronization fields supplied by clients are ignored. Invalid/unknown messages cannot mutate simulation. Disconnect stops the run; a replacement takes the vacant seat and starts a new Level 1. Silent lost connections are removed after about 30 seconds. There is no session reconnection.

Server message types remain `joined`, `waiting`, `countdown`, `state`, `stroke`, `checkpoint`, `level-complete`, `game-complete`, `opponent-disconnected`, and `error`, with one addition: `collision`.

The existing transient stroke event is unchanged:

```json
{ "type": "stroke", "side": "right", "synchronized": true, "at": 1788790000000 }
```

Only accepted strokes emit it. The first stroke in a pair has `synchronized: false`; the second confirms the pair. Clients pulse both indicators and splash both sides without replaying the first oar animation.

New contact-entry event:

```json
{ "type": "collision", "kind": "rock", "normalX": 0, "normalZ": -1, "strength": 0.4 }
```

`kind` is `rock` or `bank`, the unit normal points away from the obstacle, and `strength` is in [0, 1]. Events drive transient rocking and audio; sustained contact does not repeat them.

State additions:

- Existing top-level stroke/collision totals remain **run totals**; `leftStrokes`, `rightStrokes`, and `syncPercentage` are added.
- `levelStats` contains all current-level counters, `syncPercentage`, and `timeMs`.
- `oars.left.cooldownRemainingMs` and `oars.right.cooldownRemainingMs` let clients reconcile cooldown feedback from server state.

`level-complete` now reports the completed level's counters (previously cumulative), including side totals and sync percentage. It is emitted for all three levels. `nextStartsAt` is null on the final level. `game-complete` contains run totals, `totalTimeMs`, `levelTimes`, and `levelSummaries`; persistence receives the same completed-run data.

## Testing

```bash
npm test
```

The suite covers cooldowns and exact sync boundaries in both side orders, single-use bonuses, accepted/rejected stroke statistics, contacts and re-entry, bank sliding, rock/bank constraints, conservative recovery, level resets, accumulated run totals, protocol validity, seat spoofing, snapshot interpolation, progression, disconnects, and persistence failure handling.

If test worker creation is blocked in a sandbox, use:

```bash
node --test --experimental-test-isolation=none
```

No lint command is configured.

### Two-client checks

1. Join two tabs or side-by-side windows; confirm left/right seats and control reminders.
2. Row each side separately. Only the accepted side's oar/indicator should move; fast repeated presses must not restart the animation.
3. Row together within 220 ms. Confirm both HUD pulses, **PERFECT ROW**, larger splashes, and a soft sync tone.
4. Coast and turn. The wake stays behind in the water; rocking remains small; the camera stays fixed in orientation with river visible ahead.
5. Scrape a bank and hit rocks. The boat should lose some momentum, slide/redirect, and remain steerable. Sustained contact counts once; leave and re-enter to count again.
6. Try a head-on awkward contact while rowing. Recovery should occur only after sustained lack of progress, as a small nudge.
7. Finish each level. Check all five statistics and their reset on the next level. The final screen compares Level 3 with the whole run.
8. Check row, sync, bank, rock, checkpoint, and finish sounds; mute/unmute and test without Web Audio.
9. Disconnect during a stroke. Oars and HUD pulses reset; a replacement gets the vacant seat and fresh stats.
10. Restart after completion and verify the countdown, instructions, and fresh level state.

### Verification limits

v0.1.1 verification: **59 automated tests pass** with `npm test`; JavaScript syntax and diff whitespace checks pass. Two actual headless Chromium pages passed rowing, rejected-input feedback, synchronization, wake, rocking, bank sliding/contact counts, collision sounds, checkpoint/completion sounds, mute, all level summaries/transitions, disconnect/replacement resets, and no-audio fallback with no page errors. Desktop and compact screenshots were visually inspected. `npm start`, the homepage, `/health`, and all three level definitions were verified.

Automated simulation tests cover all three levels and difficult collision fixtures. Browser verification uses actual Chromium clients and keyboard input; difficult collisions and finishes can be positioned with server-side fixtures in the test process. This is not a complete two-human course playthrough. Subjective rowing feel, course completion times, and sound pleasantness still benefit from a two-person session. Live MongoDB writes are not part of local verification.

## Files

```text
server/
  server.js / game-server.js / room.js
  simulation.js / constants.js / geometry.js
  levels.js / protocol.js / db.js
public/
  index.html / css/game.css
  js/
    app.js / network.js / renderer.js / presentation.js
    boat-view.js / world-view.js / water-effects.js / audio.js
    components/
      little-boat-game.js / game-lobby.js / game-hud.js
test/
  simulation.test.js / polish.test.js
  room.test.js / progression.test.js / db.test.js
```

