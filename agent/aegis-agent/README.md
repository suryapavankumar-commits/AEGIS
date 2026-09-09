# AEGIS LiveKit Agent

The AEGIS realtime voice agent for the Rime Hackathon Challenge.

## Voice stack

- LiveKit Agents Node.js 1.6.3
- Rime TTS plugin 1.6.3
- Rime Coda / Celeste / English
- Rime WebSocket streaming
- AssemblyAI Universal-3-5-Pro STT via LiveKit Inference
- Gemma 4 31B LLM via LiveKit Inference
- LiveKit adaptive interruption handling + preemptive generation
- ai-coustics QUAIL noise enhancement
- Nearby hospital search with rating/review/distance-aware recommendation
- Google Maps directions routing with contextual hospital selection

## Run

```bash
pnpm install
copy .env.example .env.local
# fill LIVEKIT_*, RIME_API_KEY, and optionally GOOGLE_MAPS_API_KEY
pnpm run preflight
pnpm run dev
```

## Tests

```bash
pnpm run test:unit
```

The original LiveKit evaluation suite remains available as `pnpm run test:agent`; it requires the model services configured for that evaluation.

## Rime evidence

See `RIME_EVIDENCE.md` for the hard voice problem, acceptance test, exact shipped configuration, limitations, and measurement procedure. Hospital routing evidence and the recommendation safety wording are documented there as well.
