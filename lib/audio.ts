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
// energy. When the user finishes an utterance (a real pause after speaking),
// it fires onUtterance(wav). Call stop() to release the mic entirely.
//
// Tuning goals (so it never cuts the user off mid-question):
//  - A generous silence window (default 1500ms) so natural thinking pauses
//    inside a sentence don't end the turn.
//  - A "hangover": several consecutive silent frames are required before we
//    decide speech ended, so one quiet frame between words never counts.
//  - A minimum utterance floor so brief lip-smacks/coughs are ignored.
//  - Pre-roll: we keep a little audio from just BEFORE speech was detected, so
//    the first word isn't clipped.
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
  // Longer default silence so the bot waits for the user to actually finish.
  const silenceMs = opts.silenceMs ?? 1500;
  const minSpeechMs = opts.minSpeechMs ?? 400;
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

  const frameMs = (2048 / targetRate) * 1000; // ~128ms per frame

  let suspended = false;
  let speaking = false;
  let speechStartedAt = 0;
  let lastVoiceAt = 0;
  let silentRun = 0; // consecutive silent frames (the "hangover" counter)
  let buffer: Float32Array[] = [];
  let preRoll: Float32Array[] = []; // audio just before speech starts

  // How many consecutive silent frames must pass before we end the turn.
  const silentFramesNeeded = Math.max(3, Math.round(silenceMs / frameMs));
  // Keep ~300ms of pre-roll so the first syllable isn't clipped.
  const preRollFrames = Math.max(2, Math.round(300 / frameMs));

  // Adaptive noise floor so it works in quiet and noisy rooms alike.
  let noiseFloor = 0.008;

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

    // Track ambient noise only while NOT speaking, and only on genuinely quiet
    // frames, so a loud talker doesn't drag the floor up.
    if (!speaking && rms < noiseFloor * 3) {
      noiseFloor = noiseFloor * 0.97 + rms * 0.03;
    }

    // Two thresholds (hysteresis): a higher bar to START speech, a lower bar to
    // KEEP it going. This stops quiet syllables mid-word from being read as
    // silence, which was the main cause of early cut-offs.
    const startThreshold = Math.max(0.02, noiseFloor * 3.0);
    const keepThreshold = Math.max(0.012, noiseFloor * 1.8);
    const now = performance.now();

    if (!speaking) {
      // Maintain a rolling pre-roll of recent quiet audio.
      preRoll.push(new Float32Array(input));
      if (preRoll.length > preRollFrames) preRoll.shift();

      if (rms > startThreshold) {
        speaking = true;
        speechStartedAt = now;
        lastVoiceAt = now;
        silentRun = 0;
        buffer = preRoll.slice(); // include the pre-roll so word 1 is intact
        preRoll = [];
        opts.onSpeechStart?.();
      }
    } else {
      // We're inside an utterance — always capture audio.
      buffer.push(new Float32Array(input));

      if (rms > keepThreshold) {
        // Still talking.
        lastVoiceAt = now;
        silentRun = 0;
      } else {
        // A quiet frame. Only end the turn after enough of them in a row AND
        // enough wall-clock silence has passed.
        silentRun++;
        const longEnough = now - lastVoiceAt >= silenceMs;
        if (silentRun >= silentFramesNeeded && longEnough) {
          speaking = false;
          silentRun = 0;
          const duration = lastVoiceAt - speechStartedAt;
          if (duration >= minSpeechMs) {
            const merged = mergeChunks(buffer);
            opts.onUtterance(encodeWav(merged, targetRate));
          }
          buffer = [];
        }
      }
    }
  };

  const reset = () => {
    speaking = false;
    silentRun = 0;
    buffer = [];
    preRoll = [];
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
      reset();
    },
    resume: () => {
      reset();
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
