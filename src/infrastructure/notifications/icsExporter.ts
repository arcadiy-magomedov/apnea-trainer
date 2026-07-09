import type { MicrocycleTemplate } from '../../domain/models/types';
import { DAY_MS } from '../../domain/apnea/config';

const ICS_DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function pad(n: number): string { return String(n).padStart(2, '0'); }

function dtStamp(t: number, hh: number, mm: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(hh)}${pad(mm)}00`;
}

export function buildIcs(times: string[], template: MicrocycleTemplate, startDate: number): string {
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ApneaTrainer//EN'];
  if (times.length > 0) {
    const [hh, mm] = times[0].split(':').map(Number);
    template.days.forEach((day, i) => {
      if (day === 'REST') return;
      const eventDate = startDate + i * DAY_MS;
      const weekday = ICS_DAY[new Date(eventDate).getDay()];
      lines.push(
        'BEGIN:VEVENT',
        `UID:apnea-${day}-${i}@apnea-trainer`,
        `DTSTART:${dtStamp(eventDate, hh, mm)}`,
        `RRULE:FREQ=WEEKLY;BYDAY=${weekday}`,
        `SUMMARY:Apnea training (${day})`,
        'END:VEVENT',
      );
    });
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
