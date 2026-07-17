const LOCAL_PART_PATTERN = /^[A-Za-z0-9.!$%&'*+=^_`{|}~-]+$/;
const DOMAIN_LABEL_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const TOP_LEVEL_DOMAIN_PATTERN = /^[A-Za-z]{2,63}$/;

export function normalizePrivacyContactEmail(
  value: string | null | undefined,
): string | null {
  const email = value?.trim() ?? '';
  if (email.length === 0 || email.length > 254) return null;

  const parts = email.split('@');
  if (parts.length !== 2) return null;

  const [localPart, domain] = parts;
  if (
    localPart.length === 0
    || localPart.length > 64
    || !LOCAL_PART_PATTERN.test(localPart)
    || localPart.startsWith('.')
    || localPart.endsWith('.')
    || localPart.includes('..')
  ) {
    return null;
  }

  const labels = domain.split('.');
  if (
    labels.length < 2
    || labels.some((label) => !DOMAIN_LABEL_PATTERN.test(label))
    || !TOP_LEVEL_DOMAIN_PATTERN.test(labels.at(-1) ?? '')
  ) {
    return null;
  }

  return email;
}
