"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fileToWavChunks, recordMicToWav, base64WavToUrl } from "@/lib/audio";

type Lang = "en" | "hi";
type Msg = { role: "user" | "assistant"; content: string; refusal?: boolean };

const REFUSAL_EN = "This is not covered in the video";
const REFUSAL_HI = "यह वीडियो में शामिल नहीं है";

function isRefusal(text: string) {
  return text.startsWith(REFUSAL_EN) || text.startsWith(REFUSAL_HI);
}

export default function Home() {
  const [lang, setLang] = useState<Lang>("en");
  const [transcript, setTranscript] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [error, setError] = useState("");

  const ready = transcript.trim().length > 0 && !ingesting;

  return (
    <div className="wrap">
      <header className="masthead">
        <div className="brand">
          <div className="mark">L</div>
          <div>
            <h1>Lumen</h1>
            <span>The tutor that only knows your video</span>
          </div>
        </div>
        <div className="lang-toggle" role="tablist" aria-label="Language">
          <button
            className={lang === "en" ? "on" : ""}
            onClick={() => setLang("en")}
          >
            English
          </button>
          <button
            className={lang === "hi" ? "on" : ""}
            onClick={() => setLang("hi")}
          >
            हिंदी
          </button>
        </div>
      </header>

      <section className="hero">
        <span className="eyebrow">Grounded voice tutoring</span>
        <h2>
          Turn any lesson video into a <em>tutor you can talk to.</em>
        </h2>
        <p>
          Upload an educational video. Lumen transcribes it, then answers your
          questions by voice or chat — strictly from what the video teaches. Ask
          something it never covered, and it&rsquo;ll tell you so instead of
          making things up.
        </p>
      </section>

      <div className="grid">
        <UploadPanel
          lang={lang}
          ingesting={ingesting}
          setIngesting={setIngesting}
          progress={progress}
          setProgress={setProgress}
          progressLabel={progressLabel}
          setProgressLabel={setProgressLabel}
          transcript={transcript}
          setTranscript={setTranscript}
          error={error}
          setError={setError}
        />
        <TutorPanel lang={lang} transcript={transcript} ready={ready} />
      </div>

      <footer className="footer">
        <span>
          Built for{" "}
          <a href="https://www.kushg.online" target="_blank" rel="noreferrer">
            kushg.online
          </a>{" "}
          · Speech, language &amp; voice by Sarvam AI
        </span>
        <span>Answers are limited to the uploaded video&rsquo;s content.</span>
      </footer>
    </div>
  );
}

/* ============ UPLOAD PANEL ============ */
function UploadPanel(props: any) {
  const {
    lang,
    ingesting,
    setIngesting,
    progress,
    setProgress,
    progressLabel,
    setProgressLabel,
    transcript,
    setTranscript,
    error,
    setError,
  } = props;

  const [hot, setHot] = useState(false);
  const [fileName, setFileName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError("");
      setTranscript("");
      setFileName(file.name);
      setIngesting(true);
      setProgress(0);
      setProgressLabel("Extracting audio…");

      try {
        const chunks = await fileToWavChunks(file);
        const parts: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
          setProgressLabel(`Transcribing segment ${i + 1} of ${chunks.length}`);
          const form = new FormData();
          form.append("chunk", chunks[i], `chunk-${i}.wav`);
          form.append("language", lang === "hi" ? "hi-IN" : "en-IN");
          const res = await fetch("/api/transcribe", {
            method: "POST",
            body: form,
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Transcription failed");
          if (data.text) parts.push(data.text);
          setProgress(Math.round(((i + 1) / chunks.length) * 100));
          setTranscript(parts.join(" "));
        }
        setProgressLabel("Done");
      } catch (e: any) {
        setError(
          e.message ||
            "Couldn't process that file. Try a shorter clip or a different format."
        );
      } finally {
        setIngesting(false);
      }
    },
    [lang, setError, setIngesting, setProgress, setProgressLabel, setTranscript]
  );

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="num">01</span>
        <h3>Upload the lesson</h3>
        <p>MP4 · MOV · MP3 · WAV</p>
      </div>
      <div className="panel-body">
        <div
          className={`drop ${hot ? "hot" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setHot(true);
          }}
          onDragLeave={() => setHot(false)}
          onDrop={(e) => {
            e.preventDefault();
            setHot(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
        >
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 15V3m0 0L8 7m4-4 4 4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M20 17v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <b>Drop your video or audio here</b>
          <small>or pick a file — we&rsquo;ll pull out the audio and read it</small>
          <div style={{ marginTop: 18 }}>
            <button
              className="btn"
              disabled={ingesting}
              onClick={() => inputRef.current?.click()}
            >
              {ingesting ? "Working…" : "Choose file"}
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="video/*,audio/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </div>

        {ingesting && (
          <div className="progress">
            <div className="bar">
              <i style={{ width: `${progress}%` }} />
            </div>
            <div className="label">
              <span>{progressLabel}</span>
              <span>{progress}%</span>
            </div>
          </div>
        )}

        {error && <div className="err">{error}</div>}

        {transcript && (
          <div className="transcript-box">
            {!ingesting && (
              <span className="done-tag">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path
                    d="m5 13 4 4L19 7"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Transcript ready · {fileName}
              </span>
            )}
            {transcript}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============ TUTOR PANEL (chat + voice) ============ */
function TutorPanel({
  lang,
  transcript,
  ready,
}: {
  lang: Lang;
  transcript: string;
  ready: boolean;
}) {
  const [mode, setMode] = useState<"chat" | "voice">("chat");

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="num">02</span>
        <h3>Ask your tutor</h3>
        <p>{ready ? "Ready" : "Waiting for a video"}</p>
      </div>
      <div className="panel-body">
        <div className="tabs" role="tablist">
          <button
            className={mode === "chat" ? "on" : ""}
            onClick={() => setMode("chat")}
          >
            <ChatIcon /> Chat
          </button>
          <button
            className={mode === "voice" ? "on" : ""}
            onClick={() => setMode("voice")}
          >
            <MicIcon /> Voice
          </button>
        </div>

        {!ready ? (
          <div className="locked">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
              <rect
                x="4"
                y="10"
                width="16"
                height="11"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path
                d="M8 10V7a4 4 0 0 1 8 0v3"
                stroke="currentColor"
                strokeWidth="1.8"
              />
            </svg>
            <p>
              <b>Upload a video first.</b>
              <br />
              Your tutor unlocks the moment the transcript is ready.
            </p>
          </div>
        ) : mode === "chat" ? (
          <ChatMode lang={lang} transcript={transcript} />
        ) : (
          <VoiceMode lang={lang} transcript={transcript} />
        )}
      </div>
    </div>
  );
}

/* ---- Chat ---- */
function ChatMode({ lang, transcript }: { lang: Lang; transcript: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo(0, threadRef.current.scrollHeight);
  }, [msgs, busy]);

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    setError("");
    const next = [...msgs, { role: "user" as const, content: q }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          question: q,
          language: lang,
          history: msgs.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      setMsgs([
        ...next,
        {
          role: "assistant",
          content: data.answer,
          refusal: isRefusal(data.answer),
        },
      ]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="thread" ref={threadRef}>
        {msgs.length === 0 && (
          <div className="bubble bot">
            <div className="who">Tutor</div>
            {lang === "hi"
              ? "नमस्ते! मैंने वीडियो देख लिया है। इसके बारे में कुछ भी पूछें।"
              : "Hi! I've studied the video. Ask me anything about what it covered."}
          </div>
        )}
        {msgs.map((m, i) => (
          <div
            key={i}
            className={`bubble ${m.role === "user" ? "me" : "bot"} ${
              m.refusal ? "refusal" : ""
            }`}
          >
            {m.role === "assistant" && <div className="who">Tutor</div>}
            {m.content}
          </div>
        ))}
        {busy && (
          <div className="typing">
            <i />
            <i />
            <i />
          </div>
        )}
      </div>
      {error && <div className="err">{error}</div>}
      <div className="composer">
        <input
          value={input}
          placeholder={
            lang === "hi" ? "अपना प्रश्न लिखें…" : "Type your question…"
          }
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask(input)}
          disabled={busy}
        />
        <button
          className="send"
          onClick={() => ask(input)}
          disabled={busy || !input.trim()}
          aria-label="Send"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </>
  );
}

/* ---- Voice ---- */
function VoiceMode({ lang, transcript }: { lang: Lang; transcript: string }) {
  const [state, setState] = useState<
    "idle" | "listening" | "thinking" | "speaking"
  >("idle");
  const [heard, setHeard] = useState("");
  const [answer, setAnswer] = useState("");
  const [litCount, setLitCount] = useState(0);
  const [refusal, setRefusal] = useState(false);
  const [error, setError] = useState("");
  const stopRef = useRef({ stopped: false });
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const words = answer ? answer.split(/\s+/) : [];

  async function startListening() {
    setError("");
    setAnswer("");
    setHeard("");
    setLitCount(0);
    setRefusal(false);
    stopRef.current = { stopped: false };
    setState("listening");
    try {
      const wav = await recordMicToWav(stopRef.current);
      setState("thinking");

      // 1) STT
      const sttForm = new FormData();
      sttForm.append("audio", wav, "q.wav");
      sttForm.append("language", lang === "hi" ? "hi-IN" : "en-IN");
      const sttRes = await fetch("/api/stt", { method: "POST", body: sttForm });
      const sttData = await sttRes.json();
      if (!sttRes.ok) throw new Error(sttData.error || "Couldn't hear that");
      const question = (sttData.text || "").trim();
      setHeard(question);
      if (!question) {
        setState("idle");
        setError(
          lang === "hi"
            ? "मुझे कुछ सुनाई नहीं दिया। फिर से कोशिश करें।"
            : "I didn't catch that. Try again."
        );
        return;
      }

      // 2) LLM (grounded)
      const chatRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, question, language: lang }),
      });
      const chatData = await chatRes.json();
      if (!chatRes.ok) throw new Error(chatData.error || "Tutor error");
      const reply = chatData.answer as string;
      setAnswer(reply);
      setRefusal(isRefusal(reply));

      // 3) TTS
      const ttsRes = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: reply, language: lang }),
      });
      const ttsData = await ttsRes.json();
      if (!ttsRes.ok) throw new Error(ttsData.error || "Voice error");

      // 4) Speak + karaoke captions
      const url = base64WavToUrl(ttsData.audio);
      const audio = new Audio(url);
      audioRef.current = audio;
      setState("speaking");

      const totalWords = reply.split(/\s+/).length;
      audio.onloadedmetadata = () => {
        const dur = isFinite(audio.duration) ? audio.duration : totalWords / 2.6;
        const perWord = (dur * 1000) / totalWords;
        let i = 0;
        const timer = setInterval(() => {
          i++;
          setLitCount(i);
          if (i >= totalWords) clearInterval(timer);
        }, perWord);
        audio.onended = () => {
          clearInterval(timer);
          setLitCount(totalWords);
          setState("idle");
          URL.revokeObjectURL(url);
        };
      };
      audio.play().catch(() => {
        // Autoplay blocked — reveal all words at once.
        setLitCount(totalWords);
        setState("idle");
      });
    } catch (e: any) {
      setError(e.message);
      setState("idle");
    }
  }

  function stopSpeaking() {
    stopRef.current.stopped = true;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setState("idle");
  }

  const statusLabel =
    state === "listening"
      ? lang === "hi"
        ? "सुन रहा हूँ…"
        : "Listening…"
      : state === "thinking"
      ? lang === "hi"
        ? "सोच रहा हूँ…"
        : "Thinking…"
      : state === "speaking"
      ? lang === "hi"
        ? "बोल रहा हूँ"
        : "Speaking"
      : lang === "hi"
      ? "पूछने के लिए तैयार"
      : "Ready when you are";

  return (
    <div className="voice">
      <div
        className={`orb ${
          state === "speaking"
            ? "speaking"
            : state === "listening"
            ? "listening"
            : ""
        }`}
      >
        <span className="ring r1" />
        <span className="ring r2" />
        <span className="ring r3" />
        <div className="core">
          {state === "listening" ? (
            <MicIcon big />
          ) : (
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 3v18M8 7v10M16 7v10M4 10v4M20 10v4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          )}
        </div>
      </div>

      <div className="voice-status">{statusLabel}</div>

      <div className={`captions ${refusal ? "refusal" : ""}`}>
        {answer ? (
          words.map((w, i) => (
            <span key={i} className={`word ${i < litCount ? "lit" : ""}`}>
              {w}{" "}
            </span>
          ))
        ) : heard ? (
          <span className="heard">“{heard}”</span>
        ) : (
          <span className="heard">
            {lang === "hi"
              ? "माइक दबाएँ और वीडियो के बारे में पूछें।"
              : "Tap the mic and ask about the video."}
          </span>
        )}
      </div>

      {error && <div className="err">{error}</div>}

      {state === "listening" ? (
        <button className="mic-btn rec" onClick={() => (stopRef.current.stopped = true)}>
          <StopIcon /> {lang === "hi" ? "पूछ लिया" : "Done asking"}
        </button>
      ) : state === "speaking" ? (
        <button className="mic-btn" onClick={stopSpeaking}>
          <StopIcon /> {lang === "hi" ? "रोकें" : "Stop"}
        </button>
      ) : (
        <button
          className="mic-btn"
          onClick={startListening}
          disabled={state === "thinking"}
        >
          <MicIcon /> {lang === "hi" ? "बोलकर पूछें" : "Hold to ask"}
        </button>
      )}
    </div>
  );
}

/* ---- icons ---- */
function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-6.5A8 8 0 1 1 21 12Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function MicIcon({ big }: { big?: boolean }) {
  const s = big ? 40 : 16;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <rect
        x="9"
        y="3"
        width="6"
        height="11"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M6 11a6 6 0 0 0 12 0M12 17v4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
function StopIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
