/* azure-tts.test.js: plain node, `node tests/azure-tts.test.js`. */
const assert = require('assert');
const { azureVoiceName, azureSpeak, ssml } = require('../netlify/functions/_azure-tts.js');
(async () => {
  assert.strictEqual(azureVoiceName('azure:en-US-ChristopherMultilingualNeural'), 'en-US-ChristopherMultilingualNeural');
  assert.strictEqual(azureVoiceName('azure:en-US-Olivia:MAI-Voice-2-Flash'), 'en-US-Olivia:MAI-Voice-2-Flash');
  assert.strictEqual(azureVoiceName('4NZxG3SNE9sA1UE6KTRy'), null);          // an ElevenLabs id is not an Azure voice
  assert.strictEqual(azureVoiceName('azure:../../x'), null);
  assert.strictEqual(azureVoiceName('azure:'), null);
  const s = ssml('Tom & "Jerry" <hi> it\'s fine', 'en-US-ChristopherMultilingualNeural');
  assert(s.includes("xml:lang='en-US'") && s.includes("name='en-US-ChristopherMultilingualNeural'"));
  assert(s.includes('Tom &amp; &quot;Jerry&quot; &lt;hi&gt; it&apos;s fine') && !s.includes('<hi>'));   // nothing in the text can break out of the SSML
  assert.strictEqual(azureVoiceName('azure:en-US-AvaMultilingualNeural@en-GB'), 'en-US-AvaMultilingualNeural@en-GB');   // language tag kept
  assert.strictEqual(azureVoiceName('azure:en-US-AvaMultilingualNeural@x'), null);
  const g = ssml('Hello', 'en-US-AvaMultilingualNeural@en-GB');
  assert(g.includes("xml:lang='en-GB'") && g.includes("name='en-US-AvaMultilingualNeural'") && !g.includes('@'));
  assert.strictEqual(azureVoiceName('azure:en-GB-Ada:DragonHDLatestNeural'), 'en-GB-Ada:DragonHDLatestNeural');   // an HD voice name has a colon
  assert.strictEqual(azureVoiceName('azure:en-GB-Ada:'), null);
  assert.strictEqual(azureVoiceName('azure:en-GB-Ada:x:y'), null);
  let seen;
  const fetchFn = async (url, o) => { seen = { url, o }; return { ok: true, arrayBuffer: async () => Buffer.from('mp3bytes') }; };
  const buf = await azureSpeak('Hello there.', 'en-US-ChristopherMultilingualNeural', { fetchFn, env: { AZURE_SPEECH_KEY: 'test-key', AZURE_SPEECH_REGION: 'eastus' } });
  assert.strictEqual(buf.toString(), 'mp3bytes');
  assert.strictEqual(seen.url, 'https://eastus.tts.speech.microsoft.com/cognitiveservices/v1');
  assert.strictEqual(seen.o.headers['Ocp-Apim-Subscription-Key'], 'test-key');
  assert.strictEqual(seen.o.headers['X-Microsoft-OutputFormat'], 'audio-24khz-48kbitrate-mono-mp3');
  assert(/application\/ssml\+xml/.test(seen.o.headers['Content-Type']));
  await assert.rejects(azureSpeak('x', 'en-US-ChristopherMultilingualNeural', { fetchFn, env: {} }), /no_azure_key/);                       // no key: throws, so gc-voice falls back
  await assert.rejects(azureSpeak('x', 'en-US-ChristopherMultilingualNeural', { fetchFn, env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'evil.com/x' } }), /bad_azure_region/);
  await assert.rejects(azureSpeak('x', 'en-US-ChristopherMultilingualNeural', { fetchFn: async () => ({ ok: false, status: 401 }), env: { AZURE_SPEECH_KEY: 'k' } }), /azure_401/);
  console.log('ALL OK');
})().catch((e) => { console.error(e); process.exit(1); });
