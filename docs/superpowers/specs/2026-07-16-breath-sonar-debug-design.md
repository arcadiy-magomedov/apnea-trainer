# Breath Sonar Debug Widget

**Date:** 2026-07-16
**Status:** Approved for implementation
**Author:** @amagomedov_microsoft (with Copilot)

## 1. Overview

Add an experimental browser-based active-sonar screen that uses the phone
speaker and microphone to visualize slow breathing as a live sinusoid-like
motion trace and classify the current phase as **Inhale** or **Exhale**.

The first version is a diagnostic prototype for quiet, stationary use with the
phone approximately 15-30 cm from the face or upper chest. It is not a medical
device and does not detect apnea or diagnose respiratory conditions.

## 2. Goals

- Exercise active acoustic sensing through standard browser APIs.
- Run on supported iPhone Safari and Android Chrome devices.
- Probe the current device before claiming sonar support.
- Display a rolling waveform representing breathing-related motion.
- Display the current Inhale/Exhale state and signal quality.
- Expose enough live diagnostics to tune the experiment on real hardware.
- Keep all microphone processing local and ephemeral.
- Stop microphone and speaker use immediately when the experiment ends.

## 3. Non-goals

- No passive breath-sound fallback.
- No respiratory-rate calculation in the first version.
- No saved breathing sessions, history, or raw recordings.
- No background sensing.
- No support claim for every phone model.
- No detection during pose transitions or other gross body movement.
- No medical, sleep-apnea, or safety-critical use.
- No integration with the existing apnea training runner.

## 4. Navigation and entry point

- Add a hidden `/breath-debug` route rendered inside `AppShell`.
- Do not add Breath to the bottom `TabBar`.
- Add an **Experiments** card in Settings with a **Breath sonar** link.
- Label the screen and Settings entry as experimental.

The screen starts idle. Browser audio and microphone APIs are created only
after the user taps **Start sonar**, satisfying mobile user-gesture
requirements.

## 5. User experience

### 5.1 Setup

Before starting, the screen instructs the user to:

- use a quiet room;
- place the phone 15-30 cm from the face or upper chest;
- point the speaker and microphone toward the body;
- keep the phone and body still;
- use the phone speaker, not headphones or earbuds;
- stop if the high-frequency tone is audible or uncomfortable.

The emitted carrier is near the upper edge of human hearing, not guaranteed to
be inaudible to every person or animal.

### 5.2 States

The main status area uses these explicit states:

- `Idle`
- `Requesting microphone`
- `Checking device`
- `Calibrating - stay still`
- `Calibrating - inhale`
- `Calibrating - exhale`
- `Inhale`
- `Exhale`
- `Movement detected - hold still`
- `Poor signal`
- `Unsupported on this device or placement`
- `Error`

The UI never displays Inhale or Exhale while signal quality is too poor to
support the classification.

### 5.3 Widget

The debug widget contains:

- a large current-state label;
- a Good/Fair/Poor signal-quality badge;
- an SVG chart showing approximately the latest 20 seconds;
- a horizontal zero line;
- a normalized trace where calibrated inhale motion is oriented upward and
  exhale motion downward;
- a compact diagnostics panel;
- **Start sonar**, **Stop**, and **Recalibrate** controls.

The diagnostics panel shows:

- selected carrier frequency;
- `AudioContext` sample rate;
- carrier signal-to-noise ratio;
- phase-motion amplitude;
- current quality score;
- detected movement state.

## 6. Browser audio architecture

### 6.1 Capture and output

After the start gesture:

1. Verify a secure context, `navigator.mediaDevices.getUserMedia`,
   `AudioContext`, and `AudioWorklet` support.
2. Request a mono microphone stream with:
   - `echoCancellation: false`
   - `noiseSuppression: false`
   - `autoGainControl: false`
3. Create one `AudioContext` for both output and input processing.
4. Connect a sine `OscillatorNode` through a low-gain `GainNode` to the phone
   speaker.
5. Connect the microphone source to a dedicated `AudioWorkletNode`.

The output gain ramps up and down to avoid clicks and remains deliberately low.
The implementation does not claim that browsers or operating systems will
honor every requested raw-audio constraint.

### 6.2 Carrier probe

The device preflight tests candidate carriers near 18-20 kHz, excluding any
frequency above 45% of the actual sample rate. Each candidate is emitted
briefly and measured through narrow-band I/Q demodulation.

The probe selects the candidate with:

- at least 12 dB carrier-to-adjacent-band signal-to-noise ratio;
- stable phase over the stationary probe window;
- no clipping.

If no candidate meets the threshold, the experiment stops and reports an
unsupported device or placement. It does not draw a synthetic breathing wave.

Passing the carrier probe is necessary but not sufficient. The following
guided calibration must also observe coherent, opposite-direction motion.

## 7. Signal processing

### 7.1 Worklet processing

The `AudioWorklet` processes microphone samples off the UI thread. For the
selected carrier it:

1. multiplies incoming samples by synchronized sine and cosine references;
2. low-pass filters the mixed values into I/Q baseband components;
3. aggregates the result to an approximately 20 Hz update rate;
4. posts only derived I/Q, carrier magnitude, broadband energy, and clipping
   information to the main thread.

Raw microphone samples never leave the worklet and are never persisted.

### 7.2 Phase-motion signal

The pure signal-processing core:

1. calculates and unwraps carrier phase;
2. removes stationary phase offset and slow device drift;
3. band-limits motion to approximately 0.08-0.7 Hz;
4. normalizes the trace against a rolling robust amplitude estimate;
5. maintains a 20-second ring buffer for rendering.

The resulting trace represents carrier phase motion, not literal lung volume.
Multipath reflections and device processing can distort or invert it, which is
why per-run calibration is required.

### 7.3 Guided calibration

After a stationary baseline, the screen guides one slow inhale followed by one
slow exhale. Calibration succeeds only when:

- both segments rise clearly above the stationary phase-noise floor;
- their dominant phase directions oppose one another;
- neither segment is classified as gross movement.

The observed direction maps the normalized trace to inhale-up and exhale-down
for the current phone orientation. A failed calibration reports poor signal
and allows **Recalibrate**.

### 7.4 Breath-state classifier

The classifier uses the smoothed calibrated signal derivative with hysteresis
and a minimum dwell time. It retains the current state briefly around waveform
peaks and troughs instead of flickering between labels.

Large phase jumps, clipping, or broadband-energy spikes relative to the rolling
noise floor indicate gross movement. During movement:

- Inhale/Exhale classification is suspended;
- the UI shows `Movement detected - hold still`;
- the chart may continue to show the raw normalized disturbance for debugging;
- classification resumes only after a stable recovery window.

### 7.5 Signal quality

Quality combines:

- carrier signal-to-noise ratio;
- phase continuity;
- breathing-band amplitude above the stationary noise floor;
- clipping and movement penalties.

The score maps to:

- **Good:** `>= 0.70`
- **Fair:** `>= 0.45` and `< 0.70`
- **Poor:** `< 0.45`

Poor quality suppresses the Inhale/Exhale label until the signal recovers.

## 8. Component boundaries

The implementation is split into focused units:

### Browser sonar engine

Owns:

- browser capability checks;
- microphone permission and constraints;
- `AudioContext`, oscillator, gain, stream, and worklet wiring;
- carrier probing;
- start, stop, and recalibration lifecycle;
- conversion of browser errors into typed experiment errors.

It exposes derived samples and status events, not raw microphone buffers.

### Pure signal-processing core

Owns:

- carrier candidate scoring;
- phase unwrapping and filtering;
- calibration polarity and validation;
- movement detection;
- quality scoring;
- Inhale/Exhale state-machine transitions;
- normalized waveform samples.

It has no React or browser-global dependency so synthetic signals can test it
deterministically.

### React hook

Owns:

- engine construction and teardown;
- screen state;
- the rolling chart buffer;
- throttled UI updates;
- cleanup on unmount and page visibility loss.

### UI components

- `BreathDebugScreen` composes setup, controls, status, errors, and diagnostics.
- `BreathWaveform` renders the accessible SVG trace.
- Settings and routing expose the hidden experiment entry point.

No new runtime dependency is required.

## 9. Lifecycle and error handling

Stopping, route unmount, page visibility loss, or a fatal error must:

1. ramp the output gain to zero;
2. stop and disconnect the oscillator;
3. disconnect the worklet and microphone source;
4. stop every `MediaStreamTrack`;
5. close the `AudioContext`;
6. remove page lifecycle listeners;
7. clear live classification state.

Specific user-facing errors cover:

- insecure context;
- microphone permission denied;
- no microphone device;
- unsupported `AudioContext` or `AudioWorklet`;
- failure to resume audio after the user gesture;
- failed carrier probe;
- failed guided calibration;
- microphone or audio device loss during a run.

Errors are not converted into successful-looking fallback data.

## 10. Privacy and safety

- All processing stays on the device.
- Raw audio is neither stored nor transmitted.
- Derived samples and diagnostics are discarded when the screen stops.
- The browser microphone indicator remains the source of truth for active
  capture.
- The screen states that the feature is experimental and non-medical.
- The screen warns against headphones and notes that the carrier may be audible
  to some users or animals.
- Existing dry-land apnea safety guidance remains unchanged.

## 11. Testing

### 11.1 Pure processing tests

Vitest synthetic-signal tests cover:

- selecting the strongest valid carrier;
- rejecting low-SNR, unstable, and clipped carriers;
- phase unwrapping across positive and negative pi boundaries;
- drift removal and breathing-band filtering;
- successful and failed calibration;
- calibration polarity inversion;
- stable Inhale/Exhale transitions with hysteresis;
- suppression during movement spikes;
- recovery after movement;
- Good/Fair/Poor quality thresholds;
- bounded 20-second waveform buffering.

### 11.2 Browser engine tests

Mocked browser tests cover:

- requested microphone constraints;
- unsupported API and insecure-context errors;
- permission denial and missing-device errors;
- audio graph construction;
- carrier probe sequencing;
- idempotent stop;
- complete cleanup after stop, error, visibility loss, and unmount.

### 11.3 React tests

Testing Library tests cover:

- the Settings experiment link;
- rendering `/breath-debug`;
- idle, preflight, calibration, live, movement, poor-signal, unsupported, and
  error states through a fake engine;
- Start, Stop, and Recalibrate controls;
- the rolling SVG path and accessible chart label;
- visible diagnostics;
- route cleanup.

### 11.4 Manual device validation

Run the built PWA over HTTPS on:

- at least one current iPhone using Safari;
- at least one current Android phone using Chrome.

For each supported device:

1. place the phone 15-30 cm from the upper chest or face in a quiet room;
2. keep the phone and body still;
3. complete calibration;
4. perform five deliberately slow inhale/exhale cycles;
5. confirm at least four cycles receive the correct Inhale/Exhale sequence;
6. move deliberately and confirm classification pauses;
7. leave the route and confirm speaker output and microphone capture stop.

Hardware that cannot pass the probe or calibration is allowed to report
unsupported, but it must not display a fabricated breathing trace.

## 12. Acceptance criteria

- Settings links to a hidden `/breath-debug` experiment.
- Start is explicitly user initiated.
- Supported devices select a measured carrier rather than assuming 19 kHz.
- Unsupported or poor-signal devices fail visibly without synthetic data.
- Successful calibration produces a rolling sinusoid-like phase-motion chart.
- The current label distinguishes Inhale and Exhale while quality is adequate.
- Signal quality and core sonar diagnostics remain visible.
- Gross movement pauses classification.
- No raw audio or derived history is persisted or transmitted.
- Stop, navigation, page hiding, and errors release microphone and speaker
  resources.
- Manual validation succeeds on at least one iPhone Safari and one Android
  Chrome device under the stated setup conditions.
