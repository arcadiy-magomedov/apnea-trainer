import type { CueService } from '../../domain/ports/cueService';

export function createCues(win: Window = window, nav: Navigator = navigator): CueService {
  let audioCtx: AudioContext | null = null;
  return {
    speak(text: string) {
      const synth = (win as Window & { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
      const Utter = (win as Window & { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance }).SpeechSynthesisUtterance;
      if (!synth || !Utter) return;
      synth.speak(new Utter(text));
    },
    beep() {
      const Ctx = (win as Window & { AudioContext?: typeof AudioContext }).AudioContext;
      if (!Ctx) return;
      audioCtx ??= new Ctx();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.1;
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);
    },
    vibrate(pattern: number[]) {
      if (typeof nav.vibrate === 'function') nav.vibrate(pattern);
    },
  };
}