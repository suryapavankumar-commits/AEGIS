# AEGIS Web Client

Next.js browser client for the AEGIS realtime voice demo.
## Demo

🎥 **Demo Video:** https://youtu.be/Hc021J6WqBg

## Setup

```bash
npm install
```

Create `.env.local` with:

```text
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
```

Run:

```bash
npm run dev
```

Open `http://localhost:3000`.

The browser obtains a short-lived LiveKit participant token from `/api/token`, joins a unique room, enables the microphone, and renders the agent's LiveKit audio track. The UI visibly identifies **Rime Coda** as the primary TTS provider.
