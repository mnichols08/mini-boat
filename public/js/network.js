import { CLIENT_MESSAGES as CLIENT } from "../shared/protocol.mjs";

export class BoatNetwork extends EventTarget {
  constructor() {
    super();
    this.socket = null;
    this.session = this.loadSession();
  }

  loadSession() {
    try {
      const existing = sessionStorage.getItem("littleboat.session");
      if (existing) return existing;
      const next =
        crypto.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem("littleboat.session", next);
      return next;
    } catch (_error) {
      return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  }

  rememberSession(session) {
    if (!session) return;
    this.session = session;
    try {
      sessionStorage.setItem("littleboat.session", session);
    } catch (_error) {}
  }

  join(name) {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    this.socket = new WebSocket(`${protocol}//${window.location.host}`);
    this.socket.addEventListener("open", () => {
      this.send({ type: CLIENT.JOIN, name, session: this.session });
    });
    this.socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data);
        this.dispatchEvent(new CustomEvent("message", { detail: message }));
      } catch (_error) {
        this.dispatchEvent(
          new CustomEvent("message", {
            detail: { type: "error", message: "Unreadable server message." },
          }),
        );
      }
    });
    this.socket.addEventListener("close", () => {
      this.dispatchEvent(
        new CustomEvent("message", {
          detail: { type: "connection-closed", message: "Connection closed." },
        }),
      );
    });
  }

  row() {
    this.send({ type: CLIENT.ROW });
  }

  ping(ping) {
    this.send({ type: CLIENT.PING, ping });
  }
  ready() {
    this.send({ type: CLIENT.READY });
  }
  resumeReady() {
    this.send({ type: CLIENT.RESUME_READY });
  }
  restartRequest() {
    this.send({ type: CLIENT.RESTART_REQUEST });
  }
  restartResponse(voteId, accept) {
    this.send({ type: CLIENT.RESTART_RESPONSE, voteId, accept });
  }
  pauseRequest() {
    this.send({ type: CLIENT.PAUSE_REQUEST });
  }
  pauseResponse(voteId, accept) {
    this.send({ type: CLIENT.PAUSE_RESPONSE, voteId, accept });
  }
  findPartner() {
    this.send({ type: CLIENT.FIND_PARTNER });
  }

  send(message) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}
