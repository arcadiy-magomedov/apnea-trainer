import { describe, it, expect, vi } from 'vitest';
import { shareOrDownloadIcs } from './icsShare';

describe('shareOrDownloadIcs', () => {
  it('shares the file via the Web Share API when files can be shared (iOS)', async () => {
    const share = vi.fn(async () => {});
    const nav = { share, canShare: () => true } as unknown as Navigator;
    const triggerDownload = vi.fn();

    const result = await shareOrDownloadIcs('BEGIN:VCALENDAR', 'x.ics', { nav, triggerDownload });

    expect(share).toHaveBeenCalled();
    expect(triggerDownload).not.toHaveBeenCalled();
    expect(result).toBe('shared');
  });

  it('falls back to a file download when sharing is unavailable', async () => {
    const nav = {} as Navigator;
    const triggerDownload = vi.fn();

    const result = await shareOrDownloadIcs('BEGIN:VCALENDAR', 'x.ics', { nav, triggerDownload });

    expect(triggerDownload).toHaveBeenCalledWith('BEGIN:VCALENDAR', 'x.ics');
    expect(result).toBe('downloaded');
  });

  it('falls back to a download when the share is cancelled or fails', async () => {
    const share = vi.fn(async () => { throw new Error('cancelled'); });
    const nav = { share, canShare: () => true } as unknown as Navigator;
    const triggerDownload = vi.fn();

    const result = await shareOrDownloadIcs('BEGIN:VCALENDAR', 'x.ics', { nav, triggerDownload });

    expect(triggerDownload).toHaveBeenCalled();
    expect(result).toBe('downloaded');
  });
});
