import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";

export const runtime = "nodejs";
export const maxDuration = 30;

// Accepts an uploaded transcript document (.txt, .md, .docx) and returns
// its plain text. This is the alternative to uploading a video/audio file.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }

    const name = file.name.toLowerCase();
    const buf = Buffer.from(await file.arrayBuffer());
    let text = "";

    if (name.endsWith(".docx")) {
      const result = await mammoth.extractRawText({ buffer: buf });
      text = result.value;
    } else if (
      name.endsWith(".txt") ||
      name.endsWith(".md") ||
      name.endsWith(".text") ||
      file.type.startsWith("text/")
    ) {
      text = buf.toString("utf-8");
    } else if (name.endsWith(".doc")) {
      return NextResponse.json(
        {
          error:
            "Old .doc format isn't supported. Save it as .docx or paste the text as .txt.",
        },
        { status: 415 }
      );
    } else {
      return NextResponse.json(
        { error: "Unsupported file. Use .txt, .md, or .docx." },
        { status: 415 }
      );
    }

    text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) {
      return NextResponse.json(
        { error: "That file looks empty." },
        { status: 422 }
      );
    }
    return NextResponse.json({ text });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Couldn't read that document." },
      { status: 500 }
    );
  }
}
