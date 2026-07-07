// Client-side audio helpers. Runs in the browser only.

// Decode any video/audio file into raw PCM, resample to 16kHz mono,
// then slice into WAV chunks of <= chunkSeconds each.
export async function fileToWavChunks(
  file: File,
  chunkSeconds = 25
): Promise<Blob[]> {
  const arrayBuffer = await file.arrayBuffer();
  const AudioCtx =
    window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioCtx();
  const decoded = await ctx.decodeAudioData(arrayBuffer);

  const targetRate = 16000;
  const offline = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * targetRate),
    targetRate
  );
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();

  const samples = rendered.getChannelData(0);
  const samplesPerChunk = targetRate * chunkSeconds;
  const chunks: Blob[] = [];

  for (let start = 0; start < samples.length; start += samplesPerChunk) {
    const slice = samples.subarray(
      start,
      Math.min(start + samplesPerChunk, samples.length)
    );
    chunks.push(encodeWav(slice, targetRate));
  }
  ctx.close();
  return chunks;
}

// Record a short mic clip and return it as a 16kHz mono WAV blob.
export async function recordMicToWav(
  stopSignal: { stopped: boolean },
  maxSeconds = 20
): Promise<Blob> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const AudioCtx =
    window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate: 16000 });
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const collected: Float32Array[] = [];

  source.connect(processor);
  processor.connect(ctx.destination);

  const start = Date.now();
  await new Promise<void>((resolve) => {
    processor.onaudioprocess = (e) => {
      collected.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      if (
        stopSignal.stopped ||
        (Date.now() - start) / 1000 >= maxSeconds
      ) {
        processor.disconnect();
        source.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        ctx.close();
        resolve();
      }
    };
  });

  const total = collected.reduce((n, a) => n + a.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const a of collected) {
    merged.set(a, offset);
    offset += a.length;
  }
  return encodeWav(merged, 16000);
}

// ---- Continuous conversation engine (voice-activity detection) ----
// Opens the mic once and keeps it open. Detects speech vs silence by RMS
// energy. When the user finishes an utterance (a pause after speaking), it
// fires onUtterance(wav). Call stop() to release the mic entirely.
//
// This is what makes the voice bot feel live: the user speaks whenever they
// want, and each finished phrase is captured automatically — no press-and-hold.
export interface VoiceSession {
  stop: () => void;
  suspend: () => void; // pause capture (e.g. while the bot is speaking)
  resume: () => void;
}

export async function startVoiceSession(opts: {
  onUtterance: (wav: Blob) => void;
  onSpeechStart?: () => void;
  onLevel?: (level: number) => void; // 0..1, for live mic meter
  silenceMs?: number; // pause length that ends an utterance
  minSpeechMs?: number; // ignore blips shorter than this
}): Promise<VoiceSession> {
  const silenceMs = opts.silenceMs ?? 800;
  const minSpeechMs = opts.minSpeechMs ?? 350;
  const targetRate = 16000;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const AudioCtx =
    window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate: targetRate });
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(2048, 1, 1);

  let suspended = false;
  let speaking = false;
  let speechStartedAt = 0;
  let lastVoiceAt = 0;
  let buffer: Float32Array[] = [];

  // Adaptive noise floor so it works in quiet and noisy rooms alike.
  let noiseFloor = 0.01;

  source.connect(processor);
  processor.connect(ctx.destination);

  processor.onaudioprocess = (e) => {
    if (suspended) return;
    const input = e.inputBuffer.getChannelData(0);

    // RMS energy of this frame.
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    opts.onLevel?.(Math.min(1, rms * 8));

    // Slowly track the ambient noise floor when not speaking.
    if (!speaking) noiseFloor = noiseFloor * 0.95 + rms * 0.05;
    const threshold = Math.max(0.015, noiseFloor * 2.2);
    const now = performance.now();

    if (rms > threshold) {
      if (!speaking) {
        speaking = true;
        speechStartedAt = now;
        buffer = [];
        opts.onSpeechStart?.();
      }
      lastVoiceAt = now;
      buffer.push(new Float32Array(input));
    } else if (speaking) {
      // Still within an utterance — keep a little trailing audio.
      buffer.push(new Float32Array(input));
      if (now - lastVoiceAt > silenceMs) {
        // Utterance ended.
        speaking = false;
        const duration = lastVoiceAt - speechStartedAt;
        if (duration >= minSpeechMs) {
          const merged = mergeChunks(buffer);
          opts.onUtterance(encodeWav(merged, targetRate));
        }
        buffer = [];
      }
    }
  };

  return {
    stop: () => {
      suspended = true;
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
    },
    suspend: () => {
      suspended = true;
      speaking = false;
      buffer = [];
    },
    resume: () => {
      suspended = false;
    },
  };
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, a) => n + a.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const a of chunks) {
    merged.set(a, offset);
    offset += a.length;
  }
  return merged;
}

// Encode Float32 PCM into a 16-bit WAV blob.
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++)
      view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view], { type: "audio/wav" });
}

// Convert a base64 WAV string (from TTS) into a playable object URL.
export function base64WavToUrl(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}
