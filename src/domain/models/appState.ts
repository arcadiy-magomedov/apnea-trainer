import type { AppState, MicrocycleTemplate } from './types';

export function defaultMicrocycle(): MicrocycleTemplate {
  return { days: ['CO2', 'REST', 'O2', 'REST', 'CO2', 'O2', 'REST'] };
}

export function emptyAppState(): AppState {
  return {
    version: 1,
    settings: {
      units: 'metric',
      voiceCues: true,
      beepCues: true,
      vibrationCues: true,
      theme: 'ocean',
      reminderTimes: [],
      onboarded: false,
    },
    baselines: [],
    courseState: {
      position: 0,
      difficultyLevel: 0,
      template: defaultMicrocycle(),
      lastTrainedAt: null,
      lastAdvanceAt: null,
      lastMaxTestAt: null,
    },
    sessions: [],
  };
}
