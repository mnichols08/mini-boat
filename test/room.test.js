const assert = require("node:assert/strict");
const test = require("node:test");
const { GameServer } = require("../server/game-server");
const { Room, sanitizeNickname } = require("../server/room");

class FakeSocket {
  constructor() {
    this.readyState = 1;
    this.handlers = new Map();
    this.sent = [];
  }

  on(type, handler) {
    const handlers = this.handlers.get(type) || [];
    handlers.push(handler);
    this.handlers.set(type, handlers);
  }

  send(raw) {
    this.sent.push(JSON.parse(raw));
  }

  emit(type, payload) {
    const handlers = this.handlers.get(type) || [];
    for (const handler of handlers) {
      handler(payload);
    }
  }
}

test("first and second players receive left and right seats", () => {
  const room = new Room({ id: "test-room" });
  const first = new FakeSocket();
  const second = new FakeSocket();

  room.addPlayer(first, "Michael");
  room.addPlayer(second, "Jordan");

  assert.equal(room.players[0].seat, "left");
  assert.equal(room.players[1].seat, "right");
  assert.equal(
    first.sent.find((message) => message.type === "joined").seat,
    "left",
  );
  assert.equal(
    second.sent.find((message) => message.type === "joined").seat,
    "right",
  );
});

test("third player goes to another room", () => {
  const server = new GameServer();
  const sockets = [new FakeSocket(), new FakeSocket(), new FakeSocket()];
  for (const socket of sockets) {
    server.handleConnection(socket);
  }

  sockets[0].emit("message", JSON.stringify({ type: "join", name: "A" }));
  sockets[1].emit("message", JSON.stringify({ type: "join", name: "B" }));
  sockets[2].emit("message", JSON.stringify({ type: "join", name: "C" }));

  assert.equal(server.rooms.size, 2);
});

test("disconnect stops active run and empty rooms are cleaned up", () => {
  const server = new GameServer();
  const first = new FakeSocket();
  const second = new FakeSocket();
  server.handleConnection(first);
  server.handleConnection(second);
  first.emit("message", JSON.stringify({ type: "join", name: "A" }));
  second.emit("message", JSON.stringify({ type: "join", name: "B" }));
  const room = [...server.rooms.values()][0];
  room.status = "playing";

  second.emit("close");

  assert.equal(room.status, "waiting");
  assert.ok(
    first.sent.some((message) => message.type === "opponent-disconnected"),
  );

  first.emit("close");
  assert.equal(server.rooms.size, 0);
});

test("invalid messages and unknown row requests do not crash", () => {
  const room = new Room({ id: "test-room" });
  const known = new FakeSocket();
  const unknown = new FakeSocket();
  room.addPlayer(known, "A");

  assert.doesNotThrow(() => room.handleRawMessage(known, "{nope"));
  assert.doesNotThrow(() => room.handleMessage(unknown, { type: "row" }));
  assert.ok(known.sent.some((message) => message.type === "error"));
});

test("nickname length is validated and clients cannot choose seats", () => {
  const room = new Room({ id: "test-room" });
  const first = new FakeSocket();
  room.addPlayer(first, "A very very very long river captain name");

  assert.equal(
    sanitizeNickname("A very very very long river captain name").length,
    18,
  );
  assert.equal(room.players[0].seat, "left");
  room.handleMessage(first, { type: "join", side: "right", name: "Sneaky" });
  assert.equal(room.players[0].seat, "left");
});

test("three-level progression pauses timers, saves once, and restarts cleanly", () => {
 let now=0; const runs=[];
 const room=new Room({id:'progression',now:()=>now,runStore:{saveRun:run=>runs.push(run)}});
 room.addPlayer(new FakeSocket(),'A'); room.addPlayer(new FakeSocket(),'B');
 now=4000; room.update(1/30);
 for(let level=0;level<3;level++) {
   for(const gate of room.simulation.level.checkpoints) {
     Object.assign(room.simulation.boat,{x:gate.x,z:gate.z}); room.update(1/30);
   }
   Object.assign(room.simulation.boat,{x:room.simulation.level.finish.x,z:room.simulation.level.finish.z}); room.update(1/30);
   const elapsed=room.simulation.totalElapsedMs;
   room.update(1/30); assert.equal(room.simulation.totalElapsedMs,elapsed);
   if(level<2) { now+=4000; room.update(1/30); assert.equal(room.simulation.levelIndex,level+1); }
 }
 assert.equal(room.status,'finished'); assert.equal(runs.length,1); assert.equal(runs[0].levelTimes.length,3);
 room.restart(); assert.equal(room.status,'countdown'); assert.equal(room.simulation.levelIndex,0);
 assert.equal(room.nextLevelAt,0);
});

test("restart during a transition cannot leave a stale level timer",()=> {
 let now=0; const room=new Room({id:'restart',now:()=>now});
 room.addPlayer(new FakeSocket(),'A'); room.addPlayer(new FakeSocket(),'B');
 room.nextLevelAt=100; room.restart(); now=150; room.update(1/30);
 assert.equal(room.status,'countdown'); assert.equal(room.simulation.levelIndex,0);
});

test("object nicknames cannot execute coercion or crash a join",()=> {
 assert.equal(sanitizeNickname({toString:null}),'Rower');
});
