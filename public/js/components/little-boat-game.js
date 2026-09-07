import { BoatNetwork } from "../network.js";
import { LittleBoatRenderer } from "../renderer.js";
import { BoatAudio } from "../audio.js";
import { formatTime } from "../presentation.js";

class LittleBoatGame extends HTMLElement {
  constructor() {
    super();
    this.network = new BoatNetwork();
    this.audio = new BoatAudio();
    this.constants = {};
    this.seat = null;
    this.roomStatus = "waiting";
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
              <div class="summary" hidden></div>
              <p class="control-reminder" hidden><strong>SPACE TO ROW</strong><br>ROW TOGETHER TO GO STRAIGHT</p>
              <button class="row-again" hidden>Row Again</button>
            </section>
          </div>
          <div class="sound-bar"><p class="game-notice" role="status" hidden></p><button class="mute-control" aria-pressed="false">Mute sound</button></div>
        </div>
      </main>
    `;

    this.lobby = this.querySelector("game-lobby");
    this.hud = this.querySelector("game-hud");
    this.messageCard = this.querySelector(".message-card");
    this.messageTitle = this.querySelector(".message-title");
    this.messageMeta = this.querySelector(".message-meta");
    this.summary = this.querySelector(".summary");
    this.controlReminder = this.querySelector(".control-reminder");
    this.muteControl = this.querySelector(".mute-control");
    this.notice = this.querySelector(".game-notice");
    this.muteControl.addEventListener("click", () => {
      this.audio.toggleMute();
      this.unlockAudio();
      this.updateAudioControl();
    });
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
    this.unlockAudio();
    this.lobby.setStatus("Finding a rowing partner...");
    this.network.join(name);
  }

  handleKeydown(event) {
    if (
      (event.code !== "Space" && event.code !== "Enter") ||
      event.repeat ||
      !this.seat || this.roomStatus !== "playing" ||
      event.target.closest?.("input, button, textarea, [contenteditable]")
    ) {
      return;
    }
    event.preventDefault();
    this.unlockAudio();
    this.network.row();
  }

  handleServerMessage(message) {
    if (message.type === "joined") {
      this.resetFeedback();
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
      this.controlReminder.hidden = false;
      return;
    }

    if (message.type === "countdown") {
      this.resetFeedback();
      this.lobby.hidden = true;
      this.showMessage(
        message.message,
        "Find your rhythm together.",
      );
      clearInterval(this.countdownTimer);
      this.partnerDisconnected = false;
      if (message.message === "ROW!") {
        this.showMessage("ROW!", "Find your rhythm together.", 650);
      } else {
        this.controlReminder.hidden = false;
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
      if (this.roomStatus !== message.roomStatus && message.roomStatus !== "playing") this.resetFeedback();
      this.roomStatus = message.roomStatus;
      this.hud.setState(message);
      this.rendererView.setState(message);
      return;
    }

    if (message.type === "stroke") {
      this.rendererView.stroke(message.side, message.synchronized);
      this.hud.stroke(message.side, message.synchronized, this.constants.rowCooldownMs);
      this.audio.play("row", message);
      if (message.synchronized) this.audio.play("sync");
      this.updateAudioControl();
      return;
    }

    if (message.type === "collision") {
      this.rendererView.collision(message);
      this.audio.play(message.kind, message);
      this.updateAudioControl();
      return;
    }

    if (message.type === "checkpoint") {
      this.audio.play("checkpoint");
      this.updateAudioControl();
      clearTimeout(this.noticeTimer);
      this.notice.textContent = `Checkpoint ${message.current} / ${message.total}`;
      this.notice.hidden = false;
      this.noticeTimer = setTimeout(() => { this.notice.hidden = true; }, 1200);
      return;
    }

    if (message.type === "level-complete") {
      this.audio.play("complete");
      this.updateAudioControl();
      this.showMessage(
        "Level Complete",
        `${message.levelName}${message.nextStartsAt ? " · Next level starting soon" : ""}`,
      );
      this.showSummary(message);
      this.controlReminder.hidden = !message.nextStartsAt;
      return;
    }

    if (message.type === "game-complete") {
      this.showMessage(
        "You Made It!",
        "Three rivers, one boat. Thanks for rowing together.",
      );
      this.showSummary(message.levelSummaries.at(-1), { ...message, timeMs: message.totalTimeMs });
      this.rowAgain.hidden = false;
      return;
    }

    if (message.type === "error") {
      if (this.seat) this.showMessage(message.message, "", 1400);
      else this.lobby.setStatus(message.message);
      return;
    }

    if (message.type === "opponent-disconnected" || message.type === "connection-closed") {
      this.resetFeedback();
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
    this.notice.hidden = true;
    clearTimeout(this.noticeTimer);
    clearTimeout(this.messageTimer);
    this.messageTitle.textContent = title;
    this.messageMeta.textContent = meta;
    this.messageCard.hidden = false;
    this.rowAgain.hidden = true;
    this.summary.hidden = true;
    this.controlReminder.hidden = true;
    if (autoHideMs) {
      this.messageTimer = setTimeout(() => this.hideMessage(), autoHideMs);
    }
  }

  hideMessage() {
    clearTimeout(this.messageTimer);
    this.messageCard.hidden = true;
  }

  showSummary(level, run = null) {
    const table = document.createElement("table");
    const heading = table.createTHead().insertRow();
    for (const label of run ? ["", "Level 3", "Whole run"] : ["", "This level"]) {
      const cell = document.createElement("th");
      cell.textContent = label;
      cell.scope = "col";
      heading.append(cell);
    }
    const body = table.createTBody();
    for (const [label, key] of [["Time", "timeMs"], ["Bumps", "collisions"], ["Total Strokes", "strokes"],
      ["Perfect Rows", "synchronizedStrokes"], ["Sync", "syncPercentage"]]) {
      const row = body.insertRow();
      const title = document.createElement("th");
      title.textContent = label;
      title.scope = "row";
      row.append(title);
      for (const stats of run ? [level, run] : [level]) {
        row.insertCell().textContent = key === "timeMs" ? formatTime(stats[key])
          : key === "syncPercentage" ? `${stats[key]}%` : stats[key];
      }
    }
    this.summary.replaceChildren(table);
    this.summary.hidden = false;
  }

  resetFeedback() {
    clearTimeout(this.noticeTimer);
    this.notice.hidden = true;
    this.hud.resetFeedback();
    this.rendererView.resetFeedback();
  }

  async unlockAudio() {
    await this.audio.unlock();
    this.updateAudioControl();
  }

  updateAudioControl() {
    this.muteControl.textContent = this.audio.unavailable ? "Sound unavailable"
      : this.audio.muted ? "Unmute sound" : "Mute sound";
    this.muteControl.disabled = this.audio.unavailable;
    this.muteControl.setAttribute("aria-pressed", String(this.audio.muted));
  }
}

customElements.define("little-boat-game", LittleBoatGame);
