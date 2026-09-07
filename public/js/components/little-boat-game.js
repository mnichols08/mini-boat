import { BoatNetwork } from "../network.js";
import { LittleBoatRenderer } from "../renderer.js";
import { BoatAudio } from "../audio.js";
import { formatTime } from "../presentation.js";
import { PINGS } from "../../shared/protocol.mjs";

class LittleBoatGame extends HTMLElement {
  constructor() {
    super();
    this.network = new BoatNetwork();
    this.audio = new BoatAudio();
    this.constants = {};
    this.seat = null;
    this.roomStatus = "waiting";
    this.partnerDisconnected = false;
    this.currentState = null;
    this.activeVote = null;
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
              <div class="ready-state" hidden></div>
              <div class="vote-panel" hidden>
                <p class="vote-copy"></p>
                <button class="vote-accept" type="button">Accept</button>
                <button class="vote-decline" type="button">Keep Rowing</button>
              </div>
              <p class="control-reminder" hidden><strong>SPACE TO ROW</strong><br>ROW TOGETHER TO GO STRAIGHT</p>
              <button class="row-again" hidden>Ready</button>
              <button class="find-partner" hidden>Find Another Rower</button>
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
    this.readyState = this.querySelector(".ready-state");
    this.votePanel = this.querySelector(".vote-panel");
    this.voteCopy = this.querySelector(".vote-copy");
    this.controlReminder = this.querySelector(".control-reminder");
    this.muteControl = this.querySelector(".mute-control");
    this.notice = this.querySelector(".game-notice");
    this.muteControl.addEventListener("click", () => {
      this.audio.toggleMute();
      this.unlockAudio();
      this.updateAudioControl();
    });
    this.rowAgain = this.querySelector(".row-again");
    this.findPartner = this.querySelector(".find-partner");
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
      if (this.roomStatus === "paused") this.network.resumeReady();
      else this.network.ready();
      this.rowAgain.hidden = true;
    });
    this.findPartner.addEventListener("click", () =>
      this.network.findPartner(),
    );
    this.querySelector(".vote-accept").addEventListener("click", () =>
      this.respondVote(true),
    );
    this.querySelector(".vote-decline").addEventListener("click", () =>
      this.respondVote(false),
    );
    this.hud.addEventListener("ping", (event) =>
      this.network.ping(event.detail.ping),
    );
    this.hud.addEventListener("pause-request", () =>
      this.network.pauseRequest(),
    );
    this.hud.addEventListener("restart-request", () =>
      this.network.restartRequest(),
    );
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
    const pingKeys = {
      Digit1: PINGS.ROW,
      Digit2: PINGS.LEFT,
      Digit3: PINGS.RIGHT,
      Digit4: PINGS.WAIT,
      Digit5: PINGS.NICE,
    };
    if (pingKeys[event.code] && !event.repeat && this.seat) {
      event.preventDefault();
      this.unlockAudio();
      this.network.ping(pingKeys[event.code]);
      return;
    }
    if (
      event.code === "KeyR" &&
      !event.repeat &&
      this.roomStatus === "playing"
    ) {
      event.preventDefault();
      this.network.restartRequest();
      return;
    }
    if (
      event.code === "KeyP" &&
      !event.repeat &&
      this.roomStatus === "playing"
    ) {
      event.preventDefault();
      this.network.pauseRequest();
      return;
    }
    if (
      (event.code !== "Space" && event.code !== "Enter") ||
      event.repeat ||
      !this.seat ||
      this.roomStatus !== "playing" ||
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
      this.network.rememberSession(message.session);
      this.resetFeedback();
      this.hideMessage();
      this.seat = message.seat;
      this.currentState = {
        ...(this.currentState || {}),
        players: message.players,
      };
      this.constants = { ...this.constants, ...message.constants };
      this.hud.hidden = false;
      this.hud.setSeat(this.seat);
      this.rendererView.setSeat(this.seat);
      this.lobby.setStatus(`You have the ${this.seat.toUpperCase()} oar.`);
      if (message.reconnected)
        this.showMessage(
          "Reconnected",
          `${this.roleCopy()} Get ready to row.`,
          1200,
        );
      return;
    }

    if (message.type === "waiting") {
      this.lobby.hidden = true;
      this.lobby.setStatus(message.message);
      this.showMessage(
        this.partnerDisconnected
          ? "Your rowing partner disconnected."
          : "Waiting for another rower...",
        this.seat
          ? `You have the ${this.seat.toUpperCase()} oar. Waiting for another rower...`
          : "",
      );
      this.controlReminder.hidden = false;
      return;
    }

    if (message.type === "countdown") {
      this.resetFeedback();
      this.lobby.hidden = true;
      if (message.players)
        this.currentState = {
          ...(this.currentState || {}),
          players: message.players,
        };
      this.showMessage("3", this.countdownCopy(message.reason));
      clearInterval(this.countdownTimer);
      this.partnerDisconnected = false;
      this.controlReminder.hidden = false;
      let remaining = Math.max(
        1,
        Math.ceil(
          (message.durationMs || this.constants.countdownMs || 3200) / 1000,
        ),
      );
      this.messageTitle.textContent = remaining;
      this.countdownTimer = setInterval(() => {
        remaining -= 1;
        if (remaining > 0) this.messageTitle.textContent = remaining;
        else {
          this.messageTitle.textContent = "ROW!";
          clearInterval(this.countdownTimer);
          this.messageTimer = setTimeout(() => this.hideMessage(), 650);
        }
      }, 1000);
      return;
    }

    if (message.type === "state") {
      if (
        this.roomStatus !== message.roomStatus &&
        message.roomStatus !== "playing"
      )
        this.resetFeedback();
      this.roomStatus = message.roomStatus;
      this.currentState = message;
      this.hud.setState(message);
      this.rendererView.setState(message);
      if (message.roomStatus === "paused") {
        if (this.messageCard.hidden)
          this.showMessage("Paused", "Both rowers must be ready to resume.");
        else {
          this.messageTitle.textContent = "Paused";
          this.messageMeta.textContent = "Both rowers must be ready to resume.";
          this.votePanel.hidden = true;
        }
      }
      this.updateReadyDisplay(message);
      this.updateVoteDisplay(message);
      return;
    }

    if (message.type === "ping") {
      this.rendererView.ping(message.side, message.ping, message.durationMs);
      this.hud.ping(message.side, message.ping);
      this.audio.play("ping", { side: message.ping });
      this.updateAudioControl();
      return;
    }

    if (message.type === "stroke") {
      this.rendererView.stroke(message.side, message.synchronized);
      this.hud.stroke(
        message.side,
        message.synchronized,
        this.constants.rowCooldownMs,
      );
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
      this.noticeTimer = setTimeout(() => {
        this.notice.hidden = true;
      }, 1200);
      return;
    }

    if (message.type === "level-complete") {
      this.audio.play("complete");
      this.updateAudioControl();
      this.rendererView.celebrate();
      this.showMessage(
        "Level Complete",
        `${message.levelName} · Mark ready when both rowers are set.`,
      );
      this.showSummary(message);
      this.showReadyAction("Ready");
      return;
    }

    if (message.type === "game-complete") {
      this.showMessage(
        "You Made It!",
        "Three rivers, one boat. Row again when both players agree.",
      );
      this.showSummary(message.levelSummaries.at(-1), {
        ...message,
        timeMs: message.totalTimeMs,
      });
      this.showReadyAction("Row Again");
      return;
    }

    if (message.type === "vote-result") {
      this.activeVote = null;
      this.votePanel.hidden = true;
      if (message.reason !== "approved")
        this.showMessage(`${message.kind} cancelled`, message.reason, 1000);
      return;
    }

    if (message.type === "player-disconnected") {
      this.resetFeedback();
      this.audio.play("disconnected");
      this.updateAudioControl();
      this.roomStatus = "reconnecting";
      this.showMessage(
        "Your rowing partner disconnected.",
        "Waiting for them to return...",
      );
      return;
    }

    if (message.type === "player-reconnected") {
      this.audio.play("reconnected");
      this.updateAudioControl();
      this.showMessage(
        `${message.name} reconnected!`,
        "Get ready to row.",
        1200,
      );
      return;
    }

    if (message.type === "reconnect-expired") {
      this.roomStatus = "closed";
      this.showMessage(
        "Your partner did not return.",
        "Find another rower to start a fresh run.",
      );
      this.findPartner.hidden = false;
      return;
    }

    if (message.type === "error") {
      if (this.seat) this.showMessage(message.message, "", 1400);
      else this.lobby.setStatus(message.message);
      return;
    }

    if (
      message.type === "opponent-disconnected" ||
      message.type === "connection-closed"
    ) {
      this.resetFeedback();
      this.partnerDisconnected = message.type === "opponent-disconnected";
      this.roomStatus = "waiting";
      clearInterval(this.countdownTimer);
      this.lobby.hidden = this.partnerDisconnected;
      if (!this.partnerDisconnected) {
        this.seat = null;
        this.hud.hidden = true;
        this.hideMessage();
        this.lobby.setStatus(
          `${message.message} Join again to try a new connection.`,
        );
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
    this.readyState.hidden = true;
    this.votePanel.hidden = true;
    this.controlReminder.hidden = true;
    this.findPartner.hidden = true;
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
    for (const label of run
      ? ["", "Level 3", "Whole run"]
      : ["", "This level"]) {
      const cell = document.createElement("th");
      cell.textContent = label;
      cell.scope = "col";
      heading.append(cell);
    }
    const body = table.createTBody();
    for (const [label, key] of [
      ["Time", "timeMs"],
      ["Bumps", "collisions"],
      ["Total Strokes", "strokes"],
      ["Perfect Rows", "synchronizedStrokes"],
      ["Sync", "syncPercentage"],
    ]) {
      const row = body.insertRow();
      const title = document.createElement("th");
      title.textContent = label;
      title.scope = "row";
      row.append(title);
      for (const stats of run ? [level, run] : [level]) {
        row.insertCell().textContent =
          key === "timeMs"
            ? formatTime(stats[key])
            : key === "syncPercentage"
              ? `${stats[key]}%`
              : stats[key];
      }
    }
    this.summary.replaceChildren(table);
    this.summary.hidden = false;
  }

  showReadyAction(label) {
    this.rowAgain.textContent = label;
    this.rowAgain.hidden = false;
    this.updateReadyDisplay(this.currentState);
  }

  updateReadyDisplay(state) {
    if (
      !state ||
      !["level-complete", "game-complete", "paused"].includes(state.roomStatus)
    ) {
      this.readyState.hidden = true;
      return;
    }
    const verb = state.roomStatus === "game-complete" ? "ROW AGAIN" : "READY";
    const rows = ["left", "right"]
      .map((side) => {
        const player = state.players?.find(
          (candidate) => candidate.seat === side,
        );
        const mark = state.ready?.[side] ? `${verb} ✓` : "...";
        return `<p><strong>${player?.name || side}</strong><span>${mark}</span></p>`;
      })
      .join("");
    this.readyState.innerHTML = rows;
    this.readyState.hidden = false;
    this.rowAgain.textContent =
      state.roomStatus === "paused"
        ? "Resume"
        : state.roomStatus === "game-complete"
          ? "Row Again"
          : "Ready";
    this.rowAgain.hidden = Boolean(state.ready?.[this.seat]);
  }

  updateVoteDisplay(state) {
    this.activeVote = state?.vote || null;
    if (!this.activeVote) {
      this.votePanel.hidden = true;
      return;
    }
    const requester = state.players?.find(
      (player) => player.seat === this.activeVote.requestedBy,
    );
    const kind =
      this.activeVote.kind === "pause" ? "pause" : "restart this level";
    this.messageTitle.textContent =
      this.activeVote.kind === "pause"
        ? "Pause Requested"
        : "Restart Requested";
    this.messageMeta.textContent =
      "The boat keeps moving until both players agree.";
    this.voteCopy.textContent = `${requester?.name || "Your partner"} wants to ${kind}.`;
    const requestedBySelf = this.activeVote.requestedBy === this.seat;
    this.querySelector(".vote-accept").hidden = requestedBySelf;
    this.querySelector(".vote-decline").hidden = requestedBySelf;
    this.votePanel.hidden = false;
    this.messageCard.hidden = false;
  }

  respondVote(accept) {
    if (!this.activeVote) return;
    if (this.activeVote.kind === "pause")
      this.network.pauseResponse(this.activeVote.id, accept);
    else this.network.restartResponse(this.activeVote.id, accept);
    this.votePanel.hidden = true;
  }

  roleCopy() {
    const partner = this.currentState?.players?.find(
      (player) => player.seat !== this.seat,
    );
    return this.seat === "left"
      ? `YOU: LEFT OAR · PARTNER: ${partner?.seat?.toUpperCase() || "RIGHT"} OAR`
      : `YOU: RIGHT OAR · PARTNER: ${partner?.seat?.toUpperCase() || "LEFT"} OAR`;
  }

  countdownCopy(reason) {
    const prefix =
      reason === "reconnect"
        ? "Partner reconnected."
        : reason === "restart"
          ? "Restart approved."
          : reason === "resume"
            ? "Resuming together."
            : "Find your rhythm together.";
    return `${prefix} ${this.roleCopy()}`;
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
    this.muteControl.textContent = this.audio.unavailable
      ? "Sound unavailable"
      : this.audio.muted
        ? "Unmute sound"
        : "Mute sound";
    this.muteControl.disabled = this.audio.unavailable;
    this.muteControl.setAttribute("aria-pressed", String(this.audio.muted));
  }
}

customElements.define("little-boat-game", LittleBoatGame);
