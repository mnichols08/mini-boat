# The Little Boat - v0.1.2

A tiny cooperative browser game: two players share one boat and each controls one oar. v0.1.2 keeps the v0.1.1 rowing feel and adds clearer two-player communication, readiness, pause/restart voting, and short reconnect recovery.

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

| Variable      | Purpose                                                              |
| ------------- | -------------------------------------------------------------------- |
| `PORT`        | HTTP and WebSocket port; default `3000`.                             |
| `MONGODB_URI` | Optional completed-run storage. Leave empty to play without MongoDB. |

MongoDB is used only after Level 3. Connection/write failures disable persistence while gameplay continues.

## Controls

| Control           | Action                                       |
| ----------------- | -------------------------------------------- |
| `Space` / `Enter` | Row your assigned oar.                       |
| `1`               | Ping `ROW!`.                                 |
| `2`               | Ping `LEFT!`.                                |
| `3`               | Ping `RIGHT!`.                               |
| `4`               | Ping `WAIT!`.                                |
| `5`               | Ping `NICE!`.                                |
| `P`               | Request a cooperative pause.                 |
| `R`               | Request a cooperative current-level restart. |

The HUD also includes clickable ping, pause, restart, ready, resume, and row-again controls so the co-op flow does not rely only on keyboard shortcuts.

## What's changed in v0.1.2

- Players can send predefined pings only: `ROW!`, `LEFT!`, `RIGHT!`, `WAIT!`, and `NICE!`.
- Pings are server-validated, rate-limited per player, broadcast to both clients, shown above the sender's seat, and mirrored in the HUD.
- Seat ownership is explicit in text: `YOU CONTROL <- LEFT OAR` or `YOU CONTROL RIGHT OAR ->`, with the matching HUD and boat oar subtly highlighted.
- Countdown copy includes both player roles before the boat starts moving.
- Level completion no longer auto-launches the next level. Both players must mark ready after reading the existing stats.
- The final run screen uses the same cooperative ready flow for replay: both players must choose row again.
- Restarting the current level requires a request and partner acceptance. Decline or timeout cancels the vote while gameplay continues.
- Pausing also requires partner acceptance. While paused, physics, timers, rowing, currents, checkpoints, and collisions stop. Both players must mark resume-ready, then a countdown restarts play.
- Brief disconnects preserve the room and pause gameplay. The same browser session can reclaim its seat during the reconnect grace period.
- If reconnect expires, the abandoned run closes and the remaining player can find another rower for a fresh run.
- Level completion triggers a short cosmetic shared-boat celebration rock before the ready flow continues.
- Web Audio adds small cues for pings, partner joined/reconnected/disconnected, ready/resume, pause, and the existing row/collision/checkpoint/completion events. The mute control still governs all synthesized sounds.

## Multiplayer lifecycle

`room.js` owns the multiplayer lifecycle. The active room states are:

```text
waiting -> countdown -> playing -> level-complete -> countdown
playing -> game-complete -> countdown
playing -> paused -> countdown
playing/countdown/paused/level-complete/game-complete -> reconnecting -> countdown or closed
```

Restart and pause requests are represented as bounded votes while the room remains in `playing`, so the boat keeps moving until a vote is accepted. The server owns readiness, votes, reconnect deadlines, seat identity, accepted pings, countdown start, and simulation pause/resume. The client owns only UI, animation, audio, and transient visual feedback.

## Protocol additions

Client messages remain intent-only. Clients cannot choose seats, spoof player IDs, or send arbitrary ping text.

```json
{ "type": "join", "name": "Rower", "session": "temporary-browser-session" }
{ "type": "row" }
{ "type": "ping", "ping": "left" }
{ "type": "ready" }
{ "type": "restart-request" }
{ "type": "restart-response", "voteId": "...", "accept": true }
{ "type": "pause-request" }
{ "type": "pause-response", "voteId": "...", "accept": true }
{ "type": "resume-ready" }
{ "type": "find-partner" }
```

New or extended server messages include `ping`, `player-disconnected`, `player-reconnected`, `reconnect-expired`, and `vote-result`. Regular `state` messages include `roomStatus`, `ready`, `vote`, `countdownEndsAt`, `countdownReason`, `celebrationEndsAt`, connected/disconnected player summaries, current level stats, and run summaries when complete.

The shared allowlist and message names live in `public/shared/protocol.mjs`; `server/protocol.js` wraps that shared module with parser/serializer helpers.

## Configuration

Gameplay physics remain centralized in `server/constants.js`. v0.1.2 adds these multiplayer timing constants:

| Constant                                     | Meaning                                                                            |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `pingCooldownMs`                             | Per-player ping rate limit.                                                        |
| `pingLifetimeMs`                             | Ping bubble display duration.                                                      |
| `reconnectGraceMs`                           | Time a disconnected seat is reserved.                                              |
| `restartVoteTimeoutMs`                       | Restart vote expiry.                                                               |
| `pauseRequestTimeoutMs`                      | Pause vote expiry.                                                                 |
| `requestCooldownMs`                          | Cooldown between pause/restart requests from the same player.                      |
| `celebrationMs`                              | Cosmetic level-complete celebration duration.                                      |
| `heartbeatIntervalMs` / `heartbeatTimeoutMs` | WebSocket liveness checks.                                                         |
| `countdownMs`                                | Countdown before initial play, next level, replay, restart, reconnect, and resume. |

Visual/audio tuning remains in `public/js/presentation.js` and cannot alter authoritative simulation.

## Statistics

The v0.1.1 statistics remain unchanged. The server records `leftStrokes`, `rightStrokes`, `strokes`, `synchronizedStrokes`, `collisions`, and playing time for the current level and full run.

```text
syncPercentage = round(100 * 2 * synchronizedStrokes / strokes)
```

Countdown, ready, pause, reconnect, and level-complete waiting time do not advance the simulation timer.

## Testing

```bash
npm test
```

The suite covers rowing, synchronization, collision contact counting, anti-stuck recovery, statistics, progression, persistence fallback, pings, readiness, cooperative replay, restart votes, pause/resume, reconnect identity, reconnect expiry, stale socket cleanup, and invalid state/input handling.

No lint command is configured.

## Manual checks

1. Join two tabs; confirm each player sees their own oar in text and highlight.
2. Send pings with number keys and buttons; confirm sender identity, display lifetime, and spam limiting.
3. Complete a level; confirm stats remain visible and one ready player cannot launch the next level.
4. Mark both players ready; confirm countdown and unchanged rowing physics.
5. Request restart; decline once, then accept once. Confirm only the current level resets.
6. Request pause; accept, verify the timer stops and rowing is ignored, then resume with both players ready.
7. Close one tab during gameplay; confirm the other sees reconnect waiting and the timer freezes.
8. Reopen/reload the same browser session during the grace period; confirm the seat is restored and play resumes after countdown.
9. Let reconnect expire; confirm the remaining player can find another rower for a fresh run.
10. Finish the run; confirm row-again requires both players.

## Scope

v0.1.2 deliberately does not add free-form chat, private rooms, accounts, persistent reconnect after server restart, spectators, AI rowers, new levels, new hazards, progression systems, leaderboards, or cosmetics. The goal is clearer co-op, not more content.
