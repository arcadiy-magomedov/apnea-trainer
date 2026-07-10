import { describe, it, expect } from 'vitest';
import { recordBaseline } from './recordBaseline';
import { saveSettings } from './saveSettings';
import { emptyAppState } from '../../domain/models/appState';
import { setGoal } from './manageGoal';
import { makeBaseline, makeState } from '../../test/fixtures';

describe('recordBaseline', () => {
  it('adds a baseline from best-of attempts and stamps the max-test clock', () => {
    const now = 1000;
    const next = recordBaseline(emptyAppState(), [180, 205, 190], 95, now);
    expect(next.baselines.at(-1)?.maxHoldSec).toBe(205);
    expect(next.baselines.at(-1)?.firstContractionSec).toBe(95);
    expect(next.courseState.lastMaxTestAt).toBe(now);
  });

  it('marks an active goal achieved from the new assessment', () => {
    const state = setGoal(makeState({
      baselines: [makeBaseline({ maxHoldSec: 180 })],
    }), 200, 1_000);

    const next = recordBaseline(state, [205], 90, 2_000);

    expect(next.goal?.achievedAt).toBe(2_000);
  });
});

describe('saveSettings', () => {
  it('merges partial settings', () => {
    const next = saveSettings(emptyAppState(), { voiceCues: false, reminderTimes: ['19:00'] });
    expect(next.settings.voiceCues).toBe(false);
    expect(next.settings.reminderTimes).toEqual(['19:00']);
    expect(next.settings.beepCues).toBe(true);
  });
});
