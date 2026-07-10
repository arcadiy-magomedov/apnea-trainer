import { describe, it, expect } from 'vitest';
import * as domain from './index';

describe('domain barrel', () => {
  it('re-exports the public API', () => {
    expect(typeof domain.generateCo2Table).toBe('function');
    expect(typeof domain.generateO2Table).toBe('function');
    expect(typeof domain.generatePlanForDay).toBe('function');
    expect(typeof domain.applyTapOut).toBe('function');
    expect(typeof domain.evaluateTypeProgression).toBe('function');
    expect(typeof domain.updateMicrocycleProfile).toBe('function');
    expect(typeof domain.goalForecast).toBe('function');
    expect(typeof domain.assessmentSchedule).toBe('function');
    expect(typeof domain.resolveToday).toBe('function');
    expect(typeof domain.completeSession).toBe('function');
    expect(typeof domain.computeBaseline).toBe('function');
    expect(typeof domain.emptyAppState).toBe('function');
  });
});
