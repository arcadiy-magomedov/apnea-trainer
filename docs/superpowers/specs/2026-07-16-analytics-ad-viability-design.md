# Apnea Trainer Analytics and Ad-Viability Design

**Date:** 2026-07-16
**Status:** Approved for planning
**Author:** @amagomedov_microsoft (with Copilot)

## 1. Decision

Apnea Trainer will launch with a consent-gated analytics foundation based on:

- **Google Analytics 4 (GA4)** for acquisition, product funnels, retention, and
  future AdSense revenue reporting.
- **Google Search Console** for organic-search impressions, clicks, queries, and
  landing-page performance.
- A typed, vendor-neutral analytics boundary inside the app so UI and
  application code never call `gtag` directly.

The first release will not contain ads, an ad SDK, session replay, DOM
autocapture, or PostHog. It will measure realistic future ad opportunities and
collect enough evidence to decide whether a programmatic-ad pilot is justified.

The target business outcome is meaningful side income of approximately
**$100-$500 per month** without degrading the training experience.

## 2. Workstream Decomposition

This initiative is split into three independently planned workstreams:

1. **Analytics foundation** — this specification.
2. **SEO content publishing** — a later specification for indexable
   apnea-training guides, metadata, sitemap generation, and article-to-app
   conversion paths.
3. **Ad pilot** — a later specification covering publisher approval, a
   Google-certified consent management platform (CMP), ad placement, control
   cohorts, revenue reporting, and policy checks.

Keeping these separate avoids introducing ads before the app has an audience
and keeps analytics implementation focused and testable.

## 3. Goals

- Measure acquisition from search, communities, social sharing, and campaigns.
- Measure the consented-user funnel from first visit through onboarding,
  baseline completion, first completed session, and return usage.
- Measure anonymous D1, D7, and D30 retention and sessions per active user.
- Understand adoption of important product surfaces and actions.
- Estimate monthly viewable ad opportunities on approved non-training surfaces.
- Support future GA4-AdSense reporting without re-instrumenting the app.
- Preserve the app's local-first reliability and health-data privacy.

## 4. Non-Goals

- Showing live ads.
- Tracking every click or DOM interaction.
- Session replay, heatmaps, input capture, or user recordings.
- Marketing attribution across devices.
- Accounts, cross-device identity, or a backend analytics proxy.
- Personalized advertising, remarketing, or health-based audience creation.
- Implementing SEO content pages in this workstream.
- Adding PostHog, Mixpanel, Amplitude, Segment, or another second analytics SDK.

## 5. Product and Policy Constraints

Apnea Trainer is a health-adjacent, offline-capable PWA whose current state is
stored only on the device. Telemetry is the first feature that transmits usage
data off-device, so it must use explicit consent and strict data minimization.

Ads are never permitted during onboarding safety acknowledgement, baseline
measurement, an active training session, or any timed hold/rest phase. Candidate
future app placements are limited to:

- Home
- Stats
- Calendar
- Summary

Public content pages may later contain separate candidate placements.

Google Publisher Policies do not allow Google-served ads on screens without
publisher content, with low-value content, or used primarily for navigation or
behavioral purposes. Personalized dashboard screens therefore require a
separate policy review before any app-screen ad pilot. The safest first pilot is
on a substantive public content page.

Training data must never be used to personalize ads or build advertising
audiences. GA advertising personalization and Google Signals remain disabled.

## 6. Architecture

### 6.1 Analytics boundary

Add an `AnalyticsService` to the existing injected `Services` bundle. The
interface belongs to the application-facing analytics boundary rather than the
pure apnea domain.

Conceptual interface:

```ts
export interface AnalyticsService {
  readonly available: boolean;
  setConsent(consent: AnalyticsConsent): Promise<void>;
  track(event: AnalyticsEvent): void;
  getAnonymousId(): Promise<string | null>;
  reset(): Promise<void>;
}
```

Implementations:

- `Ga4AnalyticsService` in `src/infrastructure/analytics/`
- `NoopAnalyticsService` for local fallback
- `FakeAnalyticsService` in tests

UI components and application use cases depend only on `AnalyticsService`.
Vendor-specific event mapping, tag loading, cookie handling, and payload
sanitization stay inside the GA4 adapter.

### 6.2 Consent storage

Analytics consent is device-specific and must not be added to `AppState`.
Importing a training backup on another device must never grant analytics
consent.

Store consent separately with three states:

- `unknown`
- `granted`
- `denied`

The storage adapter records the choice and its timestamp locally. It contains no
training data and is excluded from JSON export/import.

### 6.3 Runtime lifecycle

Add an analytics lifecycle component below `BrowserRouter` that:

1. Reads the device-local consent state.
2. Leaves analytics disabled while consent is `unknown` or `denied`.
3. Loads and initializes GA4 only after consent becomes `granted`.
4. Tracks normalized route changes once per real SPA navigation.
5. Applies consent changes immediately.

React development Strict Mode and route re-renders must not produce duplicate
screen events.

When analytics configuration is absent or invalid, the no-op service reports
`available: false`; the consent prompt stays hidden and Settings explains that
analytics is not configured in that build.

### 6.4 Configuration

The GA measurement ID and privacy contact are supplied through
`VITE_GA_MEASUREMENT_ID` and `VITE_PRIVACY_CONTACT_EMAIL`. Tests and local
development may omit them and receive the no-op implementation. A
telemetry-enabled production release is blocked until both values are
configured.

## 7. Consent and User Controls

Analytics consent is optional and visually separate from the mandatory apnea
safety acknowledgement.

The first-use prompt must:

- explain that anonymous usage data leaves the device;
- list the purposes: improve the app and evaluate whether non-training screens
  could support ads;
- state that exact training measurements are not collected;
- offer equally clear accept and decline actions;
- avoid preselected choices or dark patterns.

Settings adds **Share anonymous usage analytics**. Changing it to off:

1. Stops all future collection immediately.
2. Updates GA consent to denied.
3. Clears GA cookies and local analytics identifiers.
4. Leaves all training state untouched.

The Privacy page must document:

- GA4 as the processor;
- the event categories and prohibited data;
- the two-month GA event/user-data retention setting;
- the purpose of coarse country and device reporting;
- how to withdraw consent;
- how to request deletion of previously collected data;
- the monitored public contact address configured for the deployment.

When consent is granted, Settings displays a copyable opaque analytics
identifier. It is used only to support a deletion request. Because the app has
no trusted backend, deletion is an owner-operated process using Google's user
deletion tooling.

## 8. GA4 Privacy Configuration

Configure the GA4 property and tag as follows:

- Event and user data retention: **2 months**.
- Google Signals: **off**.
- Ads personalization: **off**.
- User-ID: **not used**.
- Custom advertising audiences: **not created**.
- Automatic page/screen collection: **off** with `send_page_view: false`;
  normalized SPA page views are sent manually.
- Raw query strings: **not sent**.
- Only bounded lower-case `utm_*` campaign slugs are mapped to GA campaign
  fields; all other query parameters are discarded.
- Application-supplied exact or custom location: **not sent**.
- No custom personally identifiable information.
- No exact health, performance, or reminder values.
- Consent defaults to denied and the tag is not loaded before opt-in.

Country and device category may be used in aggregate reports because ad demand
varies materially across those dimensions. They must never be combined with
training outcomes to target ads.

The analytics dataset represents consenting users only. Reports must not present
it as a complete count of all app users.

## 9. Event Taxonomy

Event names use stable lower-case snake case. Properties are finite,
low-cardinality enums unless explicitly noted.

GA4 may still create its required system events, such as `first_visit`,
`session_start`, and `user_engagement`, after the consented tag is initialized.
These are accepted vendor-generated events. Product code emits only the
application events defined below.

Common properties:

| Property | Allowed values |
|---|---|
| `app_version` | Build version |
| `surface` | Stable screen/content identifier |
| `install_mode` | `browser`, `standalone` |
| `network_state` | `online`, `offline` |

### 9.1 Acquisition and content

| Event | Trigger | Additional properties |
|---|---|---|
| `page_view` | Normalized app or content navigation | `surface`, normalized path |
| `content_cta_selected` | A public guide sends a user into the app | `content_slug`, `cta_name` |

Campaign parameters and referrer data use GA's standard acquisition fields.
Content slugs are publisher-authored and must never contain user data.

### 9.2 Activation

| Event | Trigger | Additional properties |
|---|---|---|
| `onboarding_started` | Consented user enters onboarding | none |
| `onboarding_completed` | Safety acknowledgement and onboarding complete | none |
| `baseline_started` | Baseline flow begins | none |
| `baseline_completed` | Baseline is saved | none |
| `baseline_abandoned` | User exits an incomplete baseline flow after starting an attempt | none |

No baseline duration or contraction value is included.

### 9.3 Engagement

| Event | Trigger | Additional properties |
|---|---|---|
| `training_session_started` | A prescribed session starts | `session_type` |
| `training_session_completed` | Session completes | `session_type`, `duration_bucket` |
| `training_session_abandoned` | User cancels or exits | `session_type`, `duration_bucket` |
| `goal_created` | First goal is saved | none |
| `goal_updated` | Existing goal changes | none |
| `goal_cleared` | Goal is removed | none |
| `calendar_day_opened` | Calendar drawer opens | `day_relation` |
| `pwa_install_accepted` | A supported browser reports that its install prompt was accepted | none |

Allowed `session_type` values are `co2`, `o2`, and `max`.

Allowed `duration_bucket` values are:

- `under_10m`
- `10_to_20m`
- `20_to_30m`
- `30m_plus`

Allowed `day_relation` values are `past`, `today`, and `future`.

No per-round, contraction, phase, RPE, tap-out timing, target, or achieved value
is transmitted. An active Runner emits no high-frequency UI telemetry.

### 9.4 Potential ad inventory

| Event | Trigger | Additional properties |
|---|---|---|
| `ad_opportunity_viewable` | A candidate placement location is at least 50% visible for at least one continuous second | `placement`, `surface` |

Initial app placement values:

- `home_inline`
- `stats_inline`
- `calendar_inline`
- `summary_inline`

The probe observes an existing candidate container and does not render an empty
ad-sized gap or change page layout. It fires at most once per placement per
route view.

Do not emit `ad_impression`, `ad_click`, or `ad_query` before live ads exist.
Those names are reserved for the future GA4-AdSense integration.

## 10. Prohibited Data

The typed schema and runtime sanitizer must reject:

- exact hold, rest, contraction, or session times;
- baseline and goal values;
- RPE and detailed failure/adaptation data;
- reminder times;
- session, baseline, or goal IDs;
- names, email addresses, phone numbers, or free text;
- DOM text, element selectors, or input contents;
- IndexedDB records or exported backup data;
- raw URLs, query strings, or URL fragments;
- precise location;
- arbitrary objects or unbounded strings.

The adapter uses an event/property allow-list. Unknown events or properties are
programming errors, not pass-through data.

## 11. Data Flow

```text
User action or route change
        |
        v
Typed AnalyticsEvent
        |
        v
Consent gate
        |
        v
Runtime event/property allow-list
        |
        v
GA4 adapter and Google tag
        |
        v
GA4 reports / Explorations / future AdSense join

Search engine crawl and clicks
        |
        v
Google Search Console
        |
        v
Search performance reports and GA4-linked analysis
```

Tracking is fire-and-forget from product code. Analytics success or failure
never changes a use-case result, navigation decision, timer, persistence write,
cue, notification, or PWA update behavior.

## 12. Search Console Setup

The analytics foundation includes operational setup for:

- DNS-level domain verification.
- Search Console ownership for the production domain.
- Linking Search Console to the GA4 property.
- Submitting a sitemap once the SEO content workstream creates one.
- Separating branded, non-branded, and guide-level search performance.

Search Console adds no browser runtime code and does not replace GA4 product
events.

## 13. Reporting

Create four initial GA4/Search Console reporting views.

### 13.1 Acquisition

- Search impressions, clicks, CTR, and average position.
- Source/medium and campaign.
- Landing surface.
- Public content to app CTA conversion.

### 13.2 Activation

Funnel:

1. First app visit.
2. Onboarding started.
3. Onboarding completed.
4. Baseline completed.
5. First training session completed.

### 13.3 Retention and engagement

- D1, D7, and D30 return.
- DAU, WAU, and MAU.
- Sessions per active user per month.
- Training session start-to-completion rate.
- PWA install acceptance and installed-mode usage.
- Screen adoption derived from normalized `page_view` events.

### 13.4 Ad opportunity model

- Monthly `ad_opportunity_viewable` count.
- Opportunities per MAU and per session.
- Breakdown by placement, country, device, and acquisition source.
- Revenue scenarios at low, base, and high assumed net eCPM.

Before live ads exist, the model is:

```text
projected served impressions =
  viewable opportunities
  * assumed consent/ad-eligibility rate
  * assumed non-blocked rate
  * assumed coverage

projected monthly revenue =
  projected served impressions / 1,000
  * assumed net eCPM
```

Every assumption must be displayed next to the projection. Before a live pilot,
consent/ad eligibility, blocker loss, coverage, and eCPM are scenario inputs,
not measured facts or promised market benchmarks.

## 14. Rollout

### Phase 1: Instrumentation

- Add consent and Privacy UI.
- Add the analytics service boundary and GA4 adapter.
- Add approved events and ad-opportunity probes.
- Configure GA4 and Search Console.
- Verify events in GA4 DebugView.
- Release with no ads.

### Phase 2: Evidence collection

- Collect at least four stable weeks of consented data.
- Review acquisition, activation, retention, and potential inventory.
- Publish SEO content under its separate design and implementation plan.
- Recalculate low/base/high revenue scenarios as traffic grows.

### Phase 3: Separate ad-pilot decision

Write the ad-pilot specification only when the base scenario projects
approximately $100 per month and traffic is stable enough to evaluate an ad
cohort against an ad-free cohort.

The first pilot should prefer one substantive content-page placement. App-screen
placements remain deferred until AdSense approval and a policy review confirm
that the surface has sufficient publisher content.

## 15. Future Ad-Pilot Success Criteria

The later pilot must measure:

- ad requests and served impressions;
- coverage/fill;
- Active View viewability;
- impression and page RPM;
- actual monthly revenue and revenue per MAU;
- Core Web Vitals;
- D7 and D30 retention by ad/control cohort;
- training session completion by cohort;
- consent and opt-out behavior.

Continue an ad-funded strategy only when:

- revenue has a credible current or near-term path to $100-$500 per month;
- D7 and D30 retention do not decline by more than 5% relative to the ad-free
  cohort;
- training completion does not decline by more than 5% relative;
- Core Web Vitals remain in their good ranges at the 75th percentile: LCP at or
  below 2.5 seconds, INP at or below 200 milliseconds, and CLS at or below 0.1;
- publisher and consent policies remain satisfied.

CTR is not a product optimization target. The app must never encourage ad
clicks or place ads where training controls could cause accidental clicks.

## 16. Error Handling and Offline Behavior

Analytics is non-critical infrastructure.

- Missing configuration selects the no-op adapter and emits one development
  diagnostic.
- A scoped GA script-load failure disables analytics for that page lifetime and
  emits one development diagnostic.
- Invalid event schemas throw in tests/development. Production drops the event
  and writes one structured console warning without affecting the app.
- Network failures and blockers do not surface a user-facing error.
- No custom persistent offline telemetry queue is added.
- Consent changes are applied even when GA is unavailable.

The app remains fully usable offline. Analytics incompleteness is accepted over
adding another store of behavioral data on the device.

## 17. Testing

Implementation follows the repository's TDD workflow.

### Unit tests

- Consent storage defaults to `unknown`.
- Consent is not included in app-state export/import.
- GA4 is not initialized before consent.
- Granting consent initializes analytics once.
- Withdrawal stops tracking and clears local identifiers.
- Every event accepts only its declared properties and enum values.
- Prohibited and unknown properties are rejected.
- Duration bucketing never exposes exact values.
- Route tracking emits once per real navigation.
- The no-op service never throws.

### Component and integration tests

- `ServicesProvider` injects a fake analytics service.
- Consent prompt accept/decline paths are accessible and independent from the
  safety acknowledgement.
- Settings reflects and updates consent.
- Key UI actions emit the correct semantic event.
- Runner interactions do not emit granular phase/contraction events.
- Candidate placement viewability uses the 50%-for-one-second rule and fires
  once per route view.
- Raw query strings are removed from page tracking.

### External verification

- Confirm the production tag in GA4 DebugView.
- Confirm no requests occur before consent.
- Confirm opt-out stops requests and clears identifiers.
- Confirm Search Console domain verification and GA4 link.

No new test framework is introduced.

## 18. Acceptance Criteria

The analytics foundation is complete when:

- users can explicitly accept, decline, and later withdraw analytics consent;
- no GA request is made before consent;
- GA4 receives only the approved typed application events plus documented
  GA-generated system events;
- exact training values and prohibited data cannot enter analytics payloads;
- normalized SPA routes are tracked without duplicates;
- Home, Stats, Calendar, and Summary produce realistic viewable-opportunity
  counts without rendering ads or empty ad space;
- Search Console is verified and linked;
- the four initial reporting views can answer acquisition, activation,
  retention, and potential-inventory questions;
- analytics failures cannot interrupt or alter training;
- Privacy documentation and a monitored deletion-request contact are live;
- all targeted tests pass.

## 19. Current 2026 References

- [GA4 and AdSense integration](https://support.google.com/analytics/answer/13610380)
- [GA4 event collection](https://developers.google.com/analytics/devguides/collection/ga4/events)
- [Google-served ads on screens without publisher content](https://support.google.com/publisherpolicies/answer/11112688)
- [Google restricted targeting in personalized advertising](https://support.google.com/adspolicy/answer/143465)
- [Google consent requirements for EEA/UK/Switzerland](https://support.google.com/adsense/answer/13554020)
- [Google Publisher Tag React integration](https://developers.google.com/publisher-tag/samples/integrations/react)
