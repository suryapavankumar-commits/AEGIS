# AEGIS — Rime Voice Evidence

## Hard voice problem

**Interruption and recovery during emergency coordination.** AEGIS must remain usable when the user changes or corrects an emergency report while the agent is speaking or while a slow coordination lookup is running.

Removing speech would materially weaken the product: emergency reporters need hands-free, screen-light interaction, and the judged flow depends on listening, speaking, and correcting information in real time.

## Primary Rime configuration

| Field | Shipped value |
|---|---|
| Provider | Rime |
| Model | `coda` |
| Voice | `celeste` |
| Language | `en` |
| TTS integration | Official `@livekit/agents-plugin-rime` |
| Rime endpoint | `wss://users-ws.rime.ai` (plugin default for WebSocket mode) |
| Transport | LiveKit realtime audio over WebRTC from browser to agent |
| Output | LiveKit audio track rendered by the browser |
| Audio format | PCM (Rime plugin default) |
| Rime sample rate | 16000 Hz (Rime plugin default) |

The application uses Rime as the default and primary spoken-output path. The official Rime plugin uses Rime WebSocket streaming.

## Acceptance test

### Normal case
1. Start an AEGIS voice session.
2. Say: “There is a fire in the engineering building. Two people are trapped.”
3. Confirm that AEGIS creates an incident and speaks a concise acknowledgement.
4. Say: “Correction: there are three people trapped.”
5. Confirm that AEGIS updates the current incident instead of creating a duplicate.

### Deliberate interruption/stress case
1. Start a voice session.
2. Say: “There is a fire near the main gate. Please verify the situation.”
3. During the response or while a slow lookup is running, interrupt with: “Stop. The location is actually the north gate, and nobody is trapped.”
4. Confirm that queued speech stops promptly.
5. Confirm that the newest instruction becomes the current incident state.
6. Confirm that an obsolete tool result is not presented as the current state.
7. Confirm that the next spoken response reflects the corrected location and trapped-person count.

LiveKit's turn handling is configured for adaptive interruptions and preemptive generation. Rime is streamed over WebSocket, and the verification tool is cancellable via the LiveKit tool abort signal so obsolete work can be cancelled rather than reintroduced after a correction.

## Repeatable fixture

The test prompts are stored in `evidence/voice-stress-fixture.json`.

Run the static preflight with:

```bash
npm run preflight
```

Run the incident-state tests with:

```bash
npm test
```

For the live acceptance test, use the exact fixture steps above against the running web app. Record the result and measured user-visible interruption/first-audio timings in `evidence/RUN_RESULTS.md` before submission.

## What to measure

Measure the user-visible path, not just model latency:

- End of user turn → first audible Rime response.
- Time from interruption → cessation of queued agent audio.
- Time from correction → next audible response.
- Whether stale tool output re-enters the conversation.

Record warm and cold runs separately. Do not claim a performance number until it has been measured on the shipped configuration.

## Current limitations

- The included incident manager is in-memory; incidents are lost when the agent process restarts.
- Location is currently supplied by the user's spoken report; there is no geocoding or responder dispatch integration.
- The repository cannot contain live Rime/LiveKit secrets. Configure them locally or through the deployment platform.
- The browser demo uses WebRTC/LiveKit audio; this evidence does not claim telephony performance.

## Submission checklist

- [ ] Record a ≤4–5 minute demo showing target user/problem, normal flow, hard voice problem, deliberate stress case, result/measurement, and active Rime provider.
- [ ] Push this source repository.
- [ ] Verify the exact model, voice, language, endpoint/integration, audio format, and transport used in the recording.
- [ ] Fill in `evidence/RUN_RESULTS.md` with real measured results.
- [ ] Run `npm run preflight` before the final submission.
- [ ] Ensure no live credential is committed.


## Hospital search / routing evidence

The emergency voice workflow now includes a cancellable-compatible hospital assistance path without changing the primary Rime Coda/Celeste voice pipeline:

1. Browser location is sent over LiveKit data as `aegis.location` when the user grants location access.
2. `findNearbyHospitals` searches Google Places when `GOOGLE_MAPS_API_KEY` is configured and falls back to OpenStreetMap hospital data when it is not.
3. Results retain rating, review count, and computed distance when available.
4. The recommendation score uses rating (55%), review volume (25%), and distance (20%). This is explicitly a convenience ranking, not a medical-quality judgment.
5. `routeToHospital` preserves the ordered result list, so requests such as “route me to the second hospital” resolve to the same session result.
6. The agent publishes a `route_to_hospital` LiveKit data message; the web client opens Google Maps directions automatically.

The UI and voice copy must never describe a hospital as medically “best.” The safe phrasing is that AEGIS recommends an option **based on available ratings, review volume, and distance**.
