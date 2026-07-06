import { NextRequest, NextResponse } from "next/server";
import { sarvamTTS } from "@/lib/sarvam";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { text, language } = await req.json();
    if (!text) {
      return NextResponse.json({ error: "No text provided." }, { status: 400 });
    }
    const targetLang = language === "hi" ? "hi-IN" : "en-IN";
    const audioBase64 = await sarvamTTS(text, targetLang);
    return NextResponse.json({ audio: audioBase64 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "TTS failed." },
      { status: 500 }
    );
  }
}
