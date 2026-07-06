import { NextRequest, NextResponse } from "next/server";
import { sarvamChat, buildTutorSystemPrompt, ChatMessage } from "@/lib/sarvam";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { transcript, history, question, language } = await req.json();

    if (!transcript || !question) {
      return NextResponse.json(
        { error: "Transcript and question are both required." },
        { status: 400 }
      );
    }

    const lang: "en" | "hi" = language === "hi" ? "hi" : "en";

    const messages: ChatMessage[] = [
      { role: "system", content: buildTutorSystemPrompt(transcript, lang) },
      ...(Array.isArray(history) ? history : []).slice(-8),
      { role: "user", content: question },
    ];

    const answer = await sarvamChat(messages);
    return NextResponse.json({ answer });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Chat failed." },
      { status: 500 }
    );
  }
}
