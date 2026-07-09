import { useServices } from '../app/services';
import { useAppStore } from '../app/stores';

export function useCues() {
  const { cues } = useServices();
  const settings = useAppStore((s) => s.state.settings);
  return {
    phaseCue(text: string) {
      if (settings.voiceCues) cues.speak(text);
      if (settings.beepCues) cues.beep();
      if (settings.vibrationCues) cues.vibrate([120]);
    },
  };
}
