import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

interface WorkletMessage {
  type: string;
  generation?: number;
  frame?: {
    timeMs: number;
    i: number;
    q: number;
    sidebandMagnitude: number;
    broadbandRms: number;
    clipped: boolean;
  };
}

interface TestPort {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: ReturnType<typeof vi.fn<(message: WorkletMessage) => void>>;
}

interface TestProcessor {
  port: TestPort;
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

type ProcessorConstructor = new () => TestProcessor;

const TEST_SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const BUCKET_SIZE = TEST_SAMPLE_RATE / 20;
let processorConstructor: ProcessorConstructor;
let registeredName: string;

function createProcessor(): TestProcessor {
  return new processorConstructor();
}

function setFrequency(
  processor: TestProcessor,
  frequencyHz: number,
  generation = 1,
): void {
  processor.port.onmessage?.({
    data: { type: 'set-frequency', frequencyHz, generation },
  });
}

function processSamples(
  processor: TestProcessor,
  samples: Float32Array,
): void {
  for (let offset = 0; offset < samples.length; offset += BLOCK_SIZE) {
    const input = samples.slice(offset, offset + BLOCK_SIZE);
    processor.process([[input]], [[new Float32Array(input.length)]]);
  }
}

function sineWave(
  frequencyHz: number,
  sampleCount: number,
  amplitude = 0.5,
): Float32Array {
  return Float32Array.from(
    { length: sampleCount },
    (_, index) =>
      amplitude * Math.sin(2 * Math.PI * frequencyHz * index / TEST_SAMPLE_RATE),
  );
}

function postedFrames(processor: TestProcessor) {
  return postedFrameMessages(processor)
    .map((message) => message.frame)
    .filter((frame) => frame !== undefined);
}

function postedFrameMessages(processor: TestProcessor) {
  return processor.port.postMessage.mock.calls
    .map(([message]) => message)
    .filter((message) => message.type === 'frame');
}

beforeAll(async () => {
  class FakeAudioWorkletProcessor {
    readonly port: TestPort = {
      onmessage: null,
      postMessage: vi.fn(),
    };
  }

  vi.stubGlobal('AudioWorkletProcessor', FakeAudioWorkletProcessor);
  vi.stubGlobal(
    'registerProcessor',
    vi.fn((name: string, constructor: ProcessorConstructor) => {
      registeredName = name;
      processorConstructor = constructor;
    }),
  );
  vi.stubGlobal('sampleRate', TEST_SAMPLE_RATE);
  vi.stubGlobal('currentTime', 0);

  const workletUrl = pathToFileURL(resolve(
    'src/infrastructure/device/breathSonarWorklet.js',
  ));
  await import(/* @vite-ignore */ workletUrl.href);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('breathSonarWorklet', () => {
  it('registers the breath sonar processor', () => {
    expect(registeredName).toBe('breath-sonar-processor');
    expect(processorConstructor).toEqual(expect.any(Function));
  });

  it('accepts frequency changes and resets the current aggregation bucket', () => {
    const processor = createProcessor();
    processSamples(
      processor,
      sineWave(19_000, BUCKET_SIZE / 2),
    );

    setFrequency(processor, 18_000, 7);
    const newFrequencyBucket = sineWave(18_000, BUCKET_SIZE);
    processSamples(processor, newFrequencyBucket.slice(0, -1));
    expect(postedFrames(processor)).toHaveLength(0);

    processSamples(processor, newFrequencyBucket.slice(-1));

    const frames = postedFrames(processor);
    expect(frames).toHaveLength(1);
    expect(postedFrameMessages(processor)[0]).toMatchObject({
      type: 'frame',
      generation: 7,
    });
    expect(Math.hypot(frames[0].i, frames[0].q))
      .toBeGreaterThan(frames[0].sidebandMagnitude * 5);
  });

  it('writes silence and keeps the processor alive', () => {
    const processor = createProcessor();
    const output = new Float32Array(BLOCK_SIZE).fill(1);

    const active = processor.process(
      [[new Float32Array(BLOCK_SIZE).fill(0.25)]],
      [[output]],
    );

    expect(active).toBe(true);
    expect(output.every((sample) => sample === 0)).toBe(true);
  });

  it('emits finite sample-derived carrier frames at about 20 Hz', () => {
    const processor = createProcessor();
    setFrequency(processor, 19_000);
    processSamples(processor, sineWave(19_000, TEST_SAMPLE_RATE / 5));

    const frames = postedFrames(processor);
    expect(frames.length).toBeGreaterThanOrEqual(3);
    for (const frame of frames) {
      expect(Object.values(frame).every((value) =>
        typeof value === 'boolean' || Number.isFinite(value))).toBe(true);
      expect(Math.hypot(frame.i, frame.q))
        .toBeGreaterThan(frame.sidebandMagnitude * 5);
    }
    for (let index = 1; index < frames.length; index += 1) {
      expect(frames[index].timeMs).toBeGreaterThan(frames[index - 1].timeMs);
      expect(frames[index].timeMs - frames[index - 1].timeMs)
        .toBeCloseTo(50, 6);
    }
  });

  it.each([
    ['lower', 19_000 - 350],
    ['upper', 19_000 + 350],
  ])(
    'detects a strong %s sideband synthetic tone',
    (_sideband, toneFrequencyHz) => {
      const processor = createProcessor();
      setFrequency(processor, 19_000);
      processSamples(
        processor,
        sineWave(toneFrequencyHz, BUCKET_SIZE),
      );

      const frames = postedFrames(processor);
      expect(frames).toHaveLength(1);
      expect(Object.values(frames[0]).every((value) =>
        typeof value === 'boolean' || Number.isFinite(value))).toBe(true);
      expect(frames[0].sidebandMagnitude)
        .toBeGreaterThan(Math.hypot(frames[0].i, frames[0].q) * 3);
    },
  );

  it('marks an aggregation bucket containing clipped input', () => {
    const processor = createProcessor();
    const samples = sineWave(
      19_000,
      Math.round(TEST_SAMPLE_RATE / 20),
      0.5,
    );
    samples[100] = 1;
    processSamples(processor, samples);

    expect(postedFrames(processor)).toHaveLength(1);
    expect(postedFrames(processor)[0].clipped).toBe(true);
  });
});
