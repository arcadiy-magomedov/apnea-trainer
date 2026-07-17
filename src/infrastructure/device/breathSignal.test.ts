import { describe, expect, it } from 'vitest';
import {
  BreathSignalProcessor,
  scoreCarrier,
  selectCarrier,
  unwrapPhase,
} from './breathSignal';
import type { DemodulatedFrame } from './breathSonarTypes';

function frame(
  timeMs: number,
  phaseRad: number,
  carrierMagnitude: number,
  sidebandMagnitude: number,
  clipped = false,
) {
  return {
    timeMs,
    i: Math.cos(phaseRad) * carrierMagnitude,
    q: Math.sin(phaseRad) * carrierMagnitude,
    sidebandMagnitude,
    broadbandRms: carrierMagnitude + sidebandMagnitude,
    clipped,
  };
}

function phaseFrame(
  timeMs: number,
  phaseRad: number,
  broadbandRms = 0.05,
  clipped = false,
): DemodulatedFrame {
  return {
    timeMs,
    i: Math.cos(phaseRad) * 0.2,
    q: Math.sin(phaseRad) * 0.2,
    sidebandMagnitude: 0.01,
    broadbandRms,
    clipped,
  };
}

function feedRamp(
  processor: BreathSignalProcessor,
  fromMs: number,
  fromPhase: number,
  toPhase: number,
  frames = 80,
  broadbandRms = 0.05,
) {
  let output = processor.ingest(phaseFrame(
    fromMs,
    fromPhase,
    broadbandRms,
  ));

  for (let index = 1; index < frames; index += 1) {
    const ratio = index / (frames - 1);
    output = processor.ingest(phaseFrame(
      fromMs + index * 50,
      fromPhase + (toPhase - fromPhase) * ratio,
      broadbandRms,
    ));
  }

  return output;
}

function calibrate(
  processor: BreathSignalProcessor,
  direction: 1 | -1 = 1,
): boolean {
  processor.beginCalibrationStage('still');
  feedRamp(processor, 0, 0, 0.005 * direction);
  processor.beginCalibrationStage('inhale');
  feedRamp(processor, 4_000, 0.005 * direction, 0.6 * direction);
  processor.beginCalibrationStage('exhale');
  feedRamp(processor, 8_000, 0.6 * direction, 0.02 * direction);
  return processor.completeCalibration();
}

function feedCalibrationStage(
  processor: BreathSignalProcessor,
  stage: 'still' | 'inhale' | 'exhale',
  fromMs: number,
  fromPhase: number,
  toPhase: number,
  frames = 80,
) {
  processor.beginCalibrationStage(stage);
  return feedRamp(processor, fromMs, fromPhase, toPhase, frames);
}

function calibratedProcessor(direction: 1 | -1 = 1) {
  const processor = new BreathSignalProcessor(20);
  processor.setCarrierSnrDb(30);
  if (!calibrate(processor, direction)) {
    throw new Error('Synthetic calibration failed');
  }
  return processor;
}

function labelInhale(
  processor: BreathSignalProcessor,
  fromMs = 12_000,
  direction: 1 | -1 = 1,
) {
  return feedRamp(processor, fromMs, 0.02 * direction, 0.8 * direction, 40);
}

describe('breathSignal', () => {
  it('unwrapPhase preserves continuity when wrapping upward across +pi', () => {
    expect(unwrapPhase(3.0, -3.0)).toBeCloseTo(3.283185307, 6);
  });

  it('unwrapPhase preserves continuity when wrapping downward across -pi', () => {
    expect(unwrapPhase(-3.0, 3.0)).toBeCloseTo(-3.283185307, 6);
  });

  it('scores carrier and noise from i/q magnitude and sideband magnitude', () => {
    const score = scoreCarrier([
      frame(0, 0.0, 2, 0.5),
      frame(10, 0.1, 2, 0.5),
      frame(20, 0.2, 2, 0.5),
    ]);

    expect(score).toMatchObject({
      snrDb: expect.closeTo(12.041199826, 6),
      phaseJitterRad: expect.any(Number),
      clippedRatio: 0,
      valid: true,
    });
    expect(score).not.toHaveProperty('carrierMagnitude');
    expect(score).not.toHaveProperty('adjacentBandNoise');
  });

  it('rejects insufficient SNR', () => {
    const score = scoreCarrier([
      frame(0, 0.0, 1.0, 0.4),
      frame(10, 0.1, 1.0, 0.4),
      frame(20, 0.2, 1.0, 0.4),
    ]);

    expect(score.valid).toBe(false);
    expect(score.snrDb).toBeLessThan(12);
  });

  it.each([
    ['NaN sidebandMagnitude', Number.NaN, 2.5],
    ['negative sidebandMagnitude', -0.5, 1.5],
  ])('rejects %s', (_label, sidebandMagnitude, broadbandRms) => {
    const score = scoreCarrier([
      {
        timeMs: 0,
        i: 2,
        q: 0,
        sidebandMagnitude,
        broadbandRms,
        clipped: false,
      },
      {
        timeMs: 10,
        i: 2,
        q: 0,
        sidebandMagnitude,
        broadbandRms,
        clipped: false,
      },
    ]);

    expect(score.valid).toBe(false);
  });

  it('rejects a loud clipped carrier', () => {
    const score = scoreCarrier([
      frame(0, 0.0, 4, 0.2, true),
      frame(10, 0.05, 4, 0.2, true),
      frame(20, 0.1, 4, 0.2, true),
      frame(30, 0.15, 4, 0.2, false),
      frame(40, 0.2, 4, 0.2, false),
    ]);

    expect(score.valid).toBe(false);
    expect(score.clippedRatio).toBeGreaterThan(0.02);
  });

  it('selects the strongest valid 19 kHz carrier and returns a flat score shape', () => {
    const selected = selectCarrier([
      {
        frequencyHz: 21000,
        frames: [
          frame(0, 0.0, 30, 0.3, true),
          frame(10, 0.05, 30, 0.3, true),
          frame(20, 0.1, 30, 0.3, false),
          frame(30, 0.15, 30, 0.3, false),
          frame(40, 0.2, 30, 0.3, false),
        ],
      },
      {
        frequencyHz: 18000,
        frames: [
          frame(0, 0.0, 10, 0.8),
          frame(10, 0.08, 10, 0.8),
          frame(20, 0.16, 10, 0.8),
          frame(30, 0.24, 10, 0.8),
        ],
      },
      {
        frequencyHz: 19000,
        frames: [
          frame(0, 0.0, 12, 0.4),
          frame(10, 0.07, 12, 0.4),
          frame(20, 0.14, 12, 0.4),
          frame(30, 0.21, 12, 0.4),
        ],
      },
    ]);

    expect(selected?.frequencyHz).toBe(19000);
    expect(selected).toMatchObject({
      frequencyHz: 19000,
      valid: true,
      snrDb: expect.any(Number),
      phaseJitterRad: expect.any(Number),
      clippedRatio: expect.any(Number),
    });
    expect(selected).not.toHaveProperty('score');
    expect(selected).not.toHaveProperty('frames');
  });

  it('returns null when no candidate passes', () => {
    expect(
      selectCarrier([
        {
          frequencyHz: 18000,
          frames: [
            frame(0, 0.0, 1.1, 0.6),
            frame(10, 0.08, 1.1, 0.6),
            frame(20, 0.16, 1.1, 0.6),
          ],
        },
        {
          frequencyHz: 19000,
          frames: [
            frame(0, 0.0, 25, 0.2, true),
            frame(10, 0.05, 25, 0.2, true),
            frame(20, 0.1, 25, 0.2, true),
          ],
        },
      ]),
    ).toBeNull();
  });

  describe('BreathSignalProcessor', () => {
    it('calibrates opposite inhale and exhale directions', () => {
      const processor = new BreathSignalProcessor(20);
      processor.setCarrierSnrDb(24);

      expect(calibrate(processor)).toBe(true);
    });

    it('learns the still broadband baseline before detecting spikes', () => {
      const processor = new BreathSignalProcessor(20);
      processor.beginCalibrationStage('still');
      feedRamp(processor, 0, 0, 0.005, 80, 1);
      processor.beginCalibrationStage('inhale');
      feedRamp(processor, 4_000, 0.005, 0.6, 80, 1);
      processor.beginCalibrationStage('exhale');
      feedRamp(processor, 8_000, 0.6, 0.02, 80, 1);

      expect(processor.completeCalibration()).toBe(true);
      expect(processor.ingest(phaseFrame(12_000, 0.02, 6.1)).movement)
        .toBe(true);
    });

    it('does not let the first still broadband sample dominate the baseline', () => {
      const processor = new BreathSignalProcessor(20);
      processor.beginCalibrationStage('still');

      expect(processor.ingest(phaseFrame(0, 0, 10)).movement).toBe(false);
      for (let index = 1; index < 5; index += 1) {
        expect(processor.ingest(phaseFrame(index * 50, 0, 1)).movement)
          .toBe(false);
      }

      expect(processor.ingest(phaseFrame(250, 0, 6.1)).movement).toBe(true);
    });

    it.each([
      [
        'clipping during still',
        'still',
        (timeMs: number, phase: number) => phaseFrame(
          timeMs,
          phase,
          0.05,
          true,
        ),
      ],
      [
        'a phase jump during inhale',
        'inhale',
        (timeMs: number, phase: number) => phaseFrame(
          timeMs,
          phase + 2,
        ),
      ],
      [
        'a broadband spike during exhale',
        'exhale',
        (timeMs: number, phase: number) => phaseFrame(
          timeMs,
          phase,
          0.31,
        ),
      ],
    ] as const)(
      'rejects calibration after %s',
      (_label, movementStage, movementFrame) => {
        const processor = new BreathSignalProcessor(20);
        processor.beginCalibrationStage('still');
        feedRamp(processor, 0, 0, 0.005);
        if (movementStage === 'still') {
          processor.ingest(movementFrame(4_000, 0.005));
        }

        processor.beginCalibrationStage('inhale');
        feedRamp(processor, 4_050, 0.005, 0.6);
        if (movementStage === 'inhale') {
          processor.ingest(movementFrame(8_050, 0.6));
        }

        processor.beginCalibrationStage('exhale');
        feedRamp(processor, 8_100, 0.6, 0.02);
        if (movementStage === 'exhale') {
          processor.ingest(movementFrame(12_100, 0.02));
        }

        expect(processor.completeCalibration()).toBe(false);
      },
    );

    it.each([
      ['still', ['inhale', 'exhale']],
      ['inhale', ['still', 'exhale']],
      ['exhale', ['still', 'inhale']],
    ] as const)(
      'rejects calibration when %s was not explicitly started',
      (_missingStage, stages) => {
        const processor = new BreathSignalProcessor(20);
        for (const stage of stages) {
          if (stage === 'still') {
            feedCalibrationStage(processor, stage, 0, 0, 0.005);
          } else if (stage === 'inhale') {
            feedCalibrationStage(processor, stage, 4_000, 0.005, 0.6);
          } else {
            feedCalibrationStage(processor, stage, 8_000, 0.6, 0.02);
          }
        }

        expect(processor.completeCalibration()).toBe(false);
      },
    );

    it.each([
      ['still', 1, 80, 80],
      ['inhale', 80, 1, 80],
      ['exhale', 80, 80, 1],
    ] as const)(
      'rejects calibration when %s is undersampled',
      (_stage, stillFrames, inhaleFrames, exhaleFrames) => {
        const processor = new BreathSignalProcessor(20);
        feedCalibrationStage(
          processor,
          'still',
          0,
          0,
          0.005,
          stillFrames,
        );
        feedCalibrationStage(
          processor,
          'inhale',
          4_000,
          0.005,
          0.6,
          inhaleFrames,
        );
        feedCalibrationStage(
          processor,
          'exhale',
          8_000,
          0.6,
          0.02,
          exhaleFrames,
        );

        expect(processor.completeCalibration()).toBe(false);
      },
    );

    it('clears calibration movement when a new still stage begins', () => {
      const processor = new BreathSignalProcessor(20);
      processor.beginCalibrationStage('still');
      feedRamp(processor, 0, 0, 0.005);
      processor.ingest(phaseFrame(4_000, 0.005, 0.05, true));

      expect(calibrate(processor)).toBe(true);
    });

    it.each([
      ['flat motion', 0.005, 0.01, 0.005],
      ['same-direction motion', 0.005, 0.6, 1.2],
    ])('rejects %s calibration', (_label, stillEnd, inhaleEnd, exhaleEnd) => {
      const processor = new BreathSignalProcessor(20);
      processor.beginCalibrationStage('still');
      feedRamp(processor, 0, 0, stillEnd);
      processor.beginCalibrationStage('inhale');
      feedRamp(processor, 4_000, stillEnd, inhaleEnd);
      processor.beginCalibrationStage('exhale');
      feedRamp(processor, 8_000, inhaleEnd, exhaleEnd);

      expect(processor.completeCalibration()).toBe(false);
      expect(feedRamp(processor, 12_000, exhaleEnd, exhaleEnd + 0.8, 40).phase)
        .toBeNull();
    });

    it('inverts polarity when calibrated inhale decreases', () => {
      const processor = calibratedProcessor(-1);

      const output = labelInhale(processor, 12_000, -1);

      expect(output.phase).toBe('inhale');
    });

    it('removes inverted calibration points before emitting live waveform data', () => {
      const processor = calibratedProcessor(-1);

      const output = processor.ingest(phaseFrame(12_000, -0.02));

      expect(output.waveform.map((point) => point.timeMs)).toEqual([12_000]);
    });

    it('reports inhale then exhale after 500 ms hysteresis', () => {
      const processor = calibratedProcessor();

      let output = labelInhale(processor);
      expect(output.phase).toBe('inhale');

      output = feedRamp(processor, 14_000, 0.8, 0.02, 40);
      expect(output.phase).toBe('exhale');
    });

    it('requires a positive still-stage carrier baseline', () => {
      const processor = new BreathSignalProcessor(20);
      processor.setCarrierSnrDb(30);
      processor.beginCalibrationStage('still');
      for (let index = 0; index < 80; index += 1) {
        processor.ingest(frame(index * 50, 0, 0, 0.01));
      }
      processor.beginCalibrationStage('inhale');
      feedRamp(processor, 4_000, 0, 0.6);
      processor.beginCalibrationStage('exhale');
      feedRamp(processor, 8_000, 0.6, 0.02);

      expect(processor.completeCalibration()).toBe(false);
    });

    it('ends poor and finite after ten seconds without a carrier', () => {
      const processor = calibratedProcessor();
      expect(labelInhale(processor).phase).toBe('inhale');

      let output = processor.ingest(frame(14_000, 0, 0, 0.01));
      for (let index = 1; index < 200; index += 1) {
        output = processor.ingest(frame(
          14_000 + index * 50,
          0,
          0,
          0.01,
        ));
      }

      expect(output).toMatchObject({
        phase: null,
        quality: 'poor',
        qualityScore: 0,
        movement: false,
      });
      expect(Number.isFinite(output.carrierSnrDb)).toBe(true);
      expect(Number.isFinite(output.phaseAmplitude)).toBe(true);
      expect(output.waveform.every((point) => (
        Number.isFinite(point.timeMs)
        && Number.isFinite(point.value)
      ))).toBe(true);
    });

    it('rejects severe live carrier attenuation despite stable phase', () => {
      const processor = calibratedProcessor();
      let output = processor.ingest(frame(12_000, 0.02, 0.019, 0.001));

      for (let index = 1; index < 20; index += 1) {
        output = processor.ingest(frame(
          12_000 + index * 50,
          0.02 + index * 0.02,
          0.019,
          0.001,
        ));
      }

      expect(output).toMatchObject({
        phase: null,
        quality: 'poor',
        qualityScore: 0,
        movement: false,
      });
    });

    it('rejects low live carrier SNR', () => {
      const processor = calibratedProcessor();
      let output = processor.ingest({
        ...frame(12_000, 0.02, 0.2, 0.12),
        broadbandRms: 0.05,
      });

      for (let index = 1; index < 20; index += 1) {
        output = processor.ingest({
          ...frame(
            12_000 + index * 50,
            0.02 + index * 0.02,
            0.2,
            0.12,
          ),
          broadbandRms: 0.05,
        });
      }

      expect(output).toMatchObject({
        phase: null,
        quality: 'poor',
        qualityScore: 0,
        movement: false,
      });
      expect(output.carrierSnrDb).toBeLessThan(6);
    });

    it('rejects sustained flat phase without breathing amplitude', () => {
      const processor = calibratedProcessor();
      expect(labelInhale(processor).phase).toBe('inhale');

      let output = processor.ingest(phaseFrame(14_000, 0.8));
      for (let index = 1; index < 400; index += 1) {
        output = processor.ingest(phaseFrame(
          14_000 + index * 50,
          0.8,
        ));
      }

      expect(output).toMatchObject({
        phase: null,
        quality: 'poor',
        qualityScore: 0,
        movement: false,
      });
    });

    it('suppresses a brief loss and clears stale phase after sustained loss', () => {
      const processor = calibratedProcessor();
      expect(labelInhale(processor).phase).toBe('inhale');

      let output = processor.ingest(frame(14_000, 0.8, 0, 0.01));
      for (let index = 1; index < 20; index += 1) {
        output = processor.ingest(frame(
          14_000 + index * 50,
          0.8,
          0,
          0.01,
        ));
      }
      expect(output).toMatchObject({
        phase: null,
        quality: 'poor',
        qualityScore: 0,
      });

      for (let index = 20; index < 45; index += 1) {
        output = processor.ingest(frame(
          14_000 + index * 50,
          0.8,
          0,
          0.01,
        ));
      }

      for (let index = 0; index < 10; index += 1) {
        output = processor.ingest(phaseFrame(
          16_250 + index * 50,
          0.8 + index * 0.04,
        ));
      }
      expect(output.phase).toBeNull();

      for (let index = 10; index < 26; index += 1) {
        output = processor.ingest(phaseFrame(
          16_250 + index * 50,
          0.8 + index * 0.04,
        ));
      }
      expect(output.phase).toBe('inhale');
    });

    it('rebases sustained signal loss before recovering at an unrelated phase', () => {
      const processor = calibratedProcessor();
      expect(labelInhale(processor).phase).toBe('inhale');

      for (let index = 0; index < 45; index += 1) {
        processor.ingest(frame(
          14_000 + index * 50,
          0,
          0,
          0.01,
        ));
      }

      let output = processor.ingest(phaseFrame(16_250, 2));
      expect(output).toMatchObject({
        phase: null,
        movement: false,
      });

      for (let index = 1; index < 10; index += 1) {
        output = processor.ingest(phaseFrame(
          16_250 + index * 50,
          2 + index * 0.04,
        ));
      }
      expect(output.phase).toBeNull();

      for (let index = 10; index < 26; index += 1) {
        output = processor.ingest(phaseFrame(
          16_250 + index * 50,
          2 + index * 0.04,
        ));
      }
      expect(output).toMatchObject({
        phase: 'inhale',
        movement: false,
      });
    });

    it('markSignalLost forces full phase reacquisition', () => {
      const processor = calibratedProcessor();
      expect(labelInhale(processor).phase).toBe('inhale');

      processor.markSignalLost();

      let output = processor.ingest(phaseFrame(14_000, 0.8));
      for (let index = 1; index < 10; index += 1) {
        output = processor.ingest(phaseFrame(
          14_000 + index * 50,
          0.8 + index * 0.04,
        ));
      }
      expect(output.phase).toBeNull();

      for (let index = 10; index < 26; index += 1) {
        output = processor.ingest(phaseFrame(
          14_000 + index * 50,
          0.8 + index * 0.04,
        ));
      }
      expect(output.phase).toBe('inhale');
    });

    it('does not treat the first valid phase frame as movement', () => {
      const processor = new BreathSignalProcessor(20);

      const output = processor.ingest(phaseFrame(0, 2.8));

      expect(output.movement).toBe(false);
    });

    it.each([
      ['clipping', (timeMs: number, phase: number) => phaseFrame(timeMs, phase, 0.05, true)],
      ['phase jump', (timeMs: number) => phaseFrame(timeMs, 2.6)],
      ['broadband spike', (timeMs: number, phase: number) => phaseFrame(timeMs, phase, 0.4)],
    ])('%s suppresses breath labels', (_label, movementFrame) => {
      const processor = calibratedProcessor();
      const inhale = labelInhale(processor);

      const output = processor.ingest(movementFrame(14_000, 0.8));

      expect(inhale.phase).toBe('inhale');
      expect(output).toMatchObject({
        phase: null,
        quality: 'poor',
        qualityScore: 0,
        movement: true,
      });
    });

    it('recovers after one stable second following movement', () => {
      const processor = calibratedProcessor();
      labelInhale(processor);
      processor.ingest(phaseFrame(14_000, 0.8, 0.05, true));

      let output = processor.ingest(phaseFrame(14_050, 0.8));
      for (let index = 2; index <= 20; index += 1) {
        output = processor.ingest(phaseFrame(14_000 + index * 50, 0.8));
      }

      expect(output.movement).toBe(false);
      expect(output.qualityScore).toBeGreaterThan(0);
    });

    it('clears phase on movement and reacquires only after hysteresis', () => {
      const processor = calibratedProcessor();
      expect(labelInhale(processor).phase).toBe('inhale');
      processor.ingest(phaseFrame(14_000, 0.8, 0.05, true));

      let output = processor.ingest(phaseFrame(14_050, 0.8));
      for (let index = 2; index <= 20; index += 1) {
        output = processor.ingest(phaseFrame(14_000 + index * 50, 0.8));
      }
      expect(output).toMatchObject({
        movement: false,
        phase: null,
      });

      for (let index = 1; index <= 10; index += 1) {
        output = processor.ingest(phaseFrame(
          15_000 + index * 50,
          0.8 + index * 0.04,
        ));
      }
      expect(output.phase).toBeNull();

      for (let index = 11; index <= 25; index += 1) {
        output = processor.ingest(phaseFrame(
          15_000 + index * 50,
          0.8 + index * 0.04,
        ));
      }
      expect(output.phase).toBe('inhale');
    });

    it('keeps healthy live signal capable of good and fair quality', () => {
      const processor = calibratedProcessor();
      const good = labelInhale(processor);

      processor.setCarrierSnrDb(0);
      let fair = processor.ingest(frame(14_000, 0.8, 0.2, 0.05));
      for (let index = 1; index < 20; index += 1) {
        fair = processor.ingest(frame(
          14_000 + index * 50,
          0.8 + index * 0.02,
          0.2,
          0.05,
        ));
      }

      expect(good.qualityScore).toBeGreaterThanOrEqual(0.7);
      expect(good.quality).toBe('good');
      expect(fair.qualityScore).toBeGreaterThanOrEqual(0.45);
      expect(fair.qualityScore).toBeLessThan(0.7);
      expect(fair.quality).toBe('fair');
      expect(Number.isFinite(good.carrierSnrDb)).toBe(true);
      expect(Number.isFinite(fair.carrierSnrDb)).toBe(true);
    });

    it.each([
      ['timeMs', { timeMs: Number.NaN }],
      ['i', { i: Number.NaN }],
      ['q', { q: Number.POSITIVE_INFINITY }],
      ['sidebandMagnitude', { sidebandMagnitude: Number.NaN }],
      ['broadbandRms', { broadbandRms: Number.NEGATIVE_INFINITY }],
    ])('keeps output finite for corrupted %s', (_label, override) => {
      const processor = calibratedProcessor();
      const corrupted = { ...phaseFrame(12_000, 0.1), ...override };

      const output = processor.ingest(corrupted);

      expect(output).toMatchObject({
        phase: null,
        quality: 'poor',
        qualityScore: 0,
        movement: true,
      });
      expect(Number.isFinite(output.carrierSnrDb)).toBe(true);
      expect(Number.isFinite(output.phaseAmplitude)).toBe(true);
      expect(output.waveform.every((point) => (
        Number.isFinite(point.timeMs)
        && Number.isFinite(point.value)
      ))).toBe(true);
    });

    it('resets calibration and live phase when a new still stage begins', () => {
      const processor = calibratedProcessor();
      expect(labelInhale(processor).phase).toBe('inhale');

      processor.beginCalibrationStage('still');
      const output = feedRamp(processor, 14_000, 0.8, 0.805);

      expect(output.phase).toBeNull();
      expect(processor.completeCalibration()).toBe(false);
    });

    it('keeps a normalized waveform bounded to the latest 20 seconds', () => {
      const processor = new BreathSignalProcessor(20);
      let output = processor.ingest(phaseFrame(0, 0));

      for (let index = 1; index <= 500; index += 1) {
        output = processor.ingest(phaseFrame(
          index * 50,
          Math.sin(index / 20),
        ));
      }

      expect(output.waveform.at(-1)!.timeMs - output.waveform[0].timeMs)
        .toBeLessThanOrEqual(20_000);
      expect(output.waveform.length).toBeLessThanOrEqual(401);
      expect(output.waveform.every((point) => (
        Number.isFinite(point.value)
        && point.value >= -1
        && point.value <= 1
      ))).toBe(true);
    });
  });
});
