/* global AudioWorkletProcessor, registerProcessor, sampleRate */

const TARGET_RATE_HZ = 20;
const SIDEBAND_OFFSET_HZ = 350;
const TWO_PI = Math.PI * 2;

class BreathSonarProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frequencyHz = 19_000;
    this.generation = 0;
    this.samplesProcessed = 0;
    this.port.onmessage = (event) => {
      if (
        event.data?.type !== 'set-frequency'
        || !Number.isFinite(event.data.frequencyHz)
        || !Number.isSafeInteger(event.data.generation)
        || event.data.generation < 0
      ) {
        return;
      }
      this.frequencyHz = event.data.frequencyHz;
      this.generation = event.data.generation;
      this.resetDemodulator();
    };
    this.resetDemodulator();
  }

  resetDemodulator() {
    this.carrierPhase = 0;
    this.lowPhase = 0;
    this.highPhase = 0;
    this.count = 0;
    this.carrierI = 0;
    this.carrierQ = 0;
    this.lowI = 0;
    this.lowQ = 0;
    this.highI = 0;
    this.highQ = 0;
    this.sumSquares = 0;
    this.clipped = false;
  }

  resetBucket() {
    this.count = 0;
    this.carrierI = 0;
    this.carrierQ = 0;
    this.lowI = 0;
    this.lowQ = 0;
    this.highI = 0;
    this.highQ = 0;
    this.sumSquares = 0;
    this.clipped = false;
  }

  process(inputs, outputs) {
    for (const output of outputs) {
      for (const channel of output) {
        channel.fill(0);
      }
    }

    const input = inputs[0]?.[0];
    if (!input) {
      return true;
    }

    const carrierStep = TWO_PI * this.frequencyHz / sampleRate;
    const lowStep = TWO_PI
      * (this.frequencyHz - SIDEBAND_OFFSET_HZ) / sampleRate;
    const highStep = TWO_PI
      * (this.frequencyHz + SIDEBAND_OFFSET_HZ) / sampleRate;
    const bucketSize = Math.max(1, Math.round(sampleRate / TARGET_RATE_HZ));

    for (const sample of input) {
      this.carrierI += sample * Math.cos(this.carrierPhase);
      this.carrierQ -= sample * Math.sin(this.carrierPhase);
      this.lowI += sample * Math.cos(this.lowPhase);
      this.lowQ -= sample * Math.sin(this.lowPhase);
      this.highI += sample * Math.cos(this.highPhase);
      this.highQ -= sample * Math.sin(this.highPhase);
      this.sumSquares += sample * sample;
      this.clipped ||= Math.abs(sample) >= 0.98;
      this.count += 1;
      this.samplesProcessed += 1;

      this.carrierPhase = (this.carrierPhase + carrierStep) % TWO_PI;
      this.lowPhase = (this.lowPhase + lowStep) % TWO_PI;
      this.highPhase = (this.highPhase + highStep) % TWO_PI;

      if (this.count < bucketSize) {
        continue;
      }

      const scale = 2 / this.count;
      const lowMagnitude = Math.hypot(this.lowI, this.lowQ) * scale;
      const highMagnitude = Math.hypot(this.highI, this.highQ) * scale;
      this.port.postMessage({
        type: 'frame',
        generation: this.generation,
        frame: {
          timeMs: this.samplesProcessed * 1_000 / sampleRate,
          i: this.carrierI * scale,
          q: this.carrierQ * scale,
          sidebandMagnitude: (lowMagnitude + highMagnitude) / 2,
          broadbandRms: Math.sqrt(this.sumSquares / this.count),
          clipped: this.clipped,
        },
      });
      this.resetBucket();
    }

    return true;
  }
}

registerProcessor('breath-sonar-processor', BreathSonarProcessor);
