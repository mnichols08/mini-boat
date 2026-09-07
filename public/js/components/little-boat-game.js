import { BoatNetwork } from "../network.js";
import { LittleBoatRenderer } from "../renderer.js";

class LittleBoatGame extends HTMLElement {
  constructor() {
    super();
    this.network = new BoatNetwork();
    this.constants = { rowCooldownMs: 520 };
    this.seat = null;
    this.roomStatus = "waiting";
    this.readyAt = 0;
    this.partnerDisconnected = false;
  }

  async connectedCallback() {
    this.innerHTML = `
      <main class="game-shell">
        <div class="scene-host"></div>
        <div class="overlay">
          <game-hud hidden></game-hud>
          <div class="center-layer">
            <game-lobby></game-lobby>
            <section class="message-card" hidden>
              <h2 class="message-title"></h2>
              <p class="message-meta"></p>
              <button class="row-again" hidden>Row Again</button>
            </section>
          </div>
          <div></div>
        </div>
      </main>
    `;

    this.lobby = this.querySelector("game-lobby");
    this.hud = this.querySelector("game-hud");
    this.messageCard = this.querySelector(".message-card");
    this.messageTitle = this.querySelector(".message-title");
    this.messageMeta = this.querySelector(".message-meta");
    this.rowAgain = this.querySelector(".row-again");
    this.rendererView = new LittleBoatRenderer(
      this.querySelector(".scene-host"),
    );

    try {
      const response = await fetch("/api/levels");
      if (!response.ok) throw new Error("Unable to load river courses.");
      const data = await response.json();
      this.rendererView.setLevels(data.levels);
    } catch (error) {
      this.lobby.setStatus(`${error.message} Reload to try again.`);
      return;
    }

    this.addEventListener("join", (event) => this.join(event.detail.name));
    this.rowAgain.addEventListener("click", () => {
      this.network.restart();
      this.hideMessage();
    });
    this.network.addEventListener("message", (event) =>
      this.handleServerMessage(event.detail),
    );
    window.addEventListener("keydown", (event) => this.handleKeydown(event));
  }

  join(name) {
    this.lobby.setStatus("Finding a rowing partner...");
    this.network.join(name);
  }

  handleKeydown(event) {
    if (
      (event.code !== "Space" && event.code !== "Enter") ||
      event.repeat ||
      !this.seat || this.roomStatus !== "playing" || performance.now() < this.readyAt
    ) {
      return;
    }
    event.preventDefault();
    this.readyAt = performance.now() + this.constants.rowCooldownMs;
    this.network.row();
    this.hud.markRow(this.constants.rowCooldownMs);

  }

  handleServerMessage(message) {
    if (message.type === "joined") {
      this.hideMessage();
      this.seat = message.seat;
      this.constants = { ...this.constants, ...message.constants };
      this.hud.hidden = false;
      this.hud.setSeat(this.seat);
      this.lobby.setStatus(`You have the ${this.seat.toUpperCase()} oar.`);
      return;
    }

    if (message.type === "waiting") {
      this.lobby.hidden = true;
      this.lobby.setStatus(message.message);
      this.showMessage(
        this.partnerDisconnected ? "Your rowing partner disconnected." : "Waiting for another rower...",
        this.seat ? `You have the ${this.seat.toUpperCase()} oar. Waiting for another rower...` : "",
      );
      return;
    }

    if (message.type === "countdown") {
      this.lobby.hidden = true;
      this.showMessage(
        message.message,
        "Tap Space or Enter for one rowing stroke.",
      );
      clearInterval(this.countdownTimer);
      this.partnerDisconnected = false;
      if (message.message === "ROW!") {
        this.showMessage("ROW!", "Find your rhythm together.", 650);
      } else {
        let remaining = 3;
        this.messageTitle.textContent = remaining;
        this.countdownTimer = setInterval(() => {
          remaining -= 1;
          if (remaining > 0) this.messageTitle.textContent = remaining;
          else clearInterval(this.countdownTimer);
        }, 1000);
      }
      return;
    }

    if (message.type === "state") {
      this.roomStatus = message.roomStatus;
      this.hud.setState(message);
      this.rendererView.setState(message);
      return;
    }

    if (message.type === "stroke") {
      this.rendererView.stroke(message.side, message.synchronized);
      if (message.side === this.seat) this.hud.markRow(this.constants.rowCooldownMs);
      if (message.synchronized) {
        this.hud.classList.remove("perfect");
        void this.hud.offsetWidth;
        this.hud.classList.add("perfect");
      }
      return;
    }

    if (message.type === "checkpoint") {
      this.showMessage(
        "Checkpoint!",
        `${message.current} / ${message.total}`,
        900,
      );
      return;
    }

    if (message.type === "level-complete") {
      this.showMessage(
        "Level Complete",
        `${message.levelName} in ${formatTime(message.timeMs)} · Bumps ${message.collisions}. Next level starting...`,
      );
      return;
    }

    if (message.type === "game-complete") {
      const syncPercent = message.strokes
        ? Math.round((2 * message.synchronizedStrokes / message.strokes) * 100)
        : 0;
      this.showMessage(
        "You Made It!",
        `Total ${formatTime(message.totalTimeMs)} · Bumps ${message.collisions} · Perfect strokes ${syncPercent}%`,
      );
      this.rowAgain.hidden = false;
      return;
    }

    if (message.type === "opponent-disconnected" || message.type === "error") {
      this.partnerDisconnected = message.type === "opponent-disconnected";
      this.roomStatus = "waiting";
      clearInterval(this.countdownTimer);
      this.lobby.hidden = this.partnerDisconnected;
      if (!this.partnerDisconnected) {
        this.seat = null;
        this.hud.hidden = true;
        this.hideMessage();
        this.lobby.setStatus(`${message.message} Join again to try a new connection.`);
        return;
      }
      this.showMessage(
        message.message || "Something went wrong.",
        "Wait here for another rower.",
      );
    }
  }

  showMessage(title, meta = "", autoHideMs = 0) {
    clearTimeout(this.messageTimer);
    this.messageTitle.textContent = title;
    this.messageMeta.textContent = meta;
    this.messageCard.hidden = false;
    this.rowAgain.hidden = true;
    if (autoHideMs) {
      this.messageTimer = setTimeout(() => this.hideMessage(), autoHideMs);
    }
  }

  hideMessage() {
    this.messageCard.hidden = true;
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

customElements.define("little-boat-game", LittleBoatGame);
