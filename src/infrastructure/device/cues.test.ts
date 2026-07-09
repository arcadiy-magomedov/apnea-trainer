import { describe, it, expect, vi } from 'vitest';
import { createCues } from './cues';

describe('createCues', () => {
  it('speaks via speechSynthesis when available', () => {
    const speak = vi.fn();
    const win = {
      speechSynthesis: { speak },
      SpeechSynthesisUtterance: class {
        text: string;
        constructor(text: string) { this.text = text; }
      },
    } as unknown as Window;
    createCues(win, {} as Navigator).speak('Hold');
    expect(speak).toHaveBeenCalled();
  });

  it('vibrates via navigator.vibrate when available', () => {
    const vibrate = vi.fn();
    const nav = { vibrate } as unknown as Navigator;
    createCues({} as Window, nav).vibrate([100, 50]);
    expect(vibrate).toHaveBeenCalledWith([100, 50]);
  });

  it('is a no-op when APIs are missing (does not throw)', () => {
    const cues = createCues({} as Window, {} as Navigator);
    expect(() => { cues.speak('x'); cues.beep(); cues.vibrate([10]); cues.prime(); }).not.toThrow();
  });

  it('prime resumes a suspended AudioContext and speech synthesis', () => {
    const resume = vi.fn();
    const synthResume = vi.fn();
    class MockAudioContext { state = 'suspended'; resume = resume; }
    const win = {
      AudioContext: MockAudioContext,
      speechSynthesis: { resume: synthResume, speak: vi.fn() },
    } as unknown as Window;
    createCues(win, {} as Navigator).prime();
    expect(resume).toHaveBeenCalled();
    expect(synthResume).toHaveBeenCalled();
  });
});