import { NextRequest, NextResponse } from "next/server";
import { sarvamSTT } from "@/lib/sarvam";

export const runtime = "nodejs";
export const maxDuration = 60;

// Transcribes a single short mic recording (the student's spoken question).
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const audio = form.get("audio") as Blob | null;
    const language = (form.get("language") as string) || "unknown";
    if (!audio) {
      return NextResponse.json({ error: "No audio provided." }, { status: 400 });
    }
    const text = await sarvamSTT(audio, language);
    return NextResponse.json({ text });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Speech recognition failed." },
      { status: 500 }
    );
  }
}
