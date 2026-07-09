export interface IcsShareDeps {
  nav?: Navigator;
  triggerDownload?: (content: string, filename: string) => void;
}

function defaultDownload(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Deliver an .ics calendar to the user.
 *
 * iOS Safari refuses blob/anchor downloads ("Safari cannot download this
 * file"), so when the Web Share API can share files we hand the .ics to the
 * system share sheet — which offers "Add to Calendar". Everywhere else we fall
 * back to a normal file download.
 */
export async function shareOrDownloadIcs(
  content: string,
  filename = 'apnea-training.ics',
  deps: IcsShareDeps = {},
): Promise<'shared' | 'downloaded'> {
  const nav = deps.nav ?? (typeof navigator !== 'undefined' ? navigator : undefined);
  const download = deps.triggerDownload ?? defaultDownload;

  const shareNav = nav as (Navigator & { canShare?: (data: unknown) => boolean }) | undefined;
  if (shareNav && typeof shareNav.share === 'function' && typeof shareNav.canShare === 'function') {
    try {
      const file = new File([content], filename, { type: 'text/calendar' });
      if (shareNav.canShare({ files: [file] })) {
        await shareNav.share({ files: [file], title: 'Apnea training' });
        return 'shared';
      }
    } catch {
      // User cancelled or sharing failed — fall through to a download.
    }
  }

  download(content, filename);
  return 'downloaded';
}
