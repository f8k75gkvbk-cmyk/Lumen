import { NextRequest, NextResponse } from "next/server";
import { sarvamSTT } from "@/lib/sarvam";

export const runtime = "nodejs";
export const maxDuration = 60;

// The client extracts audio and slices it into <=30s WAV chunks, POSTing one
// chunk at a time here. We transcribe each and the client stitches them.
// This keeps each request well under Vercel's serverless limits.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const chunk = form.get("chunk") as Blob | null;
    const language = (form.get("language") as string) || "unknown";

    if (!chunk) {
      return NextResponse.json(
        { error: "No audio chunk provided." },
        { status: 400 }
      );
    }

    const text = await sarvamSTT(chunk, language);
    return NextResponse.json({ text });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Transcription failed." },
      { status: 500 }
    );
  }
}
