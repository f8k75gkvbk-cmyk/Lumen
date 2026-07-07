# Sarvam MCP — developer setup

The Sarvam MCP server lets an MCP-aware client (Claude Desktop, Claude Code,
Cursor, Windsurf, Zed) call every Sarvam API as a tool while you build. It is a
**development-time** tool, not something the deployed website calls at runtime —
the Vercel app talks to Sarvam's REST API directly and server-side (that keeps
your key off the client and out of any local process dependency).

## Add it to your MCP client

Paste this into your client's MCP config (e.g. `claude_desktop_config.json`, or
the MCP settings in Cursor/Windsurf):

```json
{
  "mcpServers": {
    "sarvam": {
      "command": "uvx",
      "args": ["sarvam-mcp"],
      "env": {
        "SARVAM_API_KEY": "<YOUR_SARVAM_API_KEY>"
      }
    }
  }
}
```

Requires `uv` installed (`pipx install uv` or see astral.sh/uv). Python 3.11+.
Restart the client, then verify with a prompt like:

> "Use sarvam to translate 'good morning' to Hindi."

## What you get

Runtime tools (`sarvam_tools_*`): `sarvam_stt_transcribe` (saaras:v3),
`sarvam_tts_speak` / `sarvam_tts_stream` (bulbul:v3), `sarvam_translate`,
`sarvam_transliterate`, `sarvam_identify_language`, `sarvam_text_analytics`,
`sarvam_llm_complete` (sarvam-30b), `sarvam_vision_extract`, and pronunciation
dictionary tools.

Builder tools (`sarvam_code_*`): docs, endpoint shapes, language lists, and code
snippets to help you write Sarvam integrations.

## How Lumen uses Sarvam (production path)

The live app does **not** go through this MCP. It calls Sarvam REST directly
from server-side Next.js routes so the key never reaches the browser:

- `saaras:v3`  → `/api/transcribe`, `/api/stt`
- `sarvam-30b` → `/api/chat`  (thinking mode disabled, temperature 0.2)
- `bulbul:v3`  → `/api/tts`   (speaker `priya`, 24kHz, preprocessing on)

Use the MCP above to prototype prompts, try speakers, and generate snippets;
the app ships the same models through its own routes.
