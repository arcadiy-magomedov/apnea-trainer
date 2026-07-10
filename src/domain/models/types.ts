// SessionType: what kind of training a session is.
export type SessionType = 'CO2' | 'O2' | 'MAX';
export type TrainingSessionType = Exclude<SessionType, 'MAX'>;
// DayType: what a course microcycle slot prescribes.
export type DayType = 'CO2' | 'O2' | 'REST' | 'MAX';
// Rpe: subjective rate of perceived exertion collected after a session.
export type Rpe = 'easy' | 'normal' | 'hard' | 'failed';
export type SessionQuality = 'clean' | 'strained' | 'failed';
// ProgressionAction: what the adaptation engine decides between sessions.
export type ProgressionAction = 'progress' | 'repeat' | 'deload';
export type MicrocycleProfile = 'co2-heavy' | 'balanced' | 'o2-heavy';

export interface Goal {
  id: string;
  targetHoldSec: number;
  createdAt: number;
  startMaxSec: number;
  achievedAt: number | null;
}

export interface Baseline {
  id: string;
  maxHoldSec: number;
  firstContractionSec: number | null;
  measuredAt: number; // epoch ms
}

export interface RoundPlan {
  index: number;
  targetHoldSec: number;
  restBeforeSec: number; // recovery before this round's hold (round 0 = 0)
}

export interface RoundResult {
  index: number;
  targetHoldSec: number;
  achievedHoldSec: number;
  restBeforeSec: number;
  contractions: number;
  firstContractionSec: number | null;
  tappedOut: boolean;
}

export interface SessionPlan {
  type: SessionType;
  rounds: RoundPlan[];
}

export interface InSessionAdjustment {
  reason: 'early-contractions' | 'tap-out';
  triggeredAtRoundIndex: number;
  restAddedSec: number;
  holdCapSec: number | null;
}

export interface Session {
  id: string;
  type: SessionType;
  rounds: RoundResult[];
  startedAt: number;
  finishedAt: number;
  completedRounds: number;
  tapOuts: number;
  rpe: Rpe | null;
  difficultyLevel: number;
  adjustment: InSessionAdjustment | null;
}

export interface DifficultyByType {
  CO2: number;
  O2: number;
}

export interface MicrocycleTemplate {
  days: DayType[]; // length 7
}

export interface CourseState {
  position: number; // index into template.days (advances by completion for training, by calendar for REST)
  difficultyByType: DifficultyByType;
  template: MicrocycleTemplate;
  microcycleProfile: MicrocycleProfile;
  pendingMicrocycleProfile: MicrocycleProfile | null;
  profileLockedUntil: number | null;
  lastTrainedAt: number | null; // epoch ms of last completed training session
  lastAdvanceAt: number | null; // epoch ms (start of day) of last position advance
  lastMaxTestAt: number | null; // epoch ms of last MAX recalibration
}

export interface Settings {
  units: 'metric';
  voiceCues: boolean;
  beepCues: boolean;
  vibrationCues: boolean;
  theme: 'ocean';
  reminderTimes: string[]; // 'HH:MM' 24h
  onboarded: boolean; // true once the safety disclaimer has been acknowledged
}

export interface AppState {
  version: 2;
  settings: Settings;
  baselines: Baseline[];
  courseState: CourseState;
  sessions: Session[];
  goal: Goal | null;
}

// Decisions returned by the domain (pure).
export interface TodayDecision {
  dayType: DayType;
  blocked: boolean;
  reason: string | null;
  deload: boolean;
  suggestRetest: boolean;
}

export interface ProgressionDecision {
  action: ProgressionAction;
  suggestRetest: boolean;
}
