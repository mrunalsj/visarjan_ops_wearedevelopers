// Sarvam AI voice: speech-to-text (Saaras v4, translate mode → English) and text-to-speech (Bulbul v4 Flash).
// Calls spend the account's credits, so every request passes a daily budget. Audio and transcripts are never logged or stored.
const API = 'https://api.sarvam.ai';
export const VOICE_LANGUAGES = ['en-IN', 'hi-IN', 'mr-IN', 'kn-IN'];
const usage = { day: '', count: 0 };

const settings = (env = process.env) => ({
  enabled: env.SARVAM_ENABLED === 'true' && Boolean(env.SARVAM_API_KEY?.trim()),
  key: env.SARVAM_API_KEY?.trim(),
  speaker: env.SARVAM_SPEAKER?.trim() || 'simran_en_customer',
  dailyLimit: Math.max(1, Number.parseInt(env.SARVAM_DAILY_CALL_LIMIT || '150', 10) || 150)
});

export function sarvamStatus(env = process.env) {
  const s = settings(env), day = new Date().toISOString().slice(0, 10);
  return { enabled: s.enabled, dailyLimit: s.dailyLimit, usedToday: usage.day === day ? usage.count : 0 };
}

const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });

function spend(s) {
  const day = new Date().toISOString().slice(0, 10);
  if (usage.day !== day) { usage.day = day; usage.count = 0; }
  if (usage.count >= s.dailyLimit) throw fail(429, 'Voice assistance has reached today’s limit. Please search by typing.');
  usage.count++;
}

async function call(path, init) {
  let response;
  try { response = await fetch(API + path, { ...init, signal: AbortSignal.timeout(20_000) }); }
  catch { throw fail(502, 'Could not reach the voice service. Please search by typing.'); }
  if (response.status === 402) throw fail(503, 'Voice assistance is unavailable right now (service credits exhausted).');
  if (response.status === 429) throw fail(429, 'The voice service is busy. Try again in a minute.');
  if (!response.ok) throw fail(502, 'The voice service could not process that. Please try again or type your search.');
  return response.json();
}

// Returns the English translation of what was said, plus the detected spoken language.
export async function transcribe(audio, mimeType, keyterms = [], env = process.env) {
  const s = settings(env);
  if (!s.enabled) throw fail(503, 'Voice assistance is not configured.');
  spend(s);
  const extension = /ogg/.test(mimeType) ? 'ogg' : /mp4|m4a|aac/.test(mimeType) ? 'm4a' : /wav/.test(mimeType) ? 'wav' : 'webm';
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mimeType }), `speech.${extension}`);
  form.append('model', 'saaras:v4');
  form.append('mode', 'translate');
  const terms = keyterms.filter(t => t && t.length <= 64).slice(0, 50);
  if (terms.length) form.append('keyterms', JSON.stringify(terms));
  const result = await call('/speech-to-text', { method: 'POST', headers: { 'api-subscription-key': s.key }, body: form });
  const language = VOICE_LANGUAGES.includes(result.language_code) ? result.language_code : 'en-IN';
  return { transcript: String(result.transcript || '').slice(0, 500), language };
}

export async function speak(text, languageCode, env = process.env) {
  const s = settings(env);
  if (!s.enabled) throw fail(503, 'Voice assistance is not configured.');
  if (!VOICE_LANGUAGES.includes(languageCode)) throw fail(400, 'Unsupported language.');
  spend(s);
  const result = await call('/text-to-speech', {
    method: 'POST',
    headers: { 'api-subscription-key': s.key, 'content-type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 600), language_code: languageCode, model: 'bulbul:v4-flash', speaker: s.speaker, output_audio_codec: 'mp3', speech_sample_rate: 24000 })
  });
  if (typeof result.audios?.[0] !== 'string') throw fail(502, 'The voice service returned no audio.');
  return { audio: result.audios[0], mimeType: 'audio/mpeg' };
}

// Spoken summaries are built from our own site data with fixed templates, never free text from the visitor.
// Hindi, Marathi and Kannada phrasing needs native-speaker review.
const PHRASES = {
  'en-IN': { intro: 'Nearest immersion sites:', none: 'I could not find a matching immersion site. Please try another area.', m: 'metres', km: 'kilometres', noStatus: 'no recent status', status: { Open: 'open', Busy: 'busy', 'Near capacity': 'nearly full', Closed: 'closed' }, wait: n => `about ${n} minutes wait`, join: '. ' },
  'hi-IN': { intro: 'सबसे नज़दीकी विसर्जन स्थल:', none: 'कोई मिलता-जुलता विसर्जन स्थल नहीं मिला। कृपया कोई दूसरा इलाका बताइए।', m: 'मीटर', km: 'किलोमीटर', noStatus: 'हाल की स्थिति उपलब्ध नहीं', status: { Open: 'खुला है', Busy: 'भीड़ है', 'Near capacity': 'लगभग भरा है', Closed: 'बंद है' }, wait: n => `लगभग ${n} मिनट इंतज़ार`, join: '। ' },
  'mr-IN': { intro: 'सर्वात जवळची विसर्जन स्थळे:', none: 'जुळणारे विसर्जन स्थळ सापडले नाही. कृपया दुसरा भाग सांगा.', m: 'मीटर', km: 'किलोमीटर', noStatus: 'अलीकडील स्थिती उपलब्ध नाही', status: { Open: 'सुरू आहे', Busy: 'गर्दी आहे', 'Near capacity': 'जवळजवळ भरले आहे', Closed: 'बंद आहे' }, wait: n => `सुमारे ${n} मिनिटे थांबावे लागेल`, join: '. ' },
  'kn-IN': { intro: 'ಹತ್ತಿರದ ವಿಸರ್ಜನೆ ಸ್ಥಳಗಳು:', none: 'ಹೊಂದುವ ವಿಸರ್ಜನೆ ಸ್ಥಳ ಸಿಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಬೇರೆ ಪ್ರದೇಶ ಹೇಳಿ.', m: 'ಮೀಟರ್', km: 'ಕಿಲೋಮೀಟರ್', noStatus: 'ಇತ್ತೀಚಿನ ಸ್ಥಿತಿ ಲಭ್ಯವಿಲ್ಲ', status: { Open: 'ತೆರೆದಿದೆ', Busy: 'ಜನದಟ್ಟಣೆ ಇದೆ', 'Near capacity': 'ಬಹುತೇಕ ಭರ್ತಿಯಾಗಿದೆ', Closed: 'ಮುಚ್ಚಲಾಗಿದೆ' }, wait: n => `ಸುಮಾರು ${n} ನಿಮಿಷ ಕಾಯಬೇಕು`, join: '. ' }
};

export function summarise(items, languageCode) {
  const p = PHRASES[languageCode] || PHRASES['en-IN'];
  if (!items.length) return p.none;
  const parts = items.map(({ site, meters, statusInfo }) => {
    const distance = meters == null ? '' : meters < 1000 ? `, ${Math.round(meters / 50) * 50 || 50} ${p.m}` : `, ${(meters / 1000).toFixed(1)} ${p.km}`;
    const fresh = statusInfo && ['live', 'delayed'].includes(statusInfo.freshness) && statusInfo.status;
    const minutes = fresh && statusInfo.wait ? Number.parseInt(String(statusInfo.wait).replace(/\D+/g, ''), 10) : NaN;
    const status = fresh ? `, ${p.status[statusInfo.status] || statusInfo.status}${Number.isFinite(minutes) ? `, ${p.wait(minutes)}` : ''}` : `, ${p.noStatus}`;
    return `${site.name}${distance}${status}`;
  });
  return `${p.intro} ${parts.join(p.join)}`;
}
