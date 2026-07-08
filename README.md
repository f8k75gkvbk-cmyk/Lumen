# Lumen — the tutor that only knows your video

Upload an educational video. Lumen transcribes it with Sarvam STT, then answers
questions by **chat or voice** — strictly from what the video teaches. Ask about
anything the video didn't cover and it replies: *"This is not covered in the
video, so I'm not able to help with this query."*

Built with Next.js 14 (App Router), deployed on Vercel, powered end-to-end by
Sarvam AI (Saaras v3 STT · sarvam-m LLM · Bulbul v3 TTS).

## How it works

```
                         ┌─────────────────────────────────────┐
 Upload video/audio ───► │ Browser extracts audio → 16kHz WAV   │
                         │ → slices into ≤25s chunks            │
                         └──────────────┬──────────────────────┘
                                        │  (one chunk at a time)
                              /api/transcribe ──► Sarvam STT (Saaras v3)
                                        │
                                        ▼
                              Full transcript held in the page
                                        │
              ┌─────────────────────────┴─────────────────────────┐
        CHAT  │                                              VOICE │
   /api/chat  │                                    mic → /api/stt  │
   (sarvam-m, │                                    → /api/chat     │
   transcript │                                    → /api/tts      │
   grounded)  │                                    (karaoke words) │
              └───────────────────────────────────────────────────┘
```

**Anti-hallucination** is enforced in `lib/sarvam.ts → buildTutorSystemPrompt`:
the full transcript is the model's *entire* knowledge universe, temperature is
pinned low, and the model is instructed to return the exact refusal sentence
when a question falls outside the transcript.

**n8n** (`n8n/ingestion-workflow.json`) handles server-side batch ingestion if
you'd rather transcribe uploads on a backend than in the browser — the live
chat/voice loop stays direct-to-Sarvam for low latency (the hybrid you chose).

## Local development

```bash
npm install
cp .env.example .env.local     # add your SARVAM_API_KEY
npm run dev                    # http://localhost:3000
```

## Deploy to Vercel

1. **Push to GitHub** (see the git commands at the end).
2. Go to [vercel.com/new](https://vercel.com/new) → **Import** your repo.
3. Framework preset auto-detects **Next.js**. Leave build settings default.
4. Under **Environment Variables**, add:
   - `SARVAM_API_KEY` = your key
5. Click **Deploy**.

## Importing the n8n workflow

In your n8n instance: **Workflows → Import from File** →
`n8n/ingestion-workflow.json`. Set a `SARVAM_API_KEY` environment variable in
n8n, activate the workflow, and POST `{ "audio_url": "...", "language_code":
"en-IN" }` to the webhook. It returns `{ video_id, transcript, status }`.

## Notes & limits

- Sarvam STT REST caps at 30s per request — hence client-side chunking at 25s.
- Sarvam TTS caps at ~2500 chars per request; long answers are trimmed. For very
  long answers, split into sentences and call TTS per sentence.
- Voice input records up to 20s per question (adjustable in `lib/audio.ts`).
- Browser mic + autoplay require HTTPS — works on Vercel, and on `localhost`.

## What changed in v2

- **Model fix:** `sarvam-m` is deprecated → now uses `sarvam-30b` with thinking
  mode disabled (`reasoning_effort: null`) so replies aren't swallowed by
  reasoning tokens.
- **Transcript upload:** besides video/audio, you can now drop a `.txt`, `.md`,
  or `.docx` transcript and skip transcription entirely (`/api/parse-transcript`).
- **Seamless voice:** press *Start conversation* once, then just talk. Browser
  voice-activity detection auto-detects when you finish a sentence, processes it,
  the tutor replies, and the mic re-opens automatically. Supports barge-in
  (start talking to interrupt the tutor).
- **Better voice:** `bulbul:v3` with a valid v3 speaker (`priya`), 24kHz, and
  preprocessing on for clean numbers/Hinglish. (The old `anushka` default was a
  v2-only speaker and would fail on v3.)
- **UI:** upload and tutor panels are now equal height.
- **Sarvam MCP:** see `SARVAM_MCP.md` for the developer-time MCP setup.

## Redeploy

Vercel auto-deploys on push to the default branch. After this push, confirm your
`SARVAM_API_KEY` env var is set in Vercel → Settings → Environment Variables, and
the new deploy will pick up all changes. 
