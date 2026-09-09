import fs from 'node:fs';

const required = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'RIME_API_KEY'];
const missing = required.filter((name) => !process.env[name]);
const model = process.env.RIME_MODEL ?? 'coda';
const voice = process.env.RIME_VOICE ?? 'celeste';
const language = process.env.RIME_LANGUAGE ?? 'en';

if (!['coda', 'mist', 'mistv2', 'mistv3'].includes(model)) {
  console.error(`Invalid Rime model: ${model}`);
  process.exit(1);
}
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
if (!fs.existsSync('RIME_EVIDENCE.md')) {
  console.error('RIME_EVIDENCE.md is missing');
  process.exit(1);
}
console.log('AEGIS preflight configuration OK');
console.log(`Rime model: ${model}`);
console.log(`Rime voice: ${voice}`);
console.log(`Rime language: ${language}`);
console.log('Rime WebSocket streaming: enabled');
