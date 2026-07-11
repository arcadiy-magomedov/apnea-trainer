import { describe, it, expect } from 'vitest';
import { completedCalendarEvents, plannedCalendarEvents } from './trainingCalendar';
import { emptyAppState } from '../../domain/models/appState';
import { makeBaseline, makeRound, makeSession, makeState } from '../../test/fixtures';
import { DAY_MS } from '../../domain/apnea/config';
import { startOfDay } from '../../domain/apnea/time';

const D = (iso: string) => new Date(iso).getTime();

describe('completedCalendarEvents', () => {
  it('maps a completed CO2 session to id session-co2, completed status, source session, quality clean, correct round counts, tap-outs, and best hold', () => {
    const session = makeSession({
      id: 'co2',
      type: 'CO2',
      rounds: [makeRound({ targetHoldSec: 60, achievedHoldSec: 60, tappedOut: false })],
      finishedAt: D('2026-06-01T10:00:00'),
      rpe: 'normal',
      difficultyLevel: 2,
      adjustment: null,
    });
    const state = { ...emptyAppState(), sessions: [session] };

    const events = completedCalendarEvents(state);

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event.id).toBe('session-co2');
    expect(event.status).toBe('completed');
    expect(event.source).toBe('session');
    expect(event.quality).toBe('clean');
    expect(event.completedRounds).toBe(1);
    expect(event.plannedRounds).toBe(1);
    expect(event.tapOuts).toBe(0);
    expect(event.bestHoldSec).toBe(60);
    expect(event.dayKey).toBe('2026-06-01');
    expect(event.dayType).toBe('CO2');
    expect(event.at).toBe(D('2026-06-01T10:00:00'));
    expect(event.difficultyLevel).toBe(2);
    expect(event.postponed).toBe(false);
  });

  it('keeps multiple sessions on the same local day as separate events with the same dayKey', () => {
    const sessions = [
      makeSession({
        id: 'a',
        type: 'CO2',
        finishedAt: D('2026-06-01T09:00:00'),
        rounds: [makeRound()],
        rpe: 'normal',
      }),
      makeSession({
        id: 'b',
        type: 'CO2',
        finishedAt: D('2026-06-01T19:00:00'),
        rounds: [makeRound()],
        rpe: 'normal',
      }),
    ];
    const state = { ...emptyAppState(), sessions };

    const events = completedCalendarEvents(state);

    expect(events).toHaveLength(2);
    expect(events[0].id).toBe('session-a');
    expect(events[1].id).toBe('session-b');
    expect(events[0].dayKey).toBe('2026-06-01');
    expect(events[1].dayKey).toBe('2026-06-01');
  });

  it('maps a standalone baseline to one completed MAX assessment event with max hold and first-contraction', () => {
    const baseline = makeBaseline({
      id: 'bl1',
      maxHoldSec: 120,
      firstContractionSec: 45,
      measuredAt: D('2026-06-01T10:00:00'),
    });
    const state = { ...emptyAppState(), baselines: [baseline] };

    const events = completedCalendarEvents(state);

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event.id).toBe('assessment-bl1');
    expect(event.status).toBe('completed');
    expect(event.source).toBe('assessment');
    expect(event.dayType).toBe('MAX');
    expect(event.quality).toBeNull();
    expect(event.bestHoldSec).toBe(120);
    expect(event.firstContractionSec).toBe(45);
    expect(event.completedRounds).toBeNull();
    expect(event.plannedRounds).toBeNull();
    expect(event.tapOuts).toBeNull();
    expect(event.difficultyLevel).toBeNull();
    expect(event.at).toBe(D('2026-06-01T10:00:00'));
    expect(event.dayKey).toBe('2026-06-01');
    expect(event.postponed).toBe(false);
  });

  it('deduplicates a MAX session with its matching baseline into one session event retaining baseline first-contraction', () => {
    const session = makeSession({
      id: 'max1',
      type: 'MAX',
      rounds: [makeRound({ achievedHoldSec: 120 })],
      finishedAt: D('2026-06-01T10:00:00'),
      rpe: null,
    });
    const baseline = makeBaseline({
      id: 'bl1',
      maxHoldSec: 120,
      firstContractionSec: 40,
      measuredAt: D('2026-06-01T10:01:00'),
    });
    const state = { ...emptyAppState(), sessions: [session], baselines: [baseline] };

    const events = completedCalendarEvents(state);

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event.id).toBe('session-max1');
    expect(event.source).toBe('session');
    expect(event.dayType).toBe('MAX');
    expect(event.bestHoldSec).toBe(120);
    expect(event.firstContractionSec).toBe(40);
    expect(event.quality).toBeNull();
  });

  it('assigns quality unavailable to imported sessions with rpe null', () => {
    const session = makeSession({
      id: 'imported',
      type: 'CO2',
      rounds: [makeRound()],
      finishedAt: D('2026-06-01T10:00:00'),
      rpe: null,
    });
    const state = { ...emptyAppState(), sessions: [session] };

    const events = completedCalendarEvents(state);

    expect(events).toHaveLength(1);
    expect(events[0].quality).toBe('unavailable');
  });

  it('pairs MAX session with nearest of two qualifying baselines and leaves farther as standalone assessment', () => {
    const session = makeSession({
      id: 'max1',
      type: 'MAX',
      rounds: [makeRound({ achievedHoldSec: 120 })],
      finishedAt: D('2026-06-01T10:00:00'),
      rpe: null,
    });
    const nearBaseline = makeBaseline({
      id: 'near',
      maxHoldSec: 120,
      firstContractionSec: 30,
      measuredAt: D('2026-06-01T10:01:00'), // 1 min after session
    });
    const farBaseline = makeBaseline({
      id: 'far',
      maxHoldSec: 120,
      firstContractionSec: 50,
      measuredAt: D('2026-06-01T10:03:00'), // 3 min after session
    });
    const state = { ...emptyAppState(), sessions: [session], baselines: [nearBaseline, farBaseline] };

    const events = completedCalendarEvents(state);

    expect(events).toHaveLength(2);
    const sessionEvent = events.find((e) => e.id === 'session-max1');
    const assessmentEvent = events.find((e) => e.id === 'assessment-far');
    expect(sessionEvent).toBeDefined();
    expect(sessionEvent!.firstContractionSec).toBe(30); // nearest baseline consumed
    expect(assessmentEvent).toBeDefined();
    expect(assessmentEvent!.source).toBe('assessment');
    expect(assessmentEvent!.firstContractionSec).toBe(50); // farther baseline unconsumed
  });

  it('consumes each baseline at most once when two MAX sessions and two baselines both qualify under chronological greedy matching', () => {
    // Both baselines sit after both sessions, so without one-to-one consumption tracking
    // session-max2 would steal session-max1's nearer baseline (bl1 is 3 min from max2, bl2 is 6 min).
    const session1 = makeSession({
      id: 'max1',
      type: 'MAX',
      rounds: [makeRound({ achievedHoldSec: 120 })],
      finishedAt: D('2026-06-01T10:00:00'),
      rpe: null,
    });
    const session2 = makeSession({
      id: 'max2',
      type: 'MAX',
      rounds: [makeRound({ achievedHoldSec: 120 })],
      finishedAt: D('2026-06-01T10:02:00'),
      rpe: null,
    });
    const baseline1 = makeBaseline({
      id: 'bl1',
      maxHoldSec: 120,
      firstContractionSec: 10,
      measuredAt: D('2026-06-01T10:05:00'), // 5 min after max1, 3 min after max2
    });
    const baseline2 = makeBaseline({
      id: 'bl2',
      maxHoldSec: 120,
      firstContractionSec: 20,
      measuredAt: D('2026-06-01T10:08:00'), // 8 min after max1, 6 min after max2
    });
    const state = {
      ...emptyAppState(),
      sessions: [session1, session2],
      baselines: [baseline1, baseline2],
    };

    const events = completedCalendarEvents(state);

    expect(events).toHaveLength(2); // both baselines consumed — no standalone assessments
    const max1Event = events.find((e) => e.id === 'session-max1');
    const max2Event = events.find((e) => e.id === 'session-max2');
    expect(max1Event).toBeDefined();
    expect(max1Event!.firstContractionSec).toBe(10); // nearest to max1 = bl1
    expect(max2Event).toBeDefined();
    expect(max2Event!.firstContractionSec).toBe(20); // bl1 already consumed; bl2 is next = 20
  });

  it('sorts events with identical at by id for deterministic tie-breaking', () => {
    const sessions = [
      makeSession({
        id: 'z-session',
        type: 'CO2',
        finishedAt: D('2026-06-01T10:00:00'),
        rounds: [makeRound()],
        rpe: 'normal',
      }),
      makeSession({
        id: 'a-session',
        type: 'CO2',
        finishedAt: D('2026-06-01T10:00:00'),
        rounds: [makeRound()],
        rpe: 'normal',
      }),
    ];
    const state = { ...emptyAppState(), sessions };

    const events = completedCalendarEvents(state);

    expect(events).toHaveLength(2);
    expect(events[0].id).toBe('session-a-session');
    expect(events[1].id).toBe('session-z-session');
  });

  it('classifies session quality using only chronologically prior sessions, not later ones', () => {
    // With only 4 prior CO2 sessions (firstContractionSec=18, targetHoldSec=60, ratio=0.30),
    // personalSampleMin=5 is not reached → cold-start threshold 0.50 applies.
    // The current session has ratio 24/60=0.40 < 0.50 → earlyRound → 'strained'.
    //
    // If the later session (same ratio 0.30) were wrongly included in priorSessions:
    // 5 samples → median 0.30, personal threshold 0.30×0.80=0.24 → clamped to 0.25;
    // ratio 0.40 > 0.25 → NOT earlyRound → 'clean'. This test catches that regression.
    const priorSessions = [1, 2, 3, 4].map((n) =>
      makeSession({
        id: `prior-${n}`,
        type: 'CO2',
        finishedAt: D('2026-06-01T08:00:00') + n * 60_000,
        rounds: [makeRound({ targetHoldSec: 60, firstContractionSec: 18, achievedHoldSec: 60 })],
        rpe: 'normal',
      }),
    );
    const currentSession = makeSession({
      id: 'current',
      type: 'CO2',
      finishedAt: D('2026-06-01T10:00:00'),
      rounds: [makeRound({ targetHoldSec: 60, firstContractionSec: 24, achievedHoldSec: 60 })],
      rpe: 'normal',
    });
    const laterSession = makeSession({
      id: 'later',
      type: 'CO2',
      finishedAt: D('2026-06-01T12:00:00'),
      rounds: [makeRound({ targetHoldSec: 60, firstContractionSec: 18, achievedHoldSec: 60 })],
      rpe: 'normal',
    });
    const state = {
      ...emptyAppState(),
      sessions: [...priorSessions, currentSession, laterSession],
    };

    const events = completedCalendarEvents(state);

    const currentEvent = events.find((e) => e.id === 'session-current');
    expect(currentEvent).toBeDefined();
    expect(currentEvent!.quality).toBe('strained');
  });
});

describe('plannedCalendarEvents', () => {
  const NOW = new Date('2026-07-10T14:00:00').getTime();

  function stateWithBaseline(maxHoldSec = 120): ReturnType<typeof emptyAppState> {
    return makeState({
      baselines: [makeBaseline({ id: 'bl', maxHoldSec, measuredAt: NOW - 2 * DAY_MS })],
      courseState: {
        ...emptyAppState().courseState,
        lastMaxTestAt: NOW - 2 * DAY_MS,
        lastTrainedAt: NOW - DAY_MS,
        lastAdvanceAt: startOfDay(NOW),
      },
    });
  }

  it('returns exactly 42 local calendar days including today when no completed session today; first key 2026-07-10, last 2026-08-20; input state deep-equal unchanged', () => {
    const state = stateWithBaseline();
    const frozen = JSON.parse(JSON.stringify(state));

    const events = plannedCalendarEvents(state, NOW);

    expect(events.length).toBe(42);
    expect(events[0].dayKey).toBe('2026-07-10');
    expect(events[events.length - 1].dayKey).toBe('2026-08-20');
    expect(state).toStrictEqual(frozen);
  });

  it('default first seven day types are CO2, REST, O2, REST, CO2, O2, REST', () => {
    const state = stateWithBaseline();
    const events = plannedCalendarEvents(state, NOW);
    const firstSeven = events.slice(0, 7).map((e) => e.dayType);
    expect(firstSeven).toEqual(['CO2', 'REST', 'O2', 'REST', 'CO2', 'O2', 'REST']);
  });

  it('if a session was completed today, no planned event overlaps that local day and first planned event is tomorrow', () => {
    const state = stateWithBaseline();
    state.sessions = [
      makeSession({
        id: 'today-s',
        type: 'CO2',
        finishedAt: NOW - 3600_000,
        rounds: [makeRound()],
        rpe: 'normal',
      }),
    ];
    // courseState reflects that we already trained today
    state.courseState.lastTrainedAt = NOW - 3600_000;
    state.courseState.position = 1; // advanced past the CO2 slot

    const events = plannedCalendarEvents(state, NOW);

    const todayKey = '2026-07-10';
    expect(events.every((e) => e.dayKey !== todayKey)).toBe(true);
    expect(events[0].dayKey).toBe('2026-07-11');
  });

  it('a due MAX after a recent hard session projects a first REST event with postponed: true, followed later by an eligible MAX event', () => {
    // Set lastMaxTestAt far enough so recalibration is due
    const state = stateWithBaseline();
    state.courseState.lastMaxTestAt = NOW - 15 * DAY_MS;
    // Recent hard session just yesterday
    state.sessions = [
      makeSession({
        id: 'hard',
        type: 'CO2',
        finishedAt: NOW - DAY_MS + 3600_000, // yesterday
        rounds: [makeRound()],
        rpe: 'hard',
      }),
    ];
    state.courseState.lastTrainedAt = NOW - DAY_MS + 3600_000;

    const events = plannedCalendarEvents(state, NOW);

    // First event should be REST with postponed: true (recovery not met)
    expect(events[0].dayType).toBe('REST');
    expect(events[0].postponed).toBe(true);
    // There should be a MAX event somewhere later
    const maxEvent = events.find((e) => e.dayType === 'MAX');
    expect(maxEvent).toBeDefined();
    expect(maxEvent!.postponed).toBe(false);
  });

  it('empty state with no assessed max/baseline returns []', () => {
    const state = emptyAppState();
    const events = plannedCalendarEvents(state, NOW);
    expect(events).toEqual([]);
  });
});
