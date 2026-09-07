import { VIEW } from "./presentation.js";

export class BoatAudio {
  constructor() {
    this.muted = false;
    this.unavailable = false;
    this.context = null;
  }

  async unlock() {
    if (this.unavailable) return;
    try {
      if (!this.context) {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) throw new Error("Audio unavailable");
        this.context = new Context();
        this.master = this.context.createGain();
        this.master.gain.value = this.muted ? 0 : VIEW.audioVolume;
        this.master.connect(this.context.destination);
        this.noise = this.context.createBuffer(
          1,
          this.context.sampleRate * 0.3,
          this.context.sampleRate,
        );
        const samples = this.noise.getChannelData(0);
        for (let i = 0; i < samples.length; i += 1)
          samples[i] = Math.random() * 2 - 1;
      }
      if (this.context.state === "suspended") await this.context.resume();
    } catch (_error) {
      this.unavailable = true;
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master)
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : VIEW.audioVolume,
        this.context.currentTime,
        0.02,
      );
  }

  voice({
    frequency = 400,
    endFrequency = frequency,
    duration = 0.16,
    delay = 0,
    noise = false,
    pan = 0,
    volume = 0.5,
  }) {
    const context = this.context;
    const at = context.currentTime + delay;
    const source = noise
      ? context.createBufferSource()
      : context.createOscillator();
    const envelope = context.createGain();
    const filter = context.createBiquadFilter();
    const panner = context.createStereoPanner();
    if (noise) source.buffer = this.noise;
    else {
      source.type = "sine";
      source.frequency.setValueAtTime(frequency, at);
      source.frequency.exponentialRampToValueAtTime(
        endFrequency,
        at + duration,
      );
    }
    filter.type = "lowpass";
    filter.frequency.value = noise ? frequency : 2400;
    panner.pan.value = pan;
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(volume, at + 0.015);
    envelope.gain.exponentialRampToValueAtTime(0.001, at + duration);
    source
      .connect(filter)
      .connect(envelope)
      .connect(panner)
      .connect(this.master);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      envelope.disconnect();
      panner.disconnect();
    };
    source.start(at);
    source.stop(at + duration + 0.01);
  }

  play(kind, { side, strength = 0.5 } = {}) {
    if (this.muted || this.unavailable || this.context?.state !== "running")
      return;
    try {
      if (kind === "row") {
        this.voice({
          noise: true,
          frequency: 1200,
          duration: 0.18,
          pan: side === "left" ? -0.45 : 0.45,
        });
      } else if (kind === "sync") {
        this.voice({ frequency: 440, duration: 0.22, volume: 0.28 });
        this.voice({
          frequency: 660,
          delay: 0.04,
          duration: 0.24,
          volume: 0.22,
        });
      } else if (kind === "rock") {
        this.voice({
          frequency: 135,
          endFrequency: 65,
          duration: 0.18,
          volume: 0.4 + strength * 0.3,
        });
      } else if (kind === "bank") {
        this.voice({
          noise: true,
          frequency: 380,
          duration: 0.22,
          volume: 0.5,
        });
      } else if (kind === "ping") {
        const map = { row: 520, left: 390, right: 620, wait: 260, nice: 740 };
        this.voice({
          frequency: map[side] || 440,
          duration: 0.12,
          volume: 0.22,
        });
      } else if (kind === "joined" || kind === "reconnected") {
        this.voice({ frequency: 523, duration: 0.14, volume: 0.22 });
        this.voice({
          frequency: 659,
          delay: 0.08,
          duration: 0.18,
          volume: 0.2,
        });
      } else if (kind === "disconnected" || kind === "pause") {
        this.voice({
          frequency: 300,
          endFrequency: 180,
          duration: 0.2,
          volume: 0.22,
        });
      } else if (kind === "ready" || kind === "resume") {
        this.voice({ frequency: 440, duration: 0.12, volume: 0.2 });
        this.voice({
          frequency: 587,
          delay: 0.06,
          duration: 0.16,
          volume: 0.18,
        });
      } else {
        const notes = kind === "complete" ? [392, 494, 587] : [523, 659];
        notes.forEach((frequency, index) =>
          this.voice({
            frequency,
            delay: index * 0.11,
            duration: 0.28,
            volume: 0.3,
          }),
        );
      }
    } catch (_error) {
      // Audio never gates input, animation, or the connection.
      this.unavailable = true;
    }
  }
}
