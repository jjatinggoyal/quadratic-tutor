import { blobToWavBase64 } from "./wav";

// Voice I/O. STT → (server) LLM → TTS; no realtime/live model APIs.
//   STT: the browser's Web Speech API when present (Chrome, Edge, Safari),
//        otherwise record → WAV → /api/stt (Groq Whisper, LLM fallback).
//   TTS: speechSynthesis. OpenRouter has no TTS models, and the spec cares
//        about the loop, not audio quality.
//
// VoiceLoop owns the speaker and the current listener. Every speak/listen is
// tied to a token; interrupting (barge-in, typing, a new turn) invalidates it,
// so a cancelled utterance or an aborted listener can never act afterwards
// (e.g. open the mic or submit a turn).

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

export type SttMode = "browser" | "server";

export interface ListenCallbacks {
  onInterim(text: string): void;
  /** Called once with the final transcript ("" if nothing was heard). */
  onFinal(text: string, source: "browser_stt" | "server_stt", sttMs: number): void;
  onError(message: string, recoverable: boolean): void;
  onTranscribing?(): void;
}

interface Listener {
  stop(): void; // finish and submit what was heard
  abort(): void; // discard; no callbacks fire afterwards
}

// ---------------------------------------------------------------------------

function listenWithBrowser(cb: ListenCallbacks): Listener {
  const rec = new (recognitionCtor()!)();
  rec.lang = "en-IN";
  rec.interimResults = true;
  rec.continuous = false;
  let finalText = "";
  let done = false; // aborted or failed: stay silent from now on

  rec.onresult = (e) => {
    if (done) return;
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    cb.onInterim(`${finalText} ${interim}`.trim());
  };
  rec.onerror = (e) => {
    if (done || e.error === "aborted" || e.error === "no-speech") return;
    done = true;
    const msg =
      e.error === "not-allowed" ? "Microphone permission was denied." : e.error === "network" ? "Browser speech recognition is unavailable." : `Speech recognition error: ${e.error}`;
    cb.onError(msg, e.error === "network" || e.error === "service-not-allowed");
  };
  rec.onend = () => {
    if (!done) {
      done = true;
      cb.onFinal(finalText.trim(), "browser_stt", 0);
    }
  };
  rec.start();
  return {
    stop: () => rec.stop(),
    abort: () => {
      done = true;
      rec.abort();
    },
  };
}

// Server STT with a tiny voice-activity detector: stop after ~1.2 s of silence
// once speech has started. A timer (not requestAnimationFrame, which pauses in
// background tabs) enforces the 20 s cap.
const SILENCE_MS = 1200;
const MAX_RECORDING_MS = 20_000;

function listenWithServer(cb: ListenCallbacks, transcribe: (wav: string) => Promise<string>): Listener {
  let aborted = false;
  let finish: () => void = () => {};

  void (async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      if (!aborted) cb.onError("Microphone permission was denied.", false);
      return;
    }
    // Aborted while the permission prompt was open: release the mic immediately.
    if (aborted) return stream.getTracks().forEach((t) => t.stop());

    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let heardSpeech = false;
    let lastLoud = performance.now();

    const vad = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      const rms = Math.sqrt(buf.reduce((a, v) => a + v * v, 0) / buf.length);
      if (rms > 0.02) {
        heardSpeech = true;
        lastLoud = performance.now();
      }
      if (!aborted) cb.onInterim(heardSpeech ? "…" : "");
      if (heardSpeech && performance.now() - lastLoud > SILENCE_MS) finish();
    }, 50);
    const cap = setTimeout(() => finish(), MAX_RECORDING_MS);
    finish = () => {
      clearInterval(vad);
      clearTimeout(cap);
      if (rec.state !== "inactive") rec.stop();
    };

    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      if (aborted) return;
      if (!heardSpeech) return cb.onFinal("", "server_stt", 0);
      cb.onTranscribing?.();
      const t0 = performance.now();
      try {
        const text = await transcribe(await blobToWavBase64(new Blob(chunks, { type: rec.mimeType })));
        if (!aborted) cb.onFinal(text, "server_stt", Math.round(performance.now() - t0));
      } catch {
        if (!aborted) cb.onError("Couldn't transcribe that. Please try again or type your answer.", false);
      }
    };
    rec.start();
  })();

  return {
    stop: () => finish(),
    abort: () => {
      aborted = true;
      finish();
    },
  };
}

// ---------------------------------------------------------------------------

class Speaker {
  private voice: SpeechSynthesisVoice | null = null;
  private token = 0;

  constructor() {
    if (!this.available) return;
    const pick = () => {
      const voices = speechSynthesis.getVoices();
      this.voice =
        voices.find((v) => v.lang === "en-IN") ?? voices.find((v) => v.lang.startsWith("en-GB")) ?? voices.find((v) => v.lang.startsWith("en")) ?? null;
    };
    pick();
    speechSynthesis.addEventListener?.("voiceschanged", pick);
  }

  get available() {
    return typeof speechSynthesis !== "undefined";
  }

  /**
   * Speak sentence by sentence (Chrome cuts off long utterances). Resolves true
   * when it finished, false if it was cancelled: cancel() makes Chrome fire
   * onend/onerror, so "the promise resolved" alone does not mean "she finished".
   */
  speak(text: string, rate = 1): Promise<boolean> {
    this.cancel();
    if (!this.available || !text) return Promise.resolve(true);
    const token = ++this.token;
    const sentences = text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
    return new Promise((resolve) => {
      const next = (i: number) => {
        if (token !== this.token) return resolve(false);
        if (i >= sentences.length) return resolve(true);
        const u = new SpeechSynthesisUtterance(sentences[i]);
        if (this.voice) u.voice = this.voice;
        u.lang = this.voice?.lang ?? "en-IN";
        u.rate = rate;
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

/** The voice loop's single owner of the speaker and the current listener. */
export class VoiceLoop {
  private speaker = new Speaker();
  private listener: Listener | null = null;
  private listenToken = 0;

  get canSpeak() {
    return this.speaker.available;
  }

  /** Resolves "done" if Tara finished speaking, "interrupted" if anything cut her off. */
  async speak(text: string, rate = 1): Promise<"done" | "interrupted"> {
    this.stopListening();
    return (await this.speaker.speak(text, rate)) ? "done" : "interrupted";
  }

  /** Start listening; cancels speech (barge-in) and any previous listener, whose callbacks are then ignored. */
  listen(mode: SttMode, cb: ListenCallbacks, transcribe: (wav: string) => Promise<string>) {
    this.speaker.cancel();
    this.stopListening();
    const token = ++this.listenToken;
    const live =
      <A extends unknown[]>(fn: ((...args: A) => void) | undefined) =>
      (...args: A) => {
        if (token !== this.listenToken) return;
        fn?.(...args);
      };
    const settle =
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        if (token !== this.listenToken) return;
        this.listener = null;
        fn(...args);
      };
    const guarded: ListenCallbacks = { onInterim: live(cb.onInterim), onTranscribing: live(cb.onTranscribing), onFinal: settle(cb.onFinal), onError: settle(cb.onError) };
    this.listener = mode === "browser" ? listenWithBrowser(guarded) : listenWithServer(guarded, transcribe);
  }

  /** Finish listening and submit what was heard. */
  finishListening() {
    this.listener?.stop();
  }

  /** Discard: abort the listener; none of its callbacks fire afterwards. */
  stopListening() {
    this.listenToken++;
    this.listener?.abort();
    this.listener = null;
  }

  /** Stop everything: speech and listening. */
  interrupt() {
    this.speaker.cancel();
    this.stopListening();
  }
}
