import { expect, it } from 'vitest';
import { normalizePrivacyContactEmail } from './privacyContact';

it.each([
  ['privacy@apneatrainer.test', 'privacy@apneatrainer.test'],
  [
    '  privacy.team+requests@sub-domain.apneatrainer.test  ',
    'privacy.team+requests@sub-domain.apneatrainer.test',
  ],
])('normalizes the monitored privacy contact %s', (input, expected) => {
  expect(normalizePrivacyContactEmail(input)).toBe(expected);
});

it.each([
  '',
  'privacy @apneatrainer.test',
  'privacy@apneatrainer.test?subject=delete',
  'privacy@apneatrainer.test#fragment',
  'privacy@apneatrainer.test/path',
  'privacy\\@apneatrainer.test',
  'privacy@@apneatrainer.test',
  '@apneatrainer.test',
  'privacy@',
  '.privacy@apneatrainer.test',
  'privacy.@apneatrainer.test',
  'privacy..team@apneatrainer.test',
  'privacy@apneatrainer',
  'privacy@.apneatrainer.test',
  'privacy@apneatrainer..test',
  'privacy@apneatrainer.test.',
  'privacy@-apneatrainer.test',
  'privacy@apneatrainer-.test',
])('rejects the malformed privacy contact %s', (input) => {
  expect(normalizePrivacyContactEmail(input)).toBeNull();
});
