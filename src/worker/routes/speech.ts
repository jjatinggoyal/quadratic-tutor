import { z } from "zod";
import { transport, type Env } from "../env";
import { HttpError, json, readBody } from "../http";
import { transcribe } from "../stt";

const MAX_AUDIO_BYTES = 2_000_000; // ~60 s of 16 kHz mono WAV
const Body = z.object({ audio: z.string().min(1).regex(/^[A-Za-z0-9+/]+=*$/, "audio must be base64") });

export async function speechToText(req: Request, env: Env): Promise<Response> {
  const { audio } = await readBody(req, Body);
  if (audio.length * 0.75 > MAX_AUDIO_BYTES) throw new HttpError(413, "audio too long");
  const out = await transcribe(env.GROQ_API_KEY ?? null, transport(env), [env.MODEL_STT, env.MODEL_STT_FALLBACK], audio);
  console.log(JSON.stringify({ event: "stt", ok: out.text !== null, ms: out.ms, via: out.via, attempts: out.attempts }));
  if (out.text === null) throw new HttpError(503, "transcription unavailable; please type your answer");
  return json({ text: out.text, ms: out.ms });
}
