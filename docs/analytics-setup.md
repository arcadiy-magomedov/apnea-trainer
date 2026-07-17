# Analytics Setup

This guide assumes no prior GA4 or Search Console experience. Complete one
checkpoint at a time.

Sections 1-5 may proceed now. For the current provider-owned-subdomain rollout,
sections 6-10 require Task 12 release approval and deployment. Sections 11-13
remain post-deployment operational work.

> **STOP - complete one checkpoint at a time:** Do not configure DigitalOcean
> build variables, trigger a deployment, perform live-browser, Tag Assistant,
> or DebugView verification, or verify and link the provider-owned production
> URL in Search Console before Task 12 explicit release approval. Sections
> 9-10 are post-deployment for the current rollout. Section 11 requires matching
> live events and roughly 24-48 hours of processing before its event-scoped
> custom dimensions can be selected and populated; custom dimensions do not
> backfill.

## 1. Create the GA4 account and property

1. Open https://analytics.google.com and sign in with the Google account that
   will own Apnea Trainer analytics.
2. Open **Admin**.
3. Select **Create > Account** if no suitable account exists.
4. Use account name **Apnea Trainer**.
5. Select **Create > Property**.
6. Use property name **Apnea Trainer**.
7. Choose the reporting time zone and currency you will use for revenue
   decisions.
8. Complete the business-details screens without enabling advertising
   features.

Checkpoint: the GA4 property appears in the property selector.

## 2. Create the web data stream

1. In **Admin > Data collection and modification > Data streams**, select
   **Web**.
2. Use the current production URL shown by DigitalOcean App Platform.
3. Use stream name **Apnea Trainer Web**.
4. Turn **Enhanced measurement** off. The app sends an explicit allow-listed
   event schema instead.
5. Select **Create stream**.
6. Copy the Measurement ID beginning with `G-`.

Checkpoint: save the Measurement ID in a password manager or private note and
provide it to the implementation agent when asked.

## 3. Apply privacy settings

1. In **Admin > Data collection and modification > Data retention**, set event
   data retention to **2 months** and save.
2. In **Admin > Data collection and modification > Data collection**, leave
   **Google signals** disabled.
3. In the same area, open the advanced ads-personalization settings and disable
   ads personalization for all regions.
4. Do not create User-ID rules, audiences for advertising, or Google Ads links.
5. Do not create an AdSense link during this phase.

Checkpoint: retention is 2 months, Google signals is off, and ads
personalization is off.

## 4. Register custom dimensions

In **Admin > Data display > Custom definitions**, create event-scoped custom
dimensions with the exact parameter names below:

| Dimension name | Event parameter |
|---|---|
| App version | `app_version` |
| Surface | `surface` |
| Install mode | `install_mode` |
| Network state | `network_state` |
| Session type | `session_type` |
| Duration bucket | `duration_bucket` |
| Day relation | `day_relation` |
| Ad opportunity placement | `placement` |

Do not register exact duration, goal, baseline, contraction, RPE, session ID,
or reminder parameters.

Checkpoint: all eight event-scoped dimensions are listed.

## 5. Configure key events

In **Admin**, under **Data display**, open **Events** (or **Key events**,
depending on the current GA4 navigation), then configure these exact event
names:

- `onboarding_completed`
- `baseline_completed`
- `training_session_completed`

If the UI offers only **Create event**, create each name separately, select
**Mark as key event**, leave the default monetary value unset, select **Once per
event**, and choose **Create with code**. Do not create matching conditions or
send the event from GA4; the app already emits each event.

Add `content_cta_selected` only after the SEO content workstream emits it.

Checkpoint: the three initial key events are configured.

## 6. Configure DigitalOcean build variables

1. Open the Apnea Trainer app in DigitalOcean App Platform.
2. Open **Settings**.
3. Select the static-site component.
4. Open **Environment Variables** and choose **Edit**.
5. Add `VITE_GA_MEASUREMENT_ID` with the `G-` value copied from GA4.
6. Add `VITE_PRIVACY_CONTACT_EMAIL` with the monitored address that will
   receive analytics access/deletion requests. It will be publicly visible on
   the Privacy page.
7. Set both variables for build time. They are public configuration, not
   secrets.
8. Save and trigger a new deployment.

Checkpoint: the deployment succeeds and the Privacy page shows the configured
contact address.

## 7. Verify consent behavior before checking GA

1. Open the deployed site in a private browser window with developer tools.
2. Open the Network panel and filter for `collect` and `googletagmanager`.
3. Before choosing analytics consent, verify that neither the Google tag nor a
   GA collection request is present.
4. Select **Do not share** and verify requests are still absent.
5. Clear site data or use another private window.
6. Select **Share usage analytics**.
7. Verify that `gtag/js?id=<the exact Measurement ID copied in section 2>`
   loads and GA collection requests begin.
8. If a blocker prevents this verification, disable it only for this test and
   repeat the opt-in check.
9. Open Settings, turn analytics off, and verify new collection requests stop.
10. In the browser Application/Storage panel, verify `_ga` and `_ga_*` cookies
    are gone and the anonymous identifier is no longer shown in Settings.

Checkpoint: there is no Google request before consent and withdrawal stops
future collection.

## 8. Verify events with Tag Assistant and DebugView

1. Open https://tagassistant.google.com.
2. Start a session for the deployed production URL.
3. Accept analytics consent in the connected browser.
4. In GA4, open **Admin > Data display > DebugView**.
5. Visit Home, Calendar, Stats, and Settings.
6. Complete a disposable onboarding/baseline/session flow if safe to do so.
7. Confirm event names and inspect parameters.
8. Verify that no payload contains exact hold, baseline, goal, contraction,
   RPE, reminder, session ID, or query-string values.

Checkpoint: approved events appear in DebugView with only allowed properties.

For future campaign links, use lower-case slug values such as
`utm_source=reddit&utm_medium=community&utm_campaign=launch-2026`. The app
discards spaces, email-like values, unknown query parameters, and the raw query
string.

## 9. Add Search Console

1. Open https://search.google.com/search-console.
2. Select **Add property**.
3. For a custom domain you control, choose **Domain**, enter the production
   domain without protocol or path, and verify it by adding Google's DNS TXT
   record at the domain's DNS provider.
4. For a provider-owned subdomain such as `ondigitalocean.app`, choose
   **URL-prefix** and enter the exact deployed production URL, including
   protocol.
5. Use Search Console's **HTML file upload** or **HTML meta tag** method. Google
   Analytics tag verification is unsuitable for this app because its tag is
   intentionally not loaded until the visitor grants analytics consent, while
   the ownership verifier requires the tag in the homepage head without that
   interaction.
6. After Task 12 release approval, when Search Console supplies the
   verification file or token, add it to the static app: place a root
   verification file in `public/`, or add the supplied meta tag to
   `index.html`. Deploy that artifact, then ask Search Console to verify it. Do
   not invent or add a verification file or token before Search Console
   supplies it.
7. You cannot verify the parent **Domain** property for a provider-owned
   subdomain without control of the parent DNS.
8. For this repository's current rollout, wait until Task 12 release approval
   and deployment, then add and verify the exact DigitalOcean URL-prefix
   property.

Checkpoint: the applicable property shows as verified. If custom-domain DNS
access is unfamiliar, stop after copying the TXT record and ask the
implementation agent to guide the specific DNS provider. Do not submit a
sitemap until the separate SEO content workstream creates one.

## 10. Link Search Console to GA4

Complete this section only after the applicable Search Console property is
verified. For the current DigitalOcean URL-prefix path, this is post-deployment
and remains behind Task 12 release approval.

1. In GA4, open **Admin > Product links > Search Console Links**.
2. Select **Link**.
3. Choose the verified Search Console property.
4. Choose **Apnea Trainer Web** as the web stream.
5. Review and submit.

Checkpoint: the link appears in GA4. Search data can take time to populate.

## 11. Create the initial reports

Run this section only after deployment, section 8 event verification, and
roughly 24-48 hours of processing for matching live events. The `placement`,
`session_type`, and `duration_bucket` event-scoped custom dimensions do not
backfill and cannot be selected or populated before matching events are
processed. Funnel and cohort scaffolding may be created earlier, but it will
remain empty and does not complete this section.

1. Open **Explore** and select **Funnel exploration**.
2. Name it **Activation funnel**.
3. Add these closed-funnel steps in order:
   `page_view`, `onboarding_started`, `onboarding_completed`,
   `baseline_completed`, and `training_session_completed`.
4. Save the exploration.
5. Open **Explore** and select **Cohort exploration**.
6. Name it **D1 D7 D30 retention**, use first visit as inclusion, any event as
   return, and inspect day 1, day 7, and day 30. Add Session source / medium as
   a breakdown when enough data exists.
7. Open **Explore > Blank** and name it **Ad opportunity inventory**.
8. Add dimensions `placement`, Country, Device category, and Session source /
   medium. Add Event count as the metric and filter Event name exactly matches
   `ad_opportunity_viewable`.
9. Open another blank exploration named **Session completion**.
10. Add Event name and `session_type`, use Event count, and filter Event name
    to `training_session_started` or `training_session_completed`.
11. Create a second tab named **Session duration outcomes**, add
    `duration_bucket`, and filter Event name to
    `training_session_completed` or `training_session_abandoned`.

Do not optimize or report ad CTR because no live ads exist in this phase.

## 12. Maintain the ad-viability model

After at least four stable weeks, copy the monthly
`ad_opportunity_viewable` count into a spreadsheet. Keep three rows named Low,
Base, and High with explicit assumptions for:

- consent/ad-eligibility rate;
- non-blocked rate;
- coverage;
- net eCPM.

For each row calculate:

```text
projected served impressions =
  monthly viewable opportunities
  * consent/ad-eligibility rate
  * non-blocked rate
  * coverage

projected monthly revenue =
  projected served impressions / 1000
  * net eCPM
```

Label every assumption. Do not present a scenario as measured revenue, and do
not begin the separate ad-pilot workstream unless the base case has a credible
path to at least $100 per month.

## 13. Process an analytics deletion request

1. Ask the requester for the anonymous analytics identifier copied from
   Settings. Never ask for training data or account credentials.
2. In GA4, open **Explore > User explorer** and locate the matching client ID.
3. Open that user record and use **Delete user**.
4. Record only the request date, completion date, and a non-identifying ticket
   reference outside GA4.
5. If the GA4 UI does not expose individual deletion for the property, stop
   and consult the Google Analytics Admin API
   [`properties.submitUserDeletion`](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1alpha/properties/submitUserDeletion)
   documentation rather than inventing a manual workaround.

Checkpoint: the matching user deletion was accepted by GA4 and the requester
was notified.
