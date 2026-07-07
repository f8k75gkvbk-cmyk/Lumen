// Server-side only. Never import this into client components.
// The Sarvam API key lives in process.env and is never sent to the browser.

const SARVAM_BASE = "https://api.sarvam.ai";

function apiKey(): string {
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new Error("SARVAM_API_KEY is not set");
  return key;
}

// ---- Speech to Text (Saaras v3) ----
// Accepts a single audio chunk (<=30s for REST). Returns transcript text.
export async function sarvamSTT(
  audio: Blob,
  languageCode: string = "unknown"
): Promise<string> {
  const form = new FormData();
  form.append("file", audio, "audio.wav");
  form.append("model", "saaras:v3");
  form.append("language_code", languageCode);

  const res = await fetch(`${SARVAM_BASE}/speech-to-text`, {
    method: "POST",
    headers: { "api-subscription-key": apiKey() },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sarvam STT failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return (data.transcript ?? "").trim();
}

// ---- Make text sound natural when spoken ----
// TTS reads whatever it's given literally, so any stray tag, markdown, or
// bracketed label ("<TRANSCRIPT>", "**bold**", "1.") comes out robotic or the
// model literally says the word "transcript". Strip all of that BEFORE
// synthesis, and normalise punctuation so Bulbul has natural phrase breaks.
export function sanitizeForSpeech(text: string): string {
  return text
    // remove any XML-ish tags that may have leaked from the prompt
    .replace(/<\/?[^>]+>/g, " ")
    // strip markdown emphasis / headings / inline code / list bullets
    .replace(/[*_#`]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    // drop a literal label if it slipped in at the very start
    .replace(/^\s*(transcript|answer|response|tutor)\s*[:：]\s*/i, "")
    // turn line breaks into sentence pauses, collapse whitespace
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/\s{2,}/g, " ")
    .replace(/\.{2,}/g, ".")
    .trim();
}

// ---- Language-aware speaker selection ----
// Each of these is a valid bulbul:v3 female voice, hand-picked for a warm,
// teacherly tone. We pick per language because a speaker can sound more natural
// in the language its samples emphasise. Override by passing `speaker` directly.
// (Do NOT use v2-only names like "anushka"/"vidya" here — they 400 on v3.)
const SPEAKER_BY_LANG: Record<string, string> = {
  "hi-IN": "priya", // warm, natural Hindi delivery (verified bulbul:v3 voice)
  "en-IN": "ritu", // friendly, clear English-India delivery (verified v3 voice)
};

// Resolve the best default speaker for a target language, falling back to a
// safe, verified v3 voice if the language isn't in the map.
function defaultSpeakerFor(languageCode: string): string {
  return SPEAKER_BY_LANG[languageCode] ?? "ritu";
}

// ---- Text to Speech (Bulbul v3) ----
// Returns a base64 WAV string. Bulbul v3 accepts up to 2500 chars per request.
//
// Human-likeness levers (what actually makes it sound less robotic):
//  - speaker: a warm v3 female voice, chosen per language (see SPEAKER_BY_LANG).
//    (These are v3 speakers — do NOT use v2 names like "anushka"/"vidya" here;
//    they 400 on bulbul:v3.)
//  - temperature 0.6 (the model's natural default): counter-intuitively,
//    LOWERING temperature makes the voice flatter and more robotic. Keep it at
//    ~0.6 so prosody varies naturally. Do not drop it for "clarity".
//  - pace 0.95: a hair slower than default reads calm and clear, not rushed.
//  - enable_preprocessing: normalises numbers/dates/Hinglish so they're spoken
//    naturally instead of being spelled out awkwardly.
//  - NOTE: bulbul:v3 ignores `pitch` and `loudness` (those are v2-only), so we
//    don't send them.
//  - text is sanitised first so no tags/markdown are ever read aloud.
export async function sarvamTTS(
  text: string,
  targetLanguageCode: string = "en-IN",
  speaker?: string
): Promise<string> {
  const clean = sanitizeForSpeech(text).slice(0, 2500);
  const voice = speaker ?? defaultSpeakerFor(targetLanguageCode);

  const res = await fetch(`${SARVAM_BASE}/text-to-speech`, {
    method: "POST",
    headers: {
      "api-subscription-key": apiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: clean,
      target_language_code: targetLanguageCode,
      model: "bulbul:v3",
      speaker: voice,
      pace: 0.95,
      temperature: 0.6,
      speech_sample_rate: 24000,
      enable_preprocessing: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sarvam TTS failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  // Sarvam returns audios: [base64wav, ...]
  const audios: string[] = data.audios ?? [];
  return audios.join("");
}

// ---- Chat Completion (sarvam-30b) ----
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function sarvamChat(messages: ChatMessage[]): Promise<string> {
  const res = await fetch(`${SARVAM_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sarvam-30b",
      messages,
      // 0.4 gives the model room to genuinely rephrase and teach (vs. parroting
      // the source at 0.2) while staying grounded. Grounding is enforced by the
      // prompt, not by starving creativity.
      temperature: 0.4,
      top_p: 0.9,
      // Thinking mode is ON by default and, with a small budget, gets consumed
      // entirely by reasoning -> empty content. Disable it for direct replies.
      reasoning_effort: null,
      max_tokens: 800,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sarvam chat failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  // If content is empty but reasoning leaked, fall back to it, stripped of any
  // <think> wrappers.
  const raw = msg?.content || msg?.reasoning_content || "";
  return raw.replace(/<\/?think>/gi, "").trim();
}

// ---- The tutor prompt ----
// Design goals:
//  1. TEACH FIRST. The model's job is to explain and aid understanding, using
//     its OWN words — not to quote or read back the source material.
//  2. GROUNDED. It may only use facts found in the lesson; no outside
//     knowledge, and a clean refusal when a question is off-topic.
//  3. CLEAN SPEECH. Never mention "the transcript", never emit tags, headings,
//     bullets, or markdown — the answer may be read aloud verbatim.
//
// The lesson is delivered as a SEPARATE user message (see buildTutorMessages)
// rather than pasted into the system prompt inside <TRANSCRIPT> tags, which is
// what made the model say "<transcript>" out loud.
export function buildTutorSystemPrompt(language: "en" | "hi"): string {
  const refusal =
    language === "hi"
      ? "यह वीडियो में शामिल नहीं है, इसलिए मैं इसमें आपकी मदद नहीं कर सकती।"
      : "This is not covered in the video, so I'm not able to help with this query.";

  const langLine =
    language === "hi"
      ? "Always answer in natural, spoken Hindi."
      : "Always answer in natural, spoken English.";

  return `You are a warm, patient tutor helping a student understand an educational video they just watched. You will be given the full lesson content, then the student's questions.

HOW TO TEACH (your main job):
- Explain in your OWN words, the way a good teacher does — don't just repeat the lesson back. Rephrase, simplify, connect ideas, and give the intuition behind them.
- When useful, walk through it step by step, or offer a short analogy or example that clarifies a concept the lesson already introduced.
- Sound human and conversational. Open naturally (e.g. "Sure —", "Good question —") and keep it flowing, as if speaking to the student.
- Be concise: a few clear sentences. Your reply may be read aloud, so write the way people talk.

YOUR ONE HARD BOUNDARY (grounding):
- Everything you say must be based only on the lesson content you were given. You may explain, rephrase, infer, and illustrate what's there — but never introduce facts, names, numbers, or topics that aren't in it.
- If the student asks about something the lesson doesn't cover, don't guess and don't use outside knowledge. Reply with exactly: "${refusal}"
- If a question is partly covered, teach the part that is covered, then say the rest wasn't covered in the video.

NEVER DO THIS:
- Never mention "the transcript", "the lesson content", "the document", or that you were "given" any text. To the student, you simply know the video.
- Never output XML/HTML tags, markdown, headings, asterisks, or bullet-point lists. Speak in plain sentences only.

${langLine}`;
}

// Assemble the message list: system rules, then the lesson as context, then a
// short acknowledgement, then history + the new question. Keeping the lesson in
// a user/assistant framing (not tags) stops it leaking into spoken answers.
export function buildTutorMessages(
  transcript: string,
  language: "en" | "hi",
  history: ChatMessage[],
  question: string
): ChatMessage[] {
  const lessonIntro =
    language === "hi"
      ? "यह उस वीडियो की पूरी सामग्री है जिसे छात्र ने देखा है। केवल इसी के आधार पर पढ़ाएँ:"
      : "Here is the full content of the video the student watched. Teach only from this:";

  const ack =
    language === "hi"
      ? "समझ गई। मैंने वीडियो देख लिया है और छात्र के प्रश्नों के लिए तैयार हूँ।"
      : "Got it — I've understood the video and I'm ready for the student's questions.";

  return [
    { role: "system", content: buildTutorSystemPrompt(language) },
    { role: "user", content: `${lessonIntro}\n\n${transcript}` },
    { role: "assistant", content: ack },
    ...history.slice(-8),
    { role: "user", content: question },
  ];
}
