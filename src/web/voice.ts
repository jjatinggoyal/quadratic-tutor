import { blobToWavBase64 } from "./wav";

// Voice I/O. STT → (server) LLM → TTS; no realtime/live model APIs.
//   STT: the browser's Web Speech API when present (Chrome, Edge, Safari),
//        otherwise record → WAV → /api/stt (an audio-capable model on OpenRouter).
//   TTS: speechSynthesis. OpenRouter has no TTS models, and the spec cares
//        about the loop, not audio quality.

type RecognitionCtor = new () => SpeechRecognitionLike;
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const browserSttAvailable = () => recognitionCtor() !== null;
export const serverSttAvailable = () => typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

export interface ListenCallbacks {
  onInterim(text: string): void;
  /** Called once with the final transcript ("" if nothing was heard). */
  onFinal(text: string, source: "browser_stt" | "server_stt", sttMs: number): void;
  onError(message: string, recoverable: boolean): void;
  onTranscribing?(): void;
}

export interface Listener {
  stop(): void; // finish and submit what was heard
  abort(): void; // discard
}

// ---------------------------------------------------------------------------

export function listenWithBrowser(cb: ListenCallbacks): Listener {
  const Ctor = recognitionCtor()!;
  const rec = new Ctor();
  rec.lang = "en-IN";
  rec.interimResults = true;
  rec.continuous = false;
  let finalText = "";
  let aborted = false;
  let failed = false;

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    cb.onInterim((finalText + " " + interim).trim());
  };
  rec.onerror = (e) => {
    if (e.error === "aborted" || e.error === "no-speech") return;
    failed = true;
    const msg =
      e.error === "not-allowed" ? "Microphone permission was denied." : e.error === "network" ? "Browser speech recognition is unavailable." : `Speech recognition error: ${e.error}`;
    cb.onError(msg, e.error === "network" || e.error === "service-not-allowed");
  };
  rec.onend = () => {
    if (!aborted && !failed) cb.onFinal(finalText.trim(), "browser_stt", 0);
  };
  rec.start();
  return {
    stop: () => rec.stop(),
    abort: () => {
      aborted = true;
      rec.abort();
    },
  };
}

// ---------------------------------------------------------------------------
// Server STT with a tiny voice-activity detector: stop after ~1.2 s of silence
// once speech has started, or after 20 s.

export function listenWithServer(cb: ListenCallbacks, transcribe: (wav: string) => Promise<string>): Listener {
  let aborted = false;
  let stopFn: () => void = () => {};

  (async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      cb.onError("Microphone permission was denied.", false);
      return;
    }
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const started = performance.now();
    let heardSpeech = false;
    let lastLoud = performance.now();
    let raf = 0;

    const finish = () => {
      cancelAnimationFrame(raf);
      if (rec.state !== "inactive") rec.stop();
    };
    stopFn = finish;

    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      const rms = Math.sqrt(buf.reduce((a, v) => a + v * v, 0) / buf.length);
      const now = performance.now();
      if (rms > 0.02) {
        heardSpeech = true;
        lastLoud = now;
      }
      cb.onInterim(heardSpeech ? "…" : "");
      if ((heardSpeech && now - lastLoud > 1200) || now - started > 20000) return finish();
      raf = requestAnimationFrame(tick);
    };

    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      if (aborted) return;
      if (!heardSpeech) return cb.onFinal("", "server_stt", 0);
      cb.onTranscribing?.();
      const t0 = performance.now();
      try {
        const wav = await blobToWavBase64(new Blob(chunks, { type: rec.mimeType }));
        const text = await transcribe(wav);
        cb.onFinal(text, "server_stt", Math.round(performance.now() - t0));
      } catch {
        cb.onError("Couldn't transcribe that. Please try again or type your answer.", false);
      }
    };
    rec.start();
    raf = requestAnimationFrame(tick);
  })();

  return {
    stop: () => stopFn(),
    abort: () => {
      aborted = true;
      stopFn();
    },
  };
}

// ---------------------------------------------------------------------------

export class Speaker {
  private voice: SpeechSynthesisVoice | null = null;
  private token = 0;

  constructor() {
    const pick = () => {
      const voices = speechSynthesis.getVoices();
      this.voice =
        voices.find((v) => v.lang === "en-IN") ??
        voices.find((v) => v.lang.startsWith("en-GB")) ??
        voices.find((v) => v.lang.startsWith("en")) ??
        null;
    };
    if (typeof speechSynthesis !== "undefined") {
      pick();
      speechSynthesis.addEventListener?.("voiceschanged", pick);
    }
  }

  get available() {
    return typeof speechSynthesis !== "undefined";
  }

  /**
   * Speak sentence by sentence (Chrome cuts off long utterances). Resolves
   * when finished or cancelled; `onSentence` lets the UI follow along.
   */
  speak(text: string, onSentence?: (i: number) => void): Promise<void> {
    this.cancel();
    if (!this.available || !text) return Promise.resolve();
    const token = ++this.token;
    const sentences = text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
    return new Promise((resolve) => {
      const next = (i: number) => {
        if (token !== this.token || i >= sentences.length) return resolve();
        const u = new SpeechSynthesisUtterance(sentences[i]);
        if (this.voice) u.voice = this.voice;
        u.lang = this.voice?.lang ?? "en-IN";
        u.rate = 1.0;
        u.onstart = () => onSentence?.(i);
        u.onend = () => next(i + 1);
        u.onerror = () => next(i + 1);
        speechSynthesis.speak(u);
      };
      next(0);
    });
  }

  cancel() {
    this.token++;
    if (this.available) speechSynthesis.cancel();
  }
}
