/* _azure-tts: speak text with an Azure neural voice, 2026-10-16, Dr. O ("make this Astrad's American voice", en-US-ChristopherMultilingualNeural).

   A voice id of the form  azure:en-US-ChristopherMultilingualNeural  means "use Azure with this voice name". gc-voice.js calls azureSpeak() for those, and for any
   other id it goes to ElevenLabs as before.

   THE KEY IS NEVER IN THIS FILE OR THE REPOSITORY. It comes from the campus environment: AZURE_SPEECH_KEY, and AZURE_SPEECH_REGION (eastus if it is not set).
   If the key is not set, or Azure says no, azureSpeak() throws and gc-voice.js falls back to the ElevenLabs voice that was used before, so nobody goes silent.

   Not tried against the real Azure service from here; the request shape follows Azure's published text to speech REST call. */
const NAME_RE = /^azure:([A-Za-z]{2}-[A-Za-z]{2}-[A-Za-z0-9]{3,60})$/;

function azureVoiceName(voiceId) {
  const m = NAME_RE.exec(String(voiceId || ''));
  return m ? m[1] : null;
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function ssml(text, voiceName) {
  const lang = voiceName.split('-').slice(0, 2).join('-');
  return `<speak version='1.0' xml:lang='${lang}'><voice name='${voiceName}'>${escapeXml(text)}</voice></speak>`;
}

/* Returns a Buffer of mp3 audio. fetchFn and env are passed in so it can be tested without the network. */
async function azureSpeak(text, voiceName, { fetchFn = fetch, env = process.env } = {}) {
  const key = String(env.AZURE_SPEECH_KEY || '').trim();
  const region = String(env.AZURE_SPEECH_REGION || 'eastus').trim();
  if (!key) throw new Error('no_azure_key');
  if (!/^[a-z0-9-]{3,30}$/.test(region)) throw new Error('bad_azure_region');
  const r = await fetchFn(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'etl-gc-voice',
    },
    body: ssml(text, voiceName),
  });
  if (!r.ok) throw new Error('azure_' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

module.exports = { azureVoiceName, azureSpeak, ssml, escapeXml };
