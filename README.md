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

## Deploy to Vercel + kushg.online

1. **Push to GitHub** (see the git commands at the end).
2. Go to [vercel.com/new](https://vercel.com/new) → **Import** your repo.
3. Framework preset auto-detects **Next.js**. Leave build settings default.
4. Under **Environment Variables**, add:
   - `SARVAM_API_KEY` = your key
5. Click **Deploy**.
6. After the first deploy: **Project → Settings → Domains → Add** `www.kushg.online`.
   Vercel shows a CNAME (usually `cname.vercel-dns.com`). Add that CNAME record
   at your domain registrar for the `www` host. Add `kushg.online` too and set
   the redirect to `www` (or vice-versa).
7. DNS propagates in a few minutes; Vercel issues the SSL cert automatically.

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
