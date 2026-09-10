# AEGIS — Voice-Native Emergency Coordination

AEGIS is a real-time, voice-first emergency coordination prototype. The judged interaction is speech-native: the user reports an emergency, corrects details while AEGIS is responding, and AEGIS maintains the latest structured incident state.
## Demo

🎥 **Demo Video:** https://youtu.be/Hc021J6WqBg

## Hackathon alignment

This repository is prepared around the Rime Hackathon Challenge requirements:

- **Rime is the primary spoken output**, not an incidental welcome message.
- **Hard voice problem:** interruption and recovery while an emergency is changing.
- **Real-time transport:** LiveKit WebRTC.
- **TTS:** official LiveKit Rime plugin, Coda model, Celeste voice, WebSocket streaming.
- **STT:** AssemblyAI Universal-3-5-Pro through LiveKit Inference.
- **LLM:** Gemma 4 31B through LiveKit Inference.
- **Evidence:** `agent/aegis-agent/RIME_EVIDENCE.md`, fixtures, and a preflight command.
- **Hospital assistance:** nearby hospital search, rating/review/distance-aware recommendations, and Google Maps routing.

## Architecture

```text
Browser microphone
       │
       ▼
 LiveKit WebRTC room
       │
       ▼
 AEGIS LiveKit Agent
   ├── AssemblyAI STT
   ├── Gemma 4 31B LLM
   ├── Incident tools / state
   ├── Nearby hospital search + ranking
   ├── Google Maps routing commands
   └── Rime Coda TTS (WebSocket)
       │
       ▼
 LiveKit audio track
       │
       ▼
 Browser speaker
```

## Repository layout

- `web/` — Next.js browser client and secure LiveKit token route.
- `agent/aegis-agent/` — LiveKit voice agent, incident manager, Rime TTS integration, tests, and evidence.
- `agent/aegis-agent/RIME_EVIDENCE.md` — hard voice claim, acceptance test, measurements, limitations, and submission checklist.
- `agent/aegis-agent/evidence/voice-stress-fixture.json` — repeatable stress-test fixture.
- `agent/aegis-agent/evidence/RUN_RESULTS.md` — fill with real measurements before submitting.

## Setup

### 1. Agent

```bash
cd agent/aegis-agent
pnpm install
copy .env.example .env.local
```

Set:

```text
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
RIME_API_KEY=
RIME_MODEL=coda
RIME_VOICE=celeste
RIME_LANGUAGE=en
RIME_SPEED_ALPHA=0.95
GOOGLE_MAPS_API_KEY=   # optional; enables Google Places search, phone/opening/rating data, and driving ETA (Places API + Directions API)
```

`RIME_API_KEY` must stay server-side. Never commit `.env.local` or a real key.

Run:

```bash
pnpm run preflight
pnpm run typecheck
pnpm test
pnpm run dev
```

### 2. Web

```bash
cd web
npm install
```

Create `web/.env.local` with:

```text
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
```

Then:

```bash
npm run dev
```

Open `http://localhost:3000`.

Run the browser production check with:

```bash
npm run build
```

## Demo flow

The recommended 4–5 minute recording flow is in `DEMO_SCRIPT.md`. It deliberately demonstrates:

1. the target user/problem;
2. a normal emergency report;
3. a correction to the same incident;
4. a slow verification request;
5. a mid-response interruption/correction;
6. cancellation/recovery and the final current state;
7. the visible Rime provider/model/voice indicator;
8. measured results from `evidence/RUN_RESULTS.md`.

## Important limitations

This is a hackathon prototype. Incident state is in-memory and is lost when the agent process restarts. There is no real emergency-service dispatch, SMS/call escalation, authentication, or production responder database. The demo must not imply that emergency services were contacted unless a real integration confirms it. Hospital recommendations are informational and are ranked only from available rating, review-volume, and distance signals; AEGIS must not describe a hospital as medically “best.”

## Hospital search and routing

AEGIS searches for nearby hospitals from real coordinates. The browser-provided GPS position (including accuracy and timestamp) is the primary source; the current incident location and spoken place names are geocoded fallbacks used only when GPS is unavailable. Searches start at a 5 km radius and expand to 10 km only when no suitable hospital is found. Results are ranked server-side for emergency suitability using distance and driving ETA first, then opening status, phone availability, and rating as tie-breakers. Each result carries its distance, driving ETA when available (Google Directions API), phone number, opening status, rating, and a Google Maps directions URL from the user’s position. A short server-side cache prevents repeated queries for the same coordinates.

When `GOOGLE_MAPS_API_KEY` is configured, Google Places supplies ratings, phone numbers, opening status, and the Directions API supplies driving ETA; otherwise AEGIS falls back to OpenStreetMap hospital data, where those fields may be unavailable. Missing fields are reported as unavailable rather than invented, emergency-department availability is never claimed, and AEGIS never fabricates an ETA. Route requests are delivered to the browser as a LiveKit data message and open Google Maps directions. The ordered list is retained for contextual requests such as “route me to the second hospital.”

## Security

No live credentials belong in this repository. The final submission should contain placeholders only. Rotate any credentials that were ever committed to a repository or shared archive.
