import { ServerOptions, cli, defineAgent, inference, voice } from '@livekit/agents';
import { audioEnhancement } from '@livekit/plugins-ai-coustics';
import * as rime from '@livekit/agents-plugin-rime';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { RoomEvent } from '@livekit/rtc-node';
import type { AegisSessionState } from './agent.ts';
import { createAgent } from './agent.ts';

// Load environment variables from a local file.
// Make sure to set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET
// when running locally or self-hosting your agent server.
dotenv.config({ path: '.env.local' });

export default defineAgent({
  entry: async (ctx) => {
    const sessionState: AegisSessionState = {
      currentLocation: null,
      hospitals: [],
      publishClientEvent: async (payload) => {
        await ctx.room.localParticipant?.publishData(
          new TextEncoder().encode(JSON.stringify(payload)),
          { reliable: true, topic: 'aegis.navigation' },
        );
      },
    };

    // Receive browser-provided GPS location without changing the existing voice pipeline.
    ctx.room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
      if (topic !== 'aegis.location') return;
      try {
        const message = JSON.parse(new TextDecoder().decode(payload)) as {
          type?: string;
          latitude?: number;
          longitude?: number;
          label?: string;
          accuracy?: number;
          timestamp?: number;
        };
        if (
          message.type === 'location' &&
          typeof message.latitude === 'number' &&
          typeof message.longitude === 'number'
        ) {
          sessionState.currentLocation = {
            latitude: message.latitude,
            longitude: message.longitude,
            ...(message.label !== undefined ? { label: message.label } : {}),
            ...(message.accuracy !== undefined ? { accuracy: message.accuracy } : {}),
            ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}),
          };
          console.log('[AEGIS] Browser GPS acquired:', {
            latitude: sessionState.currentLocation.latitude,
            longitude: sessionState.currentLocation.longitude,
          });
        }
      } catch (error) {
        console.warn('Ignoring malformed AEGIS location data:', error);
      }
    });

    // AEGIS voice pipeline: AssemblyAI STT + Gemma reasoning + Rime Coda TTS + LiveKit transport
    const session = new voice.AgentSession({
      // Speech-to-text (STT) is your agent's ears, turning the user's speech into text that the LLM can understand
      // See all available models at https://docs.livekit.io/agents/models/stt/
      stt: new inference.STT({
        model: 'assemblyai/universal-3-5-pro',
        language: 'en',
      }),

      // Rime is the primary spoken output. The official Rime plugin uses
      // WebSocket streaming so speech can begin quickly and can be interrupted.
      tts: new rime.TTS({
        modelId: process.env.RIME_MODEL ?? 'coda',
        speaker: process.env.RIME_VOICE ?? 'celeste',
        ...(process.env.RIME_API_KEY !== undefined
          ? { apiKey: process.env.RIME_API_KEY }
          : {}),
        baseURL: process.env.RIME_BASE_URL ?? 'wss://users-ws.rime.ai',
        useWebsocket: true,
        segment: 'bySentence',
        speedAlpha: Number(process.env.RIME_SPEED_ALPHA ?? '0.95'),
      }),

      turnHandling: {
        // Turn detection determines when the user is speaking and when the agent should respond.
        // The LiveKit audio turn detector is a multimodal model that encodes the user's audio
        // directly to predict end of turn. It's built into the SDK (no extra plugin) and
        // AgentSession supplies the required VAD automatically.
        // See more at https://docs.livekit.io/agents/logic/turns/turn-detector/
        turnDetection: new inference.TurnDetector(),
        // Adaptive interruptions use the turn detector to tell a real interruption from a
        // backchannel like "mhm" or "right", so the agent keeps talking through the latter.
        interruption: { mode: 'adaptive' },
        // Allow the LLM to generate a response while waiting for the end of turn
        preemptiveGeneration: { enabled: true },
      },

      // Keep Rime delivery concise and voice-native. Do not emit provider-specific
      // provider-specific markup because Rime is the judged primary TTS provider.
      expressive: false,
    });

    // Start the session, which initializes the voice pipeline and warms up the models
    await session.start({
      agent: createAgent(sessionState),
      room: ctx.room,
      inputOptions: {
        // ai-coustics QUAIL audio enhancement for noise cancellation
        // Works for both WebRTC and telephony (SIP) participants
        noiseCancellation: audioEnhancement({ model: 'quailVfS' }),
      },
    });

    // // Add a virtual avatar to the session, if desired
    // // For other providers, see https://docs.livekit.io/agents/models/avatar/
    // const avatar = new anam.AvatarSession({
    //   personaConfig: {
    //     name: '...',
    //     avatarId: '...', // See https://docs.livekit.io/agents/models/avatar/plugins/anam
    //   },
    // });
    // // Start the avatar and wait for it to join
    // await avatar.start(session, ctx.room);

    // Join the room and connect to the user
    await ctx.connect();

    // Greet the user on joining
    session.generateReply({
      instructions: 'Greet the user in a helpful and friendly manner.',
    });
  },
});

// Run the agent server
cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: 'my-agent',
    permissions: {
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
      canUpdateMetadata: true,
      canPublishSources: [],
      hidden: false,
    },
  }),
);
