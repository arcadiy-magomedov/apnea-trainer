import type { CueService } from '../../domain/ports/cueService';

type SpeechWindow = Window & {
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
  AudioContext?: typeof AudioContext;
};

export function createCues(win: Window = window, nav: Navigator = navigator): CueService {
  const w = win as SpeechWindow;
  let audioCtx: AudioContext | null = null;

  function ctx(): AudioContext | null {
    if (!w.AudioContext) return null;
    audioCtx ??= new w.AudioContext();
    return audioCtx;
  }

  return {
    speak(text: string) {
      if (!w.speechSynthesis || !w.SpeechSynthesisUtterance) return;
      const utter = new w.SpeechSynthesisUtterance(text);
      // Force English regardless of the device locale (e.g. a Czech phone).
      utter.lang = 'en-US';
      const enVoice = (w.speechSynthesis.getVoices?.() ?? [])
        .find((v) => v.lang?.toLowerCase().startsWith('en'));
      if (enVoice) utter.voice = enVoice;
      w.speechSynthesis.speak(utter);
    },
    beep(frequencyHz = 880, durationMs = 150) {
      const audio = ctx();
      if (!audio) return;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = frequencyHz;
      gain.gain.value = 0.1;
      osc.connect(gain).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + durationMs / 1000);
    },
    vibrate(pattern: number[]) {
      if (typeof nav.vibrate === 'function') nav.vibrate(pattern);
    },
    prime() {
      // Must run inside a user gesture: unlocks audio on iOS/Safari where the
      // AudioContext starts suspended and speech is gated until first interaction.
      const audio = ctx();
      if (audio && audio.state === 'suspended') void audio.resume();
      w.speechSynthesis?.resume?.();
    },
  };
}
