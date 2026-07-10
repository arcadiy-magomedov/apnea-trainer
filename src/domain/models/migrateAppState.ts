import type {
  AppState,
  Baseline,
  Goal,
  InSessionAdjustment,
  MicrocycleProfile,
  MicrocycleTemplate,
  RoundResult,
  Rpe,
  Session,
  SessionType,
  Settings,
} from './types';

type UnknownRecord = Record<string, unknown>;

type LegacyCourseState = {
  position: number;
  difficultyLevel: number;
  template: MicrocycleTemplate;
  lastTrainedAt: number | null;
  lastAdvanceAt: number | null;
  lastMaxTestAt: number | null;
};

type LegacyRoundResult = Omit<RoundResult, 'firstContractionSec'>;
type LegacySession = Omit<Session, 'adjustment' | 'rounds'> & { rounds: LegacyRoundResult[] };

type LegacyAppState = {
  version: 1;
  settings: Settings;
  baselines: Baseline[];
  courseState: LegacyCourseState;
  sessions: LegacySession[];
};

type BaseStateShape = UnknownRecord & {
  version?: unknown;
  settings: unknown;
  baselines: unknown;
  courseState: unknown;
  sessions: unknown;
};

const MICROCYCLE_PROFILES: readonly MicrocycleProfile[] = ['co2-heavy', 'balanced', 'o2-heavy'];
const SESSION_TYPES: readonly SessionType[] = ['CO2', 'O2', 'MAX'];
const RPES: readonly Rpe[] = ['easy', 'normal', 'hard', 'failed'];
const DAY_TYPES = new Set(['CO2', 'O2', 'REST', 'MAX']);
const ADJUSTMENT_REASONS: readonly InSessionAdjustment['reason'][] = ['early-contractions', 'tap-out'];

export function migrateAppState(value: unknown): AppState {
  assertBaseShape(value);

  if (value.version === 2) {
    assertV2Shape(value);
    return normalizeV2State(value);
  }

  if (value.version !== 1) {
    throw new Error(`Unsupported app state version: ${String(value.version)}`);
  }

  const legacyState = validateV1State(value);

  return {
    version: 2,
    settings: { ...legacyState.settings, reminderTimes: [...legacyState.settings.reminderTimes] },
    baselines: dedupeBaselines(legacyState.baselines),
    courseState: {
      position: legacyState.courseState.position,
      difficultyByType: {
        CO2: legacyState.courseState.difficultyLevel,
        O2: legacyState.courseState.difficultyLevel,
      },
      template: { days: [...legacyState.courseState.template.days] },
      microcycleProfile: 'balanced',
      pendingMicrocycleProfile: null,
      profileLockedUntil: null,
      lastTrainedAt: legacyState.courseState.lastTrainedAt,
      lastAdvanceAt: legacyState.courseState.lastAdvanceAt,
      lastMaxTestAt: legacyState.courseState.lastMaxTestAt,
    },
    sessions: legacyState.sessions.map((session) => ({
      ...session,
      rounds: session.rounds.map((round) => ({
        ...round,
        firstContractionSec: null,
      })),
      adjustment: null,
    })),
    goal: null,
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function assertBaseShape(value: unknown): asserts value is BaseStateShape {
  if (!isRecord(value)) {
    throw new Error('App state must be an object');
  }

  const missing: string[] = [];

  if (!isRecord(value.settings)) {
    missing.push('settings');
  }
  if (!Array.isArray(value.baselines)) {
    missing.push('baselines');
  }
  if (!isRecord(value.courseState)) {
    missing.push('courseState');
  }
  if (!Array.isArray(value.sessions)) {
    missing.push('sessions');
  }

  if (missing.length > 0) {
    throw new Error(`App state is missing required base fields: ${missing.join(', ')}`);
  }
}

function assertV2Shape(value: BaseStateShape): asserts value is UnknownRecord & AppState {
  if (!('goal' in value) || value.goal === undefined) {
    throw new Error('Invalid v2 app state: goal field is required');
  }

  validateSettings(value.settings, 'v2');
  validateBaselines(value.baselines, 'v2');
  validateV2CourseState(value.courseState, 'v2');
  validateV2Sessions(value.sessions, 'v2');
  validateGoal(value.goal);
}

function validateV1State(value: BaseStateShape): LegacyAppState {
  return {
    version: 1,
    settings: validateSettings(value.settings, 'v1'),
    baselines: validateBaselines(value.baselines, 'v1'),
    courseState: validateV1CourseState(value.courseState),
    sessions: validateV1Sessions(value.sessions),
  };
}

function validateSettings(value: unknown, version: 'v1' | 'v2'): Settings {
  const prefix = `Invalid ${version} app state: settings`;
  if (!isRecord(value)) {
    throw new Error(`${prefix} must be an object`);
  }

  if (value.units !== 'metric') {
    throw new Error(`${prefix}.units must be metric`);
  }

  if (typeof value.voiceCues !== 'boolean') {
    throw new Error(`${prefix}.voiceCues must be a boolean`);
  }

  if (typeof value.beepCues !== 'boolean') {
    throw new Error(`${prefix}.beepCues must be a boolean`);
  }

  if (typeof value.vibrationCues !== 'boolean') {
    throw new Error(`${prefix}.vibrationCues must be a boolean`);
  }

  if (value.theme !== 'ocean') {
    throw new Error(`${prefix}.theme must be ocean`);
  }

  if (!Array.isArray(value.reminderTimes) || value.reminderTimes.some((time) => typeof time !== 'string')) {
    throw new Error(`${prefix}.reminderTimes must be a string array`);
  }

  if (typeof value.onboarded !== 'boolean') {
    throw new Error(`${prefix}.onboarded must be a boolean`);
  }

  return {
    units: value.units,
    voiceCues: value.voiceCues,
    beepCues: value.beepCues,
    vibrationCues: value.vibrationCues,
    theme: value.theme,
    reminderTimes: [...value.reminderTimes],
    onboarded: value.onboarded,
  };
}

function validateBaselines(value: unknown, version: 'v1' | 'v2'): Baseline[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${version} app state: baselines must be an array`);
  }

  return value.map((baseline, index) => validateBaseline(baseline, `Invalid ${version} app state: baselines[${index}]`));
}

function validateBaseline(value: unknown, path: string): Baseline {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new Error(`${path}.id must be a non-empty string`);
  }

  if (!isFiniteNumber(value.maxHoldSec)) {
    throw new Error(`${path}.maxHoldSec must be a finite number`);
  }

  if (!('firstContractionSec' in value) || value.firstContractionSec === undefined) {
    throw new Error(`${path}.firstContractionSec field is required`);
  }

  if (value.firstContractionSec !== null && !isFiniteNumber(value.firstContractionSec)) {
    throw new Error(`${path}.firstContractionSec must be a finite number or null`);
  }

  if (!isFiniteNumber(value.measuredAt)) {
    throw new Error(`${path}.measuredAt must be a finite number`);
  }

  return {
    id: value.id,
    maxHoldSec: value.maxHoldSec,
    firstContractionSec: value.firstContractionSec,
    measuredAt: value.measuredAt,
  };
}

function validateV1CourseState(value: unknown): LegacyCourseState {
  const path = 'Invalid v1 app state: courseState';
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  if (!isFiniteNumber(value.position)) {
    throw new Error(`${path}.position must be a finite number`);
  }

  if (!isFiniteNumber(value.difficultyLevel)) {
    throw new Error(`${path}.difficultyLevel must be a finite number`);
  }

  const template = validateTemplate(value.template, `${path}.template`);

  return {
    position: value.position,
    difficultyLevel: value.difficultyLevel,
    template,
    lastTrainedAt: validateNullableNumberField(value, 'lastTrainedAt', path),
    lastAdvanceAt: validateNullableNumberField(value, 'lastAdvanceAt', path),
    lastMaxTestAt: validateNullableNumberField(value, 'lastMaxTestAt', path),
  };
}

function validateV2CourseState(value: unknown, version: 'v2'): AppState['courseState'] {
  const path = `Invalid ${version} app state: courseState`;
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  if (!isFiniteNumber(value.position)) {
    throw new Error(`${path}.position must be a finite number`);
  }

  if (!isRecord(value.difficultyByType)) {
    throw new Error(`${path}.difficultyByType must be an object`);
  }

  if (!isFiniteNumber(value.difficultyByType.CO2)) {
    throw new Error(`${path}.difficultyByType.CO2 must be a finite number`);
  }

  if (!isFiniteNumber(value.difficultyByType.O2)) {
    throw new Error(`${path}.difficultyByType.O2 must be a finite number`);
  }

  const template = validateTemplate(value.template, `${path}.template`);

  if (!isMicrocycleProfile(value.microcycleProfile)) {
    throw new Error(`${path}.microcycleProfile must be co2-heavy, balanced, or o2-heavy`);
  }

  if (!('pendingMicrocycleProfile' in value) || value.pendingMicrocycleProfile === undefined) {
    throw new Error(`${path}.pendingMicrocycleProfile field is required`);
  }

  if (value.pendingMicrocycleProfile !== null && !isMicrocycleProfile(value.pendingMicrocycleProfile)) {
    throw new Error(`${path}.pendingMicrocycleProfile must be co2-heavy, balanced, o2-heavy, or null`);
  }

  return {
    position: value.position,
    difficultyByType: {
      CO2: value.difficultyByType.CO2,
      O2: value.difficultyByType.O2,
    },
    template,
    microcycleProfile: value.microcycleProfile,
    pendingMicrocycleProfile: value.pendingMicrocycleProfile,
    profileLockedUntil: validateNullableNumberField(value, 'profileLockedUntil', path),
    lastTrainedAt: validateNullableNumberField(value, 'lastTrainedAt', path),
    lastAdvanceAt: validateNullableNumberField(value, 'lastAdvanceAt', path),
    lastMaxTestAt: validateNullableNumberField(value, 'lastMaxTestAt', path),
  };
}

function validateTemplate(value: unknown, path: string): MicrocycleTemplate {
  if (!isRecord(value) || !Array.isArray(value.days)) {
    throw new Error(`${path}.days must be an array`);
  }

  if (value.days.length === 0) {
    throw new Error(`${path}.days must contain at least one day`);
  }

  if (value.days.some((day) => typeof day !== 'string' || !DAY_TYPES.has(day))) {
    throw new Error(`${path}.days must contain only CO2, O2, REST, or MAX`);
  }

  return { days: [...value.days] };
}

function validateNullableNumberField(record: UnknownRecord, key: string, path: string): number | null {
  if (!(key in record) || record[key] === undefined) {
    throw new Error(`${path}.${key} field is required`);
  }

  const value = record[key];
  if (value !== null && !isFiniteNumber(value)) {
    throw new Error(`${path}.${key} must be a finite number or null`);
  }

  return value;
}

function validateV1Sessions(value: unknown): LegacySession[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid v1 app state: sessions must be an array');
  }

  return value.map((session, index) => validateV1Session(session, index));
}

function validateV1Session(value: unknown, index: number): LegacySession {
  const path = `Invalid v1 app state: sessions[${index}]`;
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  return {
    id: validateSessionId(value, path),
    type: validateSessionType(value.type, `${path}.type`),
    rounds: validateLegacyRounds(value.rounds, index),
    startedAt: validateRequiredNumber(value, 'startedAt', path),
    finishedAt: validateRequiredNumber(value, 'finishedAt', path),
    completedRounds: validateRequiredNumber(value, 'completedRounds', path),
    tapOuts: validateRequiredNumber(value, 'tapOuts', path),
    rpe: validateRpe(value.rpe, `${path}.rpe`),
    difficultyLevel: validateRequiredNumber(value, 'difficultyLevel', path),
  };
}

function validateLegacyRounds(value: unknown, sessionIndex: number): LegacyRoundResult[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid v1 app state: sessions[${sessionIndex}].rounds must be an array`);
  }

  return value.map((round, roundIndex) => validateLegacyRound(round, sessionIndex, roundIndex));
}

function validateLegacyRound(value: unknown, sessionIndex: number, roundIndex: number): LegacyRoundResult {
  const path = `Invalid v1 app state: sessions[${sessionIndex}].rounds[${roundIndex}]`;
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  return {
    index: validateRequiredNumber(value, 'index', path),
    targetHoldSec: validateRequiredNumber(value, 'targetHoldSec', path),
    achievedHoldSec: validateRequiredNumber(value, 'achievedHoldSec', path),
    restBeforeSec: validateRequiredNumber(value, 'restBeforeSec', path),
    contractions: validateRequiredNumber(value, 'contractions', path),
    tappedOut: validateRequiredBoolean(value, 'tappedOut', path),
  };
}

function validateV2Sessions(value: unknown, version: 'v2'): Session[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${version} app state: sessions must be an array`);
  }

  return value.map((session, index) => validateV2Session(session, index));
}

function validateV2Session(value: unknown, index: number): Session {
  const path = `Invalid v2 app state: sessions[${index}]`;
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  if (!('adjustment' in value) || value.adjustment === undefined) {
    throw new Error(`${path}.adjustment field is required`);
  }

  return {
    id: validateSessionId(value, path),
    type: validateSessionType(value.type, `${path}.type`),
    rounds: validateV2Rounds(value.rounds, index),
    startedAt: validateRequiredNumber(value, 'startedAt', path),
    finishedAt: validateRequiredNumber(value, 'finishedAt', path),
    completedRounds: validateRequiredNumber(value, 'completedRounds', path),
    tapOuts: validateRequiredNumber(value, 'tapOuts', path),
    rpe: validateRpe(value.rpe, `${path}.rpe`),
    difficultyLevel: validateRequiredNumber(value, 'difficultyLevel', path),
    adjustment: validateAdjustment(value.adjustment, `${path}.adjustment`),
  };
}

function validateV2Rounds(value: unknown, sessionIndex: number): RoundResult[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid v2 app state: sessions[${sessionIndex}].rounds must be an array`);
  }

  return value.map((round, roundIndex) => validateV2Round(round, sessionIndex, roundIndex));
}

function validateV2Round(value: unknown, sessionIndex: number, roundIndex: number): RoundResult {
  const path = `Invalid v2 app state: sessions[${sessionIndex}].rounds[${roundIndex}]`;
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  if (!('firstContractionSec' in value) || value.firstContractionSec === undefined) {
    throw new Error(`${path}.firstContractionSec field is required`);
  }

  if (value.firstContractionSec !== null && !isFiniteNumber(value.firstContractionSec)) {
    throw new Error(`${path}.firstContractionSec must be a finite number or null`);
  }

  return {
    index: validateRequiredNumber(value, 'index', path),
    targetHoldSec: validateRequiredNumber(value, 'targetHoldSec', path),
    achievedHoldSec: validateRequiredNumber(value, 'achievedHoldSec', path),
    restBeforeSec: validateRequiredNumber(value, 'restBeforeSec', path),
    contractions: validateRequiredNumber(value, 'contractions', path),
    firstContractionSec: value.firstContractionSec,
    tappedOut: validateRequiredBoolean(value, 'tappedOut', path),
  };
}

function validateAdjustment(value: unknown, path: string): InSessionAdjustment | null {
  if (value === null) {
    return null;
  }

  if (!isRecord(value)) {
    throw new Error(`${path} must be an object or null`);
  }

  if (!isAdjustmentReason(value.reason)) {
    throw new Error(`${path}.reason must be early-contractions or tap-out`);
  }

  return {
    reason: value.reason,
    triggeredAtRoundIndex: validateRequiredNumber(value, 'triggeredAtRoundIndex', path),
    restAddedSec: validateRequiredNumber(value, 'restAddedSec', path),
    holdCapSec: validateNullableNumberField(value, 'holdCapSec', path),
  };
}

function isAdjustmentReason(value: unknown): value is InSessionAdjustment['reason'] {
  return typeof value === 'string' && ADJUSTMENT_REASONS.some((reason) => reason === value);
}

function validateGoal(value: unknown): Goal | null {
  if (value === null) {
    return null;
  }

  const path = 'Invalid v2 app state: goal';
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object or null`);
  }

  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new Error(`${path}.id must be a non-empty string`);
  }

  return {
    id: value.id,
    targetHoldSec: validateRequiredNumber(value, 'targetHoldSec', path),
    createdAt: validateRequiredNumber(value, 'createdAt', path),
    startMaxSec: validateRequiredNumber(value, 'startMaxSec', path),
    achievedAt: validateNullableNumberField(value, 'achievedAt', path),
  };
}

function validateSessionId(record: UnknownRecord, path: string): string {
  if (typeof record.id !== 'string' || record.id.length === 0) {
    throw new Error(`${path}.id must be a non-empty string`);
  }

  return record.id;
}

function validateSessionType(value: unknown, path: string): SessionType {
  if (typeof value !== 'string' || !SESSION_TYPES.includes(value as SessionType)) {
    throw new Error(`${path} must be CO2, O2, or MAX`);
  }

  return value as SessionType;
}

function validateRpe(value: unknown, path: string): Rpe | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string' || !RPES.includes(value as Rpe)) {
    throw new Error(`${path} must be easy, normal, hard, failed, or null`);
  }

  return value as Rpe;
}

function validateRequiredNumber(record: UnknownRecord, key: string, path: string): number {
  if (!isFiniteNumber(record[key])) {
    throw new Error(`${path}.${key} must be a finite number`);
  }

  return record[key];
}

function validateRequiredBoolean(record: UnknownRecord, key: string, path: string): boolean {
  if (typeof record[key] !== 'boolean') {
    throw new Error(`${path}.${key} must be a boolean`);
  }

  return record[key];
}

function isMicrocycleProfile(value: unknown): value is MicrocycleProfile {
  return typeof value === 'string' && MICROCYCLE_PROFILES.includes(value as MicrocycleProfile);
}

function dedupeBaselines(baselines: Baseline[]): Baseline[] {
  const latestById = new Map<string, Baseline>();

  for (const baseline of baselines) {
    const current = latestById.get(baseline.id);
    if (!current || baseline.measuredAt >= current.measuredAt) {
      latestById.set(baseline.id, { ...baseline });
    }
  }

  return [...latestById.values()].sort((left, right) => left.measuredAt - right.measuredAt);
}

function normalizeV2State(state: AppState): AppState {
  return {
    version: 2,
    settings: { ...state.settings, reminderTimes: [...state.settings.reminderTimes] },
    baselines: dedupeBaselines(state.baselines),
    courseState: {
      ...state.courseState,
      difficultyByType: { ...state.courseState.difficultyByType },
      template: { days: [...state.courseState.template.days] },
    },
    sessions: state.sessions.map((session) => ({
      ...session,
      rounds: session.rounds.map((round) => ({ ...round })),
      adjustment: session.adjustment ? { ...session.adjustment } : null,
    })),
    goal: state.goal ? { ...state.goal } : null,
  };
}
