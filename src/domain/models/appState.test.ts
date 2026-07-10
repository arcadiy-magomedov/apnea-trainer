import { describe, it, expect } from 'vitest';
import { defaultMicrocycle, emptyAppState } from './appState';

describe('emptyAppState', () => {
  it('creates a complete v2 state with split difficulty and no goal', () => {
    const s = emptyAppState();
    expect(s.version).toBe(2);
    expect(s.goal).toBeNull();
    expect(s.courseState.difficultyByType).toEqual({ CO2: 0, O2: 0 });
    expect(s.courseState.microcycleProfile).toBe('balanced');
    expect(s.courseState.pendingMicrocycleProfile).toBeNull();
    expect(s.courseState.profileLockedUntil).toBeNull();
    expect(s.baselines).toEqual([]);
    expect(s.sessions).toEqual([]);
    expect(s.settings.theme).toBe('ocean');
    expect(s.courseState.position).toBe(0);
    expect(s.courseState.template.days).toHaveLength(7);
  });

  it('default microcycle uses the CO2, REST, O2, REST, CO2, O2, REST pattern', () => {
    expect(defaultMicrocycle().days).toEqual([
      'CO2', 'REST', 'O2', 'REST', 'CO2', 'O2', 'REST',
    ]);
  });
});
