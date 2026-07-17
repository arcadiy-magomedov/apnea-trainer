import { Card } from '../design-system/Card';
import {
  normalizePrivacyContactEmail,
} from '../../application/privacy/privacyContact';

export function PrivacyScreen() {
  const contact = normalizePrivacyContactEmail(
    import.meta.env.VITE_PRIVACY_CONTACT_EMAIL,
  );

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold">Privacy</h2>
      <Card>
        <h3 className="font-semibold">Anonymous usage analytics</h3>
        <p className="mt-2 text-sm text-[color:var(--text-dim)]">
          If you opt in, Google Analytics 4 acts as the analytics processor.
          Only these approved high-level event categories are collected:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[color:var(--text-dim)]">
          <li>
            Normalized page and screen navigation, plus interactions with
            calls to action on public content.
          </li>
          <li>Onboarding and baseline lifecycle.</li>
          <li>
            Training session starts, completions, and abandonments, with only
            coarse training-type and duration buckets.
          </li>
          <li>Goal creation, update, and clear actions, without goal values.</li>
          <li>
            Calendar day interactions, using only whether the selected day is
            in the past, today, or future.
          </li>
          <li>Progressive Web App (PWA) install prompt acceptance.</li>
          <li>
            Potential future ad-placement viewability on approved non-training
            screens.
          </li>
        </ul>
        <p className="mt-2 text-sm text-[color:var(--text-dim)]">
          Opted-in events may include common context: app version; browser or
          installed/standalone mode; online or offline network state; and
          sanitized normalized page location and sanitized referrer. Raw query
          strings and fragments are removed. Only bounded lower-case UTM
          campaign slugs are included when present. Unsafe or raw query
          values are discarded. After consent, GA4 may also generate system
          events such as first visit, session start, and user engagement. All
          of this collection remains subject to opt-in.
        </p>
      </Card>
      <Card>
        <h3 className="font-semibold">What the app does not send</h3>
        <p className="mt-2 text-sm text-[color:var(--text-dim)]">
          The app does not send exact hold and rest measurements, baseline and
          goal values, contractions and RPE, reminder times, names, email
          addresses, phone numbers, or other contact details. It also does not
          send free text, form contents, or DOM contents; app-defined account,
          training, baseline, goal, or session identifiers; raw URLs or query
          strings; backup data; or precise location.
        </p>
      </Card>
      <Card>
        <h3 className="font-semibold">Aggregate reporting</h3>
        <p className="mt-2 text-sm text-[color:var(--text-dim)]">
          Normalized screen paths, coarse country, and device category may be
          collected. Precise location is not. Analytics reports cover only
          people who opted in, so they are not a complete count of app users.
        </p>
      </Card>
      <Card>
        <h3 className="font-semibold">Retention and your controls</h3>
        <p className="mt-2 text-sm text-[color:var(--text-dim)]">
          GA4 event and user data are configured for two-month retention. GA4
          assigns a persistent pseudonymous client identifier and uses vendor
          session identifiers for measurement. The displayed pseudonymous
          analytics identifier exists only for measurement and deletion
          support. The app does not create or send app-defined account,
          training, baseline, goal, or session identifiers. You can withdraw
          consent in Settings at any time. Withdrawal stops collection and
          clears the analytics identifier stored on this device. Google
          processes opted-in analytics data under its{' '}
          <a
            className="text-[color:var(--cyan)]"
            href="https://policies.google.com/privacy"
            rel="noreferrer"
            target="_blank"
          >
            Google privacy policy
          </a>.
        </p>
      </Card>
      <Card>
        <h3 className="font-semibold">Access or deletion request</h3>
        <p className="mt-2 text-sm text-[color:var(--text-dim)]">
          Deletion is an owner-operated deletion request. Copy the pseudonymous
          analytics identifier from Settings before turning analytics off,
          because withdrawal clears it from this device. Include the
          pseudonymous analytics identifier when contacting the monitored
          public contact.
        </p>
        {contact !== null ? (
          <p className="mt-2 text-sm text-[color:var(--text-dim)]">
            Email{' '}
            <a className="text-[color:var(--cyan)]" href={`mailto:${contact}`}>
              {contact}
            </a>.
          </p>
        ) : (
          <p className="mt-2 text-sm text-[color:var(--danger)]">
            The privacy contact is not configured in this build.
          </p>
        )}
      </Card>
    </div>
  );
}
