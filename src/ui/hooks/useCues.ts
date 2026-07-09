import type { RunnerPhase } from '../../application/stores/sessionRunnerStore';
import { useServices } from '../app/services';
import { useAppStore } from '../app/stores';

const LABEL: Record<RunnerPhase, string> = {
  breatheUp: 'Breathe up',
  hold: 'Hold',
  recover: 'Recover',
  done: 'Done',
};

/**
 * Settings-aware cue facade for the session runner.
 * - announce: speak the phase name (voice cues)
 * - warn:  a single beep ~10s before a hold starts / target is reached
 * - tick:  a single short beep for each of the final 3-2-1 seconds
 * - go:    a distinct beep at the moment the hold starts / target is reached
 */
export function useCues() {
  const { cues } = useServices();
  const settings = useAppStore((s) => s.state.settings);
  return {
    prime() {
      cues.prime();
    },
    announce(phase: RunnerPhase) {
      if (settings.voiceCues) cues.speak(LABEL[phase]);
    },
    warn() {
      if (settings.beepCues) cues.beep(880, 180);
      if (settings.vibrationCues) cues.vibrate([90, 50, 90]);
    },
    tick() {
      if (settings.beepCues) cues.beep(700, 120);
      if (settings.vibrationCues) cues.vibrate([60]);
    },
    go() {
      if (settings.beepCues) cues.beep(1100, 320);
      if (settings.vibrationCues) cues.vibrate([220]);
    },
  };
}
