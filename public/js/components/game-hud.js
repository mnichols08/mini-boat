class GameHud extends HTMLElement {
  constructor() {
    super();
    this.state = null;
    this.seat = null;
    this.readyAt = 0;
  }

  connectedCallback() {
    this.render();
    this.interval = setInterval(() => this.render(), 120);
  }

  disconnectedCallback() {
    clearInterval(this.interval);
  }

  setSeat(seat) {
    this.seat = seat;
    this.render();
  }

  setState(state) {
    this.state = state;
    this.render();
  }

  markRow(cooldownMs) {
    this.readyAt = performance.now() + cooldownMs;
    this.render();
  }

  render() {
    const state = this.state;
    const players = state?.players || [];
    const left = players.find((player) => player.seat === "left");
    const right = players.find((player) => player.seat === "right");
    const ready = performance.now() >= this.readyAt;
    const checkpointText = state
      ? `Checkpoint ${state.checkpoint.current} / ${state.checkpoint.total}`
      : "Checkpoint 0 / 0";
    this.innerHTML = `
      <section class="hud ${this.seat || ""}">
        <div>
          <strong>${state?.levelName || "Waiting for water"}</strong>
          <span>${checkpointText}</span>
        </div>
        <div class="players">
          <span class="player left ${this.seat === "left" ? "self" : ""}"><b class="left-name"></b><small>LEFT OAR</small></span>
          <span class="player right ${this.seat === "right" ? "self" : ""}"><b class="right-name"></b><small>RIGHT OAR</small></span>
        </div>
        <div>
          <strong>${formatTime(state?.elapsedMs || 0)}</strong>
          <span>Bumps ${state?.collisions || 0}</span>
        </div>
        <div class="row-state ${ready ? "ready" : "cooling"}">${ready ? "SPACE TO ROW" : "..."}</div>
      </section>
    `;
    this.querySelector('.left-name').textContent = left?.name || "Waiting…";
    this.querySelector('.right-name').textContent = right?.name || "Waiting…";
  }
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

customElements.define("game-hud", GameHud);
