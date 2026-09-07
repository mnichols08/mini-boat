# The Little Boat

The Little Boat is a tiny two-player cooperative browser game. Two online players share one rowboat: the first player controls the left oar, the second player controls the right oar, and steering emerges from the timing of their strokes.

## Run

Use Node.js 22.12 or newer. No frontend build step is needed.

```bash
npm install
npm run dev
```

For a normal server run:

```bash
npm start
```

Open two browser tabs at `http://localhost:3000`, enter nicknames, and press **Space** or **Enter** to row.

## Environment

Copy `.env.example` to `.env` if you want local environment values; the server loads it at startup. Leave `MONGODB_URI` empty to run without persistence.

| Variable      | Purpose                                                           |
| ------------- | ----------------------------------------------------------------- |
| `PORT`        | HTTP and WebSocket server port. Defaults to `3000`.               |
| `MONGODB_URI` | Optional MongoDB connection string for completed-run persistence. |

MongoDB is only used after Level 3 is completed. If MongoDB is missing or unreachable, the server logs the failure and the game remains playable.

## Architecture

One Node.js process runs everything:

- Express serves `public/`, `/health`, `/api/levels`, and the Three.js module from `node_modules`.
- `ws` accepts browser WebSocket connections on the same HTTP server.
- `server/server.js` owns the single global 30 Hz tick; `server/game-server.js` owns pairing and updates all rooms.
- `server/room.js` owns room state, seats, countdowns, rowing requests, progression, disconnects, and completed-run storage.
- `server/simulation.js` owns the authoritative boat state, collisions, currents, checkpoints, timers, and finish checks.
- The browser sends only intent (`join`, `row`, `restart`) and renders authoritative state with interpolation.

## Controls

Each player has one control:

- **Space** = row
- **Enter** = row

Holding the key does not create extra strokes because repeated keydown events are ignored client-side and each oar cooldown is enforced server-side.

## Room Pairing

Rooms hold exactly two players.

1. The first joined player receives the left oar.
2. The second joined player receives the right oar.
3. A third player is placed into another waiting room.
4. If one player disconnects during play, simulation stops and the remaining player waits for another rower.

Clients cannot choose seats; the server assigns seats from connection order.

## Boat Physics

The boat simulation is a small custom 2D model on the X/Z plane. The state contains position, rotation, linear velocity, and angular velocity.

Important constants are centralized in `server/constants.js`:

| Constant           |    Value |
| ------------------ | -------: |
| `tickRate`         |  `30` Hz |
| `broadcastRate`    |  `18` Hz |
| `rowCooldownMs`    | `520` ms |
| `syncWindowMs`     | `210` ms |
| `strokeImpulse`    |    `0.65` |
| `syncForwardBonus` |    `1.2` |
| `turnImpulse`      |   `0.65` |
| `drag`             |  `0.95` |
| `angularDrag`      |   `0.94` |
| `maxSpeed`         |    `7.3` |
| `maxAngularSpeed`  |    `3.4` |
| `boatRadius`       |   `0.92` |
| `currentScale`     |    `1.7` |
| `bankBounce`       |   `0.45` |
| `rockBounce`       |   `0.58` |

Drag values are multipliers per 30 Hz tick. State broadcasts target 18 Hz and occur on simulation ticks (approximately 15 Hz). Positive heading turns clockwise as seen from behind the boat; downstream is +Z and screen-right is -X.

Left strokes add forward impulse and clockwise rotation. Right strokes add forward impulse and counterclockwise rotation. If both oars stroke within the synchronization window, the second stroke adds the bonus for both strokes (20% combined efficiency) and the opposing angular impulse mostly cancels rotation.

## Levels

There are exactly three handcrafted levels in `server/levels.js`:

- Level 1, **First Row**: broad forgiving river, one checkpoint, no rocks, no currents.
- Level 2, **Rocky Bend**: steering practice with rocks, wider bends, and three checkpoints.
- Level 3, **Going With the Flow**: rocks, bends, currents, and four checkpoints.

Level data is served to the browser through `/api/levels` for rendering. Server collision never depends on Three.js meshes.

## WebSocket Protocol

Client to server:

```json
{ "type": "join", "name": "Michael" }
```

```json
{ "type": "row" }
```

```json
{ "type": "restart" }
```

Server to client message types:

- `joined`: room id, player id, assigned seat, player summary, tunable constants.
- `waiting`: one player is waiting for a partner.
- `countdown`: match countdown or `ROW!` signal.
- `state`: authoritative level, boat, checkpoint, timer, collision, and stroke state.
- `stroke`: accepted stroke side and whether it synchronized.
- `checkpoint`: checkpoint progress event.
- `level-complete`: level time and next-level transition.
- `game-complete`: total time, level times, bumps, and synchronized stroke count.
- `opponent-disconnected`: active partner left; simulation is stopped.
- `error`: invalid or unsupported message.

Example state:

```json
{
  "type": "state",
  "roomStatus": "playing",
  "level": "level-2",
  "levelName": "Rocky Bend",
  "boat": {
    "x": 14.3,
    "z": 6.8,
    "rotation": 1.21,
    "velocityX": 2.1,
    "velocityZ": 0.8,
    "angularVelocity": 0.3
  },
  "checkpoint": { "current": 2, "total": 3 },
  "elapsedMs": 68120
}
```

## Testing

Run automated tests:

```bash
npm test
```

The tests cover rowing impulses, synchronization, cooldowns, drag, speed caps, collisions, currents, checkpoint order, finish gating, level progression, room pairing, disconnects, cleanup, invalid messages, nickname validation, and server-owned seats.

## Manual Two-Tab Test

1. Start the server with `npm run dev` or `npm start`.
2. Open `http://localhost:3000` in Tab A and join as one nickname.
3. Open the same URL in Tab B and join as another nickname.
4. Confirm Tab A receives LEFT and Tab B receives RIGHT.
5. Press Space only in Tab A and confirm the boat turns right.
6. Press Space only in Tab B and confirm the boat turns left.
7. Press Space in both tabs close together and confirm the boat moves mostly forward with a `PERFECT ROW` cue.
8. Reach each checkpoint in order and then the dock.
9. Confirm Level 2 and Level 3 start automatically.
10. Complete Level 3 and confirm the final run screen appears.
11. During another run, close one tab and confirm the remaining tab reports that the partner disconnected.

Use separate windows side by side for easier focus switching. For two people on separate computers, both open `http://<server-computer-LAN-IP>:3000` on the same network with the server port reachable. Pairing is automatic, so use an otherwise empty server when testing together. A replacement rower occupies the vacant seat and starts a fresh Level 1 run. A silently lost connection is removed after about 30 seconds.

## Verification performed

- `npm test`: 32 tests passed, including all three level transitions, timer pauses, persistence invocation, restart, invalid input, replacement seats, and MongoDB failure handling.
- Two actual headless Chromium pages: nickname entry, left/right seats, countdown, Space/Enter rowing, opposite turning, synchronized forward movement, and disconnect display passed with no page errors.
- `/health` returned `{ "status": "ok", "service": "little-boat" }`.
- Browser screenshots were visually inspected for oar alignment and the fixed camera.
- Full three-level progression was exercised with simulation fixtures, not a complete human keyboard playthrough. A two-human session is still needed to judge fun and tune course completion times. A live MongoDB write was not verified; failure paths and completed-run delivery were tested.

## Project structure

```text
mini-boat/
├── package.json / package-lock.json
├── .env.example / .gitignore
├── README.md
├── server/
│   ├── server.js / game-server.js / room.js
│   ├── simulation.js / constants.js / geometry.js
│   └── levels.js / protocol.js / db.js
├── public/
│   ├── index.html
│   ├── css/game.css
│   └── js/
│       ├── app.js / network.js / renderer.js
│       ├── boat-view.js / world-view.js
│       └── components/
│           ├── little-boat-game.js
│           ├── game-lobby.js
│           └── game-hud.js
└── test/
    ├── simulation.test.js / room.test.js
    └── progression.test.js / db.test.js
```

## Known Limitations

- There is no reconnection support.
- There are no private room codes, accounts, or leaderboards.
- Rendering is intentionally primitive and uses generated geometry only.
- The camera follows the course generally forward and does not expose user camera controls.
- Persistence stores completed runs only and logs a warning before disabling itself when MongoDB is unavailable.

## Deferred v0.2.0 Ideas

- Private invite codes.
- Better mobile controls.
- More expressive sound using Web Audio.
- Richer row and collision animation.
- Optional cosmetics that do not affect play.
- More level tuning after observing real two-player sessions.

## Project structure

```text
server/
  server.js          Express, assets, WebSocket transport, global tick
  game-server.js     Pairing and cleanup
  room.js            Seats, lifecycle, progression
  simulation.js      Pure boat simulation
  constants.js       Gameplay tuning
  geometry.js        Collision helpers
  levels.js          Three handcrafted courses
  protocol.js        Message types and parsing
  db.js              Completed-run storage
public/
  index.html
  css/game.css
  js/{app,network,renderer,boat-view,world-view}.js
  js/components/{little-boat-game,game-lobby,game-hud}.js
test/
  simulation.test.js
  room.test.js
```

## Verification notes

29 automated tests passed. In environments that block test worker processes,
use `node --test --experimental-test-isolation=none` (Node 22+).
A headless Chromium session with two pages verified joining, seat ownership,
both turning directions, synchronized rowing, literal nickname markup, and
disconnect handling without browser errors. `/health` returns OK.
Progression through all three levels and persistence handoff were tested with
simulation fixtures. A full human course playthrough and a live MongoDB write
remain unverified. Completion-time targets and subjective game feel need human
playtesting.

Use Node 22.12 or later. The server reads an optional `.env` file.
For two computers on a LAN, open `http://<server-LAN-IP>:3000` on both computers
and allow inbound traffic to that port. Internet play requires hosting the Node
server with WebSocket forwarding. Pairing is public and automatic.
A replacement partner starts a fresh run.

Broadcasts are effectively 15 Hz because the 18 Hz target is sampled by the
30 Hz simulation loop. Drag factors are applied per tick. Synchronized stroke
percentage counts both strokes in each synchronized pair.

