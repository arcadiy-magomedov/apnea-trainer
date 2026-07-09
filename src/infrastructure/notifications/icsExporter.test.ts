import { describe, it, expect } from 'vitest';
import { buildIcs } from './icsExporter';
import { defaultMicrocycle } from '../../domain/models/appState';

const D = (iso: string) => new Date(iso).getTime();

describe('buildIcs', () => {
  it('produces a valid VCALENDAR with a VEVENT per training day', () => {
    const ics = buildIcs(['19:00'], defaultMicrocycle(), D('2026-07-13T00:00:00')); // Monday
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    // default microcycle has 4 non-REST days -> 4 events
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(4);
    expect(ics).toContain('RRULE:FREQ=WEEKLY');
    expect(ics).toContain('SUMMARY:Apnea training');
  });

  it('returns an empty calendar when there are no reminder times', () => {
    const ics = buildIcs([], defaultMicrocycle(), D('2026-07-13T00:00:00'));
    expect(ics.match(/BEGIN:VEVENT/g)).toBeNull();
  });
});
