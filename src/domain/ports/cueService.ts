export interface CueService {
  speak(text: string): void;
  beep(frequencyHz?: number, durationMs?: number): void;
  vibrate(pattern: number[]): void;
  prime(): void;
}
