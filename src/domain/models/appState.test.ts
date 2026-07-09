import { describe, it, expect } from 'vitest';
import { defaultMicrocycle, emptyAppState } from './appState';

describe('emptyAppState', () => {
  it('has version 1 and sane defaults', () => {
    const s = emptyAppState();
    expect(s.version).toBe(1);
    expect(s.baselines).toEqual([]);
    expect(s.sessions).toEqual([]);
    expect(s.settings.theme).toBe('ocean');
    expect(s.courseState.position).toBe(0);
    expect(s.courseState.difficultyLevel).toBe(0);
    expect(s.courseState.template.days).toHaveLength(7);
  });

  it('default microcycle biases toward CO2 and includes rest days', () => {
    expect(defaultMicrocycle().days).toEqual([
      'CO2', 'REST', 'O2', 'REST', 'CO2', 'O2', 'REST',
    ]);
  });
});
