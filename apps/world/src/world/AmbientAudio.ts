/** A small, optional filtered wind bed. Audio starts only after the user presses the sound control. */
export class AmbientAudio {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  async setEnabled(enabled: boolean) {
    if (enabled && !this.context) {
      const context = new AudioContext();
      const length = context.sampleRate * 2;
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const channel = buffer.getChannelData(0);
      let drift = 0;
      for (let i = 0; i < length; i++) { drift = (drift + (Math.random() * 2 - 1) * 0.035) / 1.035; channel[i] = drift * 2.7; }
      const source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
      const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 480;
      const gain = context.createGain(); gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(context.destination); source.start();
      this.context = context; this.source = source; this.gain = gain;
    }
    if (this.gain && this.context) {
      await this.context.resume();
      this.gain.gain.setTargetAtTime(enabled ? 0.13 : 0, this.context.currentTime, 0.18);
    }
  }
  dispose() { this.source?.stop(); void this.context?.close(); this.source = null; this.context = null; this.gain = null; }
}
