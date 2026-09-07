import { VIEW, formatTime } from "../presentation.js";
import { PINGS } from "../../shared/protocol.mjs";

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
        <div><strong class="level-name"></strong><span class="checkpoint"></span><span class="seat-owner"></span></div>
        <div class="players">
          <div class="player left"><i class="oar-icon" aria-label="Left oar"></i><b class="left-name"></b><small>LEFT OAR</small></div>
          <div class="player right"><i class="oar-icon" aria-label="Right oar"></i><b class="right-name"></b><small>RIGHT OAR</small></div>
        </div>
        <div><strong class="time"></strong><span class="bumps"></span></div>
        <div class="row-feedback"><div class="row-state"></div><span class="rhythm-cue" aria-live="polite"></span></div>
        <div class="ping-controls" aria-label="Quick pings">
          <button type="button" data-ping="${PINGS.ROW}">1 ROW!</button>
          <button type="button" data-ping="${PINGS.LEFT}">2 LEFT!</button>
          <button type="button" data-ping="${PINGS.RIGHT}">3 RIGHT!</button>
          <button type="button" data-ping="${PINGS.WAIT}">4 WAIT!</button>
          <button type="button" data-ping="${PINGS.NICE}">5 NICE!</button>
        </div>
        <div class="match-controls">
          <button type="button" data-action="pause">P Pause</button>
          <button type="button" data-action="restart">R Restart</button>
        </div>
      </section>`;
    this.querySelector(".ping-controls").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-ping]");
      if (button)
        this.dispatchEvent(
          new CustomEvent("ping", {
            bubbles: true,
            detail: { ping: button.dataset.ping },
          }),
        );
    });
    this.querySelector(".match-controls").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      this.dispatchEvent(
        new CustomEvent(
          button.dataset.action === "pause"
            ? "pause-request"
            : "restart-request",
          { bubbles: true },
        ),
      );
    });
    this.render();
    this.interval = setInterval(() => this.render(), 80);
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
    const remaining = state.oars?.[this.seat]?.cooldownRemainingMs || 0;
    this.readyAt = performance.now() + remaining;
    this.render();
  }

  stroke(side, synchronized, cooldownMs) {
    if (side === this.seat) this.readyAt = performance.now() + cooldownMs;
    for (const target of synchronized ? ["left", "right"] : [side]) {
      const icon = this.querySelector(`.player.${target} .oar-icon`);
      icon.getAnimations().forEach((animation) => animation.cancel());
      icon.animate(
        [
          {
            transform: "rotate(-35deg) scale(1)",
            boxShadow: "0 0 0 0 transparent",
          },
          {
            transform: "rotate(-12deg) scale(1.3)",
            boxShadow: synchronized
              ? "0 0 0 6px #ffe8a280"
              : "0 0 0 4px #ffffff45",
            offset: 0.25,
          },
          {
            transform: "rotate(-35deg) scale(1)",
            boxShadow: "0 0 0 0 transparent",
          },
        ],
        {
          duration: synchronized ? VIEW.syncMs : VIEW.strokeMs,
          easing: "ease-out",
        },
      );
    }
    if (synchronized) {
      const cue = this.querySelector(".rhythm-cue");
      cue.textContent = "PERFECT ROW";
      clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => {
        cue.textContent = "";
      }, VIEW.syncMs);
    }
    this.render();
  }

  ping(side, ping) {
    const player = this.querySelector(`.player.${side}`);
    if (player) {
      player
        .getAnimations()
        .filter((animation) => animation.effect?.target === player)
        .forEach((animation) => animation.cancel());
      player.animate(
        [
          { transform: "scale(1)", filter: "brightness(1)" },
          { transform: "scale(1.04)", filter: "brightness(1.12)" },
          { transform: "scale(1)", filter: "brightness(1)" },
        ],
        { duration: VIEW.pingPopMs * 2, easing: "ease-out" },
      );
    }
    const cue = this.querySelector(".rhythm-cue");
    cue.textContent = ping.toUpperCase();
    clearTimeout(this.pingTimer);
    this.pingTimer = setTimeout(() => {
      cue.textContent = "";
    }, VIEW.pingMs);
  }

  resetFeedback() {
    this.readyAt = 0;
    clearTimeout(this.syncTimer);
    clearTimeout(this.pingTimer);
    this.querySelector(".rhythm-cue").textContent = "";
    this.getAnimations({ subtree: true }).forEach((animation) =>
      animation.cancel(),
    );
    this.render();
  }

  render() {
    if (!this.firstElementChild) return;
    const state = this.state;
    for (const side of ["left", "right"]) {
      const player = state?.players?.find((player) => player.seat === side);
      this.querySelector(`.${side}-name`).textContent =
        player?.name || "Waiting…";
      this.querySelector(`.player.${side}`).classList.toggle(
        "self",
        side === this.seat,
      );
    }
    this.querySelector(".level-name").textContent =
      state?.levelName || "Waiting for water";
    this.querySelector(".checkpoint").textContent =
      `Checkpoint ${state?.checkpoint.current || 0} / ${state?.checkpoint.total || 0}`;
    const sideText =
      this.seat === "left"
        ? "YOU CONTROL ← LEFT OAR"
        : this.seat === "right"
          ? "YOU CONTROL RIGHT OAR →"
          : "";
    this.querySelector(".seat-owner").textContent = sideText;
    this.querySelector(".time").textContent = formatTime(state?.elapsedMs || 0);
    this.querySelector(".bumps").textContent =
      `Bumps ${state?.levelStats?.collisions || 0}`;
    const ready = performance.now() >= this.readyAt;
    const active = state?.roomStatus === "playing";
    const row = this.querySelector(".row-state");
    row.textContent = !active
      ? "WAITING"
      : ready
        ? "SPACE TO ROW"
        : "RECOVERING";
    row.classList.toggle("cooling", !ready || !active);
    const controlsDisabled = !["playing", "paused"].includes(state?.roomStatus);
    this.querySelectorAll(".match-controls button").forEach((button) => {
      button.disabled = controlsDisabled;
    });
  }
}

customElements.define("game-hud", GameHud);
