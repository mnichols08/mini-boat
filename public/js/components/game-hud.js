import { VIEW, formatTime } from "../presentation.js";

class GameHud extends HTMLElement {
  constructor() {
    super();
    this.state = null;
    this.seat = null;
    this.readyAt = 0;
  }

  connectedCallback() {
    this.innerHTML = `
      <section class="hud">
        <div><strong class="level-name"></strong><span class="checkpoint"></span></div>
        <div class="players">
          <div class="player left"><i class="oar-icon" aria-label="Left oar"></i><b class="left-name"></b><small>LEFT OAR</small></div>
          <div class="player right"><i class="oar-icon" aria-label="Right oar"></i><b class="right-name"></b><small>RIGHT OAR</small></div>
        </div>
        <div><strong class="time"></strong><span class="bumps"></span></div>
        <div class="row-feedback"><div class="row-state"></div><span class="rhythm-cue" aria-live="polite"></span></div>
      </section>`;
    this.render();
    this.interval = setInterval(() => this.render(), 80);
  }

  disconnectedCallback() { clearInterval(this.interval); }
  setSeat(seat) { this.seat = seat; this.render(); }

  setState(state) {
    this.state = state;
    const remaining = state.oars?.[this.seat]?.cooldownRemainingMs || 0;
    this.readyAt = performance.now() + remaining;
    this.render();
  }

  stroke(side, synchronized, cooldownMs) {
    if (side === this.seat) this.readyAt = performance.now() + cooldownMs;
    for (const target of synchronized ? ["left", "right"] : [side]) {
      const icon = this.querySelector(`.player.${target} .oar-icon`);
      icon.getAnimations().forEach((animation) => animation.cancel());
      icon.animate([
        { transform: "rotate(-35deg) scale(1)", boxShadow: "0 0 0 0 transparent" },
        { transform: "rotate(-12deg) scale(1.3)", boxShadow: synchronized ? "0 0 0 6px #ffe8a280" : "0 0 0 4px #ffffff45", offset: 0.25 },
        { transform: "rotate(-35deg) scale(1)", boxShadow: "0 0 0 0 transparent" },
      ], { duration: synchronized ? VIEW.syncMs : VIEW.strokeMs, easing: "ease-out" });
    }
    if (synchronized) {
      const cue = this.querySelector(".rhythm-cue");
      cue.textContent = "PERFECT ROW";
      clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => { cue.textContent = ""; }, VIEW.syncMs);
    }
    this.render();
  }

  resetFeedback() {
    this.readyAt = 0;
    clearTimeout(this.syncTimer);
    this.querySelector(".rhythm-cue").textContent = "";
    this.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    this.render();
  }

  render() {
    if (!this.firstElementChild) return;
    const state = this.state;
    for (const side of ["left", "right"]) {
      const player = state?.players?.find((player) => player.seat === side);
      this.querySelector(`.${side}-name`).textContent = player?.name || "Waiting…";
      this.querySelector(`.player.${side}`).classList.toggle("self", side === this.seat);
    }
    this.querySelector(".level-name").textContent = state?.levelName || "Waiting for water";
    this.querySelector(".checkpoint").textContent = `Checkpoint ${state?.checkpoint.current || 0} / ${state?.checkpoint.total || 0}`;
    this.querySelector(".time").textContent = formatTime(state?.elapsedMs || 0);
    this.querySelector(".bumps").textContent = `Bumps ${state?.levelStats?.collisions || 0}`;
    const ready = performance.now() >= this.readyAt;
    const active = state?.roomStatus === "playing";
    const row = this.querySelector(".row-state");
    row.textContent = !active ? "WAITING" : ready ? "SPACE TO ROW" : "RECOVERING";
    row.classList.toggle("cooling", !ready || !active);
  }
}

customElements.define("game-hud", GameHud);
