export interface CueService {
  speak(text: string): void;
  beep(): void;
  vibrate(pattern: number[]): void;
}
