export class BoatNetwork extends EventTarget {
  constructor() {
    super();
    this.socket = null;
  }

  join(name) {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    this.socket = new WebSocket(`${protocol}//${window.location.host}`);
    this.socket.addEventListener("open", () => {
      this.send({ type: "join", name });
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
    this.send({ type: "row" });
  }

  restart() {
    this.send({ type: "restart" });
  }

  send(message) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}
