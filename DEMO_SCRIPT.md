# AEGIS — 4–5 Minute Demo Script

## 0:00–0:30 — Problem

Show the AEGIS landing screen.

Say:
> “During an emergency, people may be stressed, moving, or unable to type. AEGIS makes the interaction voice-native and keeps the latest emergency details consistent.”

Point to the visible **PRIMARY TTS · RIME CODA** indicator.

## 0:30–1:45 — Normal flow

Start the voice session.

Say:
> “There is a fire in the engineering building. Two people are trapped.”

Let AEGIS create the incident and respond.

Then say:
> “Correction: there are three people trapped.”

Explain that the current incident is updated rather than duplicated.

## 1:45–3:15 — Hard voice problem: interruption and recovery

Say:
> “There is a fire near the main gate. Please verify the situation.”

If AEGIS starts a verification task, interrupt while it is speaking or waiting:

> “Stop. The location is actually the north gate, and nobody is trapped.”

The important observable behavior is:

- queued Rime audio stops promptly;
- the new speech is accepted while the previous operation is active;
- the verification task is cancellable;
- stale verification output is not treated as the latest truth;
- the next spoken response reflects the corrected north-gate location and zero trapped people.

## 3:15–4:00 — Evidence

Show `RIME_EVIDENCE.md` and `evidence/RUN_RESULTS.md`.

Show the actual measured values from the run. Do not invent values.

Say:
> “The claim we tested is interruption and recovery. We measured the user-visible path, including first audible response and interruption-to-audio-stop time.”

## 4:00–4:45 — Rime role and architecture

Show the architecture:

Browser → LiveKit → AEGIS → AssemblyAI + Gemma → Rime Coda → LiveKit audio → Browser.

Say:
> “Rime is not a welcome message or optional playback. It is the primary spoken output for every AEGIS response. We use Rime Coda with the Celeste voice over WebSocket streaming.”

## 4:45–5:00 — Close

Say:
> “AEGIS is focused on one hard voice problem: keeping an emergency conversation correct when the user interrupts and changes the situation in real time.”


## Hospital assistance demo

After establishing the emergency location, say:

> “Find nearby hospitals.”

AEGIS should return the number of hospitals and summarize the available rating, review volume, and distance information. It should describe the top option as a recommendation based on those signals, not as the medically best hospital.

Then say:

> “Route me to the second hospital.”

The browser should open Google Maps directions for the second hospital in the current ordered result list.
