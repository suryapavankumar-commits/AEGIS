# AEGIS Voice Test Results

These results document the shipped AEGIS voice configuration used for the demo.

| Test | Run | First audio | Interrupt → audio stop | Correction → next audio | Stale result spoken? |
|---|---:|---|---|---|---|
| Normal | 1 | Observed | N/A | Observed | No |
| Stress | 1 | Observed | Observed | Observed | No |

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
- Normal emergency interaction: **PASS**
- Interruption/correction stress case: **PASS**
- Incident state updated to the corrected information: **PASS**
- Obsolete/stale result spoken after correction: **No**

## Observations

The demonstrated hard voice problem is interruption and recovery during an emergency conversation.

During the stress case, the user interrupts AEGIS while it is responding and provides corrected incident information. AEGIS stops the obsolete response, updates the incident state, and continues using the corrected information.

Latency values were not instrumented in this run and are therefore not claimed as precise measurements.

## Limitations

- The demo recording is 5:23 long and therefore exceeds the stated 4–5 minute target.
- Latency measurements were not instrumented.
- Incident state is in-memory.
- Browser WebRTC/LiveKit is the demonstrated transport; telephony is not claimed.