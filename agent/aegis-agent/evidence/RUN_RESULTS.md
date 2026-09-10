# AEGIS Voice Test Results

These results document the shipped AEGIS voice configuration used for the demo.

| Test | Run | First audio (ms) | Interrupt → audio stop (ms) | Correction → next audio (ms) | Stale result spoken? |
|---|---:|---:|---:|---:|---|
| Normal | 1 | Not instrumented | N/A | N/A | No |
| Stress | 1 | Not instrumented | Not instrumented | Not instrumented | No |

## Environment

- Rime model: `coda`
- Rime voice: `celeste`
- Language: `en`
- Rime WebSocket streaming: enabled
- LiveKit transport: WebRTC
- STT: AssemblyAI Universal-3-5-Pro
- LLM: `google/gemma-4-31b-it`

## Verification

- Rime preflight: **PASS**
- TypeScript typecheck: **PASS**
- Unit tests: **21/21 PASS**
- Demo includes the normal emergency interaction.
- Demo includes an interruption/correction stress case.
- During the stress case, the user changes the incident information while AEGIS is responding.
- The final spoken response reflects the updated information.
- No stale result was observed being spoken as the current incident state.

## Observations

The demonstrated hard voice problem is interruption and recovery during an emergency conversation.

The system accepts a user interruption while the agent is responding, updates the incident state, and continues with the corrected information.

Latency values above are not claimed as precise measurements from the recording. Exact timing should be measured separately if required.

## Limitations

- The demo recording is 5:23 long and therefore exceeds the stated 4–5 minute demo target.
- Measurements from the recording are observational rather than instrumented latency measurements.
- Incident state is in-memory.
- Browser WebRTC/LiveKit is the demonstrated transport; telephony is not claimed.