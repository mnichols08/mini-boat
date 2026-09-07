class GameLobby extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <form class="lobby-card">
        <p class="eyebrow">A GAME FOR TWO</p><h1>THE LITTLE BOAT</h1><p>One boat. Two oars. Find your rhythm.</p>
        <label>
          <span>Nickname</span>
          <input name="name" maxlength="18" autocomplete="nickname" placeholder="Your river name" required>
        </label>
        <button type="submit">Find a Rower</button>
        <p class="status"></p>
      </form>
    `;
    this.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const name = new FormData(event.currentTarget).get("name");
      this.dispatchEvent(
        new CustomEvent("join", { bubbles: true, detail: { name } }),
      );
    });
  }

  setStatus(message) {
    const status = this.querySelector(".status");
    if (status) {
      status.textContent = message || "";
    }
  }
}

customElements.define("game-lobby", GameLobby);
