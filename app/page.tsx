"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fileToWavChunks,
  startVoiceSession,
  base64WavToUrl,
  type VoiceSession,
} from "@/lib/audio";

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
          Upload an educational video &mdash; or its transcript &mdash; and
          Lumen answers your questions by voice or chat, strictly from what the
          lesson teaches. Ask something it never covered, and it&rsquo;ll tell
          you so instead of making things up.
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
        <span>Answers are limited to the uploaded lesson&rsquo;s content.</span>
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

  const [source, setSource] = useState<"media" | "doc">("media");
  const [hot, setHot] = useState(false);
  const [fileName, setFileName] = useState("");
  const mediaRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);

  const handleMedia = useCallback(
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

  const handleDoc = useCallback(
    async (file: File) => {
      setError("");
      setTranscript("");
      setFileName(file.name);
      setIngesting(true);
      setProgress(0);
      setProgressLabel("Reading document…");
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/parse-transcript", {
          method: "POST",
          body: form,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Couldn't read that file");
        setTranscript(data.text);
        setProgress(100);
        setProgressLabel("Done");
      } catch (e: any) {
        setError(e.message);
      } finally {
        setIngesting(false);
      }
    },
    [setError, setIngesting, setProgress, setProgressLabel, setTranscript]
  );

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="num">01</span>
        <h3>Add the lesson</h3>
        <p>{source === "media" ? "MP4 · MOV · MP3 · WAV" : "TXT · MD · DOCX"}</p>
      </div>
      <div className="panel-body">
        <div className="tabs" role="tablist">
          <button
            className={source === "media" ? "on" : ""}
            onClick={() => setSource("media")}
          >
            <FilmIcon /> Video / audio
          </button>
          <button
            className={source === "doc" ? "on" : ""}
            onClick={() => setSource("doc")}
          >
            <DocIcon /> Transcript file
          </button>
        </div>

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
            if (f) (source === "media" ? handleMedia : handleDoc)(f);
          }}
        >
          {source === "media" ? (
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
          ) : (
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
              <path
                d="M14 3v5h5M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-5Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path
                d="M8 13h8M8 17h8"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          )}
          <b>
            {source === "media"
              ? "Drop your video or audio here"
              : "Drop your transcript file here"}
          </b>
          <small>
            {source === "media"
              ? "we\u2019ll pull out the audio and read it aloud"
              : "already have the text? skip transcription entirely"}
          </small>
          <div style={{ marginTop: 18 }}>
            <button
              className="btn"
              disabled={ingesting}
              onClick={() =>
                (source === "media" ? mediaRef : docRef).current?.click()
              }
            >
              {ingesting ? "Working…" : "Choose file"}
            </button>
          </div>
          <input
            ref={mediaRef}
            type="file"
            accept="video/*,audio/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleMedia(f);
            }}
          />
          <input
            ref={docRef}
            type="file"
            accept=".txt,.md,.text,.docx"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleDoc(f);
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

        {transcript ? (
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
        ) : (
          !ingesting && (
            <div className="hint-box">
              <span>How grounding works</span>
              Whatever you add here becomes the tutor&rsquo;s entire world. It
              won&rsquo;t pull in outside facts &mdash; if the answer isn&rsquo;t
              in this text, it says so.
            </div>
          )
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
        <p>{ready ? "Ready" : "Waiting for a lesson"}</p>
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
              <b>Add a lesson first.</b>
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
              ? "नमस्ते! मैंने पाठ पढ़ लिया है। इसके बारे में कुछ भी पूछें।"
              : "Hi! I've studied the lesson. Ask me anything it covered."}
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

/* ---- Voice (seamless, always-listening conversation) ---- */
type VoiceState = "off" | "listening" | "thinking" | "speaking";

function VoiceMode({ lang, transcript }: { lang: Lang; transcript: string }) {
  const [state, setState] = useState<VoiceState>("off");
  const [heard, setHeard] = useState("");
  const [answer, setAnswer] = useState("");
  const [litCount, setLitCount] = useState(0);
  const [refusal, setRefusal] = useState(false);
  const [error, setError] = useState("");
  const [level, setLevel] = useState(0);

  const sessionRef = useRef<VoiceSession | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const historyRef = useRef<Msg[]>([]);
  const busyRef = useRef(false);
  const stateRef = useRef<VoiceState>("off");
  const langRef = useRef(lang);
  langRef.current = lang;

  const setSt = (s: VoiceState) => {
    stateRef.current = s;
    setState(s);
  };

  useEffect(() => {
    return () => endSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startSession() {
    setError("");
    setHeard("");
    setAnswer("");
    setLitCount(0);
    try {
      const session = await startVoiceSession({
        onLevel: (l) => setLevel(l),
        onSpeechStart: () => {
          if (stateRef.current === "speaking" && audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
            setSt("listening");
          }
        },
        onUtterance: (wav) => handleUtterance(wav),
      });
      sessionRef.current = session;
      setSt("listening");
    } catch (e: any) {
      setError(
        e.message ||
          "I couldn't reach your microphone. Check the browser permission."
      );
      setSt("off");
    }
  }

  function endSession() {
    sessionRef.current?.stop();
    sessionRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    busyRef.current = false;
    setSt("off");
    setLevel(0);
  }

  async function handleUtterance(wav: Blob) {
    if (busyRef.current) return;
    busyRef.current = true;
    sessionRef.current?.suspend();
    setSt("thinking");
    setAnswer("");
    setLitCount(0);
    setRefusal(false);

    try {
      const l = langRef.current;
      const sttForm = new FormData();
      sttForm.append("audio", wav, "q.wav");
      sttForm.append("language", l === "hi" ? "hi-IN" : "en-IN");
      const sttRes = await fetch("/api/stt", { method: "POST", body: sttForm });
      const sttData = await sttRes.json();
      if (!sttRes.ok) throw new Error(sttData.error || "Couldn't hear that");
      const question = (sttData.text || "").trim();
      if (!question) {
        resumeListening();
        return;
      }
      setHeard(question);

      const chatRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          question,
          language: l,
          history: historyRef.current.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });
      const chatData = await chatRes.json();
      if (!chatRes.ok) throw new Error(chatData.error || "Tutor error");
      const reply = chatData.answer as string;
      historyRef.current = [
        ...historyRef.current,
        { role: "user" as const, content: question },
        { role: "assistant" as const, content: reply },
      ].slice(-8);
      setAnswer(reply);
      setRefusal(isRefusal(reply));

      const ttsRes = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: reply, language: l }),
      });
      const ttsData = await ttsRes.json();
      if (!ttsRes.ok) throw new Error(ttsData.error || "Voice error");

      await speak(ttsData.audio, reply);
      resumeListening();
    } catch (e: any) {
      setError(e.message);
      resumeListening();
    }
  }

  function resumeListening() {
    busyRef.current = false;
    if (sessionRef.current) {
      sessionRef.current.resume();
      setSt("listening");
    } else {
      setSt("off");
    }
  }

  function speak(audioBase64: string, text: string): Promise<void> {
    return new Promise((resolve) => {
      const url = base64WavToUrl(audioBase64);
      const audio = new Audio(url);
      audioRef.current = audio;
      setSt("speaking");
      const totalWords = text.split(/\s+/).length;

      const begin = (durSec: number) => {
        const perWord = (durSec * 1000) / totalWords;
        let i = 0;
        const timer = setInterval(() => {
          i++;
          setLitCount(i);
          if (i >= totalWords) clearInterval(timer);
        }, perWord);
        audio.onended = () => {
          clearInterval(timer);
          setLitCount(totalWords);
          URL.revokeObjectURL(url);
          resolve();
        };
      };

      audio.onloadedmetadata = () => {
        const dur = isFinite(audio.duration) ? audio.duration : totalWords / 2.6;
        begin(dur);
      };
      audio.play().catch(() => {
        setLitCount(totalWords);
        resolve();
      });
    });
  }

  const words = answer ? answer.split(/\s+/) : [];
  const statusLabel =
    state === "listening"
      ? lang === "hi"
        ? "सुन रहा हूँ… बस बोलें"
        : "Listening… just speak"
      : state === "thinking"
      ? lang === "hi"
        ? "सोच रहा हूँ…"
        : "Thinking…"
      : state === "speaking"
      ? lang === "hi"
        ? "बोल रहा हूँ"
        : "Speaking"
      : lang === "hi"
      ? "बातचीत शुरू करें"
      : "Start the conversation";

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
        <div
          className="core"
          style={
            state === "listening"
              ? { transform: `scale(${1 + level * 0.14})` }
              : undefined
          }
        >
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
            {state === "off"
              ? lang === "hi"
                ? "नीचे बटन दबाएँ, फिर सामान्य रूप से बात करें।"
                : "Tap start, then talk naturally — no need to hold anything."
              : lang === "hi"
              ? "वीडियो के बारे में कुछ पूछें।"
              : "Ask anything about the lesson."}
          </span>
        )}
      </div>

      {error && <div className="err">{error}</div>}

      {state === "off" ? (
        <button className="mic-btn" onClick={startSession}>
          <MicIcon /> {lang === "hi" ? "बातचीत शुरू करें" : "Start conversation"}
        </button>
      ) : (
        <button className="mic-btn rec" onClick={endSession}>
          <StopIcon /> {lang === "hi" ? "समाप्त करें" : "End conversation"}
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
function FilmIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="4"
        width="18"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
function DocIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M14 3v5h5M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
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
