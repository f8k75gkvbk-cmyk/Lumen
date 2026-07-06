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

// ---- Text to Speech (Bulbul v3) ----
// Returns a base64 WAV string. Sarvam TTS caps input at ~2500 chars.
export async function sarvamTTS(
  text: string,
  targetLanguageCode: string = "en-IN",
  speaker: string = "anushka"
): Promise<string> {
  const res = await fetch(`${SARVAM_BASE}/text-to-speech`, {
    method: "POST",
    headers: {
      "api-subscription-key": apiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: text.slice(0, 2400),
      target_language_code: targetLanguageCode,
      model: "bulbul:v3",
      speaker,
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

// ---- Chat Completion (sarvam-m) ----
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
      model: "sarvam-m",
      messages,
      temperature: 0.2, // low temp = stays grounded, less improvisation
      max_tokens: 800,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sarvam chat failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

// ---- The grounding prompt: the heart of the anti-hallucination guarantee ----
export function buildTutorSystemPrompt(
  transcript: string,
  language: "en" | "hi"
): string {
  const refusal =
    language === "hi"
      ? "यह वीडियो में शामिल नहीं है, इसलिए मैं इस प्रश्न में आपकी सहायता नहीं कर सकती।"
      : "This is not covered in the video, so I'm not able to help with this query.";

  const langLine =
    language === "hi"
      ? "Answer ONLY in Hindi."
      : "Answer ONLY in English.";

  return `You are a patient, encouraging tutor. A student has watched an educational video and will ask you questions about it. You are helping them understand THAT video's content — nothing else.

STRICT RULES — these override everything:
1. Your ONLY source of knowledge is the transcript below, delimited by <TRANSCRIPT> tags. Treat it as the complete universe of what you know.
2. If the answer to a question is not contained in or directly inferable from the transcript, you MUST reply with exactly this sentence and nothing else: "${refusal}"
3. Never use outside knowledge, general facts, or your own training data to answer — even if you are confident and even if the student insists. If it's not in the transcript, you don't know it.
4. Do not invent examples, numbers, names, or definitions that are not in the transcript.
5. When you DO answer, explain like a good tutor: clear, step by step, in simple language, and reference what the video said. You may rephrase and elaborate on the transcript's ideas to aid understanding, but never introduce new facts.
6. If a question is partially covered, answer the covered part and say the rest is not covered in the video.
7. ${langLine}
8. Keep answers concise and conversational — this may be read aloud by a voice bot.

<TRANSCRIPT>
${transcript}
</TRANSCRIPT>`;
}
