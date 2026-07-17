import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrivacyScreen } from './PrivacyScreen';

afterEach(() => {
  vi.unstubAllEnvs();
});

it('discloses analytics processing, reporting, retention, and controls', () => {
  vi.stubEnv(
    'VITE_PRIVACY_CONTACT_EMAIL',
    '  privacy@apneatrainer.test  ',
  );
  render(<PrivacyScreen />);

  expect(screen.getByText(/Google Analytics 4.*processor/i))
    .toBeInTheDocument();
  const analyticsDisclosure = screen.getByRole('heading', {
    name: /anonymous usage analytics/i,
  }).parentElement;
  expect(analyticsDisclosure).toHaveTextContent(
    /normalized page and screen navigation.*calls to action on public content/i,
  );
  expect(analyticsDisclosure).toHaveTextContent(
    /onboarding and baseline lifecycle/i,
  );
  expect(analyticsDisclosure).toHaveTextContent(
    /training session starts, completions, and abandonments.*only coarse training-type and duration buckets/i,
  );
  expect(analyticsDisclosure).toHaveTextContent(
    /goal creation, update, and clear actions, without goal values/i,
  );
  expect(analyticsDisclosure).toHaveTextContent(
    /calendar day interactions.*past, today, or future/i,
  );
  expect(analyticsDisclosure).toHaveTextContent(
    /Progressive Web App.*install.*acceptance/i,
  );
  expect(analyticsDisclosure).toHaveTextContent(
    /potential future ad-placement viewability on approved non-training screens/i,
  );
  expect(analyticsDisclosure).not.toHaveTextContent(
    /goal_created|goal_updated|goal_cleared|page_view|ad_opportunity/i,
  );
  const prohibitedData = screen.getByRole('heading', {
    name: /what the app does not send/i,
  }).parentElement;
  expect(prohibitedData).toHaveTextContent(/exact hold and rest measurements/i);
  expect(prohibitedData).toHaveTextContent(/baseline and goal values/i);
  expect(prohibitedData).toHaveTextContent(/contractions and RPE/i);
  expect(prohibitedData).toHaveTextContent(/reminder times/i);
  expect(prohibitedData).toHaveTextContent(
    /names, email addresses, phone numbers, or other contact details/i,
  );
  expect(prohibitedData).toHaveTextContent(
    /free text, form contents, or DOM contents/i,
  );
  expect(prohibitedData).toHaveTextContent(
    /app-defined account, training, baseline, goal, or session identifiers/i,
  );
  expect(prohibitedData).toHaveTextContent(/raw URLs or query strings/i);
  expect(prohibitedData).toHaveTextContent(/backup data/i);
  expect(prohibitedData).toHaveTextContent(/precise location/i);
  expect(screen.getByText(
    /normalized screen paths, coarse country, and device category may be collected/i,
  ))
    .toBeInTheDocument();
  expect(screen.getByText(/reports cover only people who opted in/i))
    .toBeInTheDocument();
  expect(screen.getByText(/two-month retention/i)).toBeInTheDocument();
  expect(screen.getByText(/withdraw consent in Settings/i))
    .toBeInTheDocument();
  expect(screen.getByText(/clears the analytics identifier.*this device/i))
    .toBeInTheDocument();
  expect(screen.getByText(
    /GA4 assigns a persistent pseudonymous client identifier and uses vendor session identifiers/i,
  )).toBeInTheDocument();
  expect(screen.getByText(
    /displayed pseudonymous analytics identifier.*measurement and deletion support/i,
  )).toBeInTheDocument();
  expect(screen.getByText(/owner-operated deletion request/i))
    .toBeInTheDocument();
  expect(screen.getByText(/include.*pseudonymous analytics identifier/i))
    .toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Google privacy policy/i }))
    .toHaveAttribute('href', 'https://policies.google.com/privacy');
  expect(screen.getByText(/monitored public contact/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /privacy@apneatrainer.test/i }))
    .toHaveAttribute('href', 'mailto:privacy@apneatrainer.test');
});

it('discloses opted-in analytics context and GA4-generated events', () => {
  render(<PrivacyScreen />);

  const analyticsDisclosure = screen.getByRole('heading', {
    name: /anonymous usage analytics/i,
  }).parentElement;
  expect(analyticsDisclosure).toHaveTextContent(
    /opted-in events may include.*app version/i,
  );
  expect(analyticsDisclosure).toHaveTextContent(
    /browser or installed\/standalone mode/i,
  );
  expect(analyticsDisclosure).toHaveTextContent(
    /online or offline network state/i,
  );
  expect(analyticsDisclosure).toHaveTextContent(
    /sanitized normalized page location and sanitized referrer/i,
  );
  expect(analyticsDisclosure).toHaveTextContent(
    /raw query strings and fragments are removed/i,
  );
  expect(analyticsDisclosure).toHaveTextContent(
    /only bounded lower-case UTM campaign slugs.*when present/i,
  );
  expect(analyticsDisclosure).toHaveTextContent(
    /unsafe or raw query values are discarded/i,
  );
  expect(analyticsDisclosure).toHaveTextContent(
    /after consent.*first visit, session start, and user engagement/i,
  );
  expect(analyticsDisclosure).toHaveTextContent(
    /all of this collection remains subject to opt-in/i,
  );
});

it.each([
  'not-an-email',
  'privacy@apneatrainer.test?subject=delete',
  'privacy@@apneatrainer.test',
  'privacy@-apneatrainer.test',
])('does not link or echo the invalid privacy contact %s', (invalidContact) => {
  vi.stubEnv('VITE_PRIVACY_CONTACT_EMAIL', invalidContact);
  render(<PrivacyScreen />);

  expect(screen.getByText(/privacy contact is not configured/i))
    .toBeInTheDocument();
  expect(screen.queryByRole('link', { name: invalidContact }))
    .not.toBeInTheDocument();
  expect(screen.queryByText(invalidContact)).not.toBeInTheDocument();
});
