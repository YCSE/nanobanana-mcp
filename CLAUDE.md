# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NanoBanana MCP is a Model Context Protocol server that enables Claude Desktop/Code to use Google Gemini's multimodal capabilities for image generation, editing, and vision analysis.

## Build Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm run dev          # Development mode with hot reload (tsx watch)
npm run start        # Run compiled server
```

## Architecture

Single-file MCP server (`src/index.ts`) using stdio transport:

- **MCP SDK Integration**: Uses `@modelcontextprotocol/sdk` for server/transport
- **Dual Gemini SDKs**:
  - `@google/generative-ai` (`genAI`) - For chat operations
  - `@google/genai` (`genAINew`) - For image generation/editing with streaming

### Tools Exposed

| Tool | Model | Purpose |
|------|-------|---------|
| `set_aspect_ratio` | N/A | **Required before image generation/editing.** Set aspect ratio for session |
| `gemini_chat` | gemini-2.5-flash-image | Multi-turn conversation with up to 10 images |
| `gemini_generate_image` | gemini-2.5-flash-image | 2K image generation with consistency support |
| `gemini_edit_image` | gemini-2.5-flash-image | Image editing via natural language |
| `get_image_history` | N/A | View session image history |
| `clear_conversation` | N/A | Reset conversation context |

### Aspect Ratio (Required)

Valid values: `1:1`, `9:16`, `16:9`, `3:4`, `4:3`, `3:2`, `2:3`, `5:4`, `4:5`, `21:9`

Must call `set_aspect_ratio` before `gemini_generate_image` or `gemini_edit_image`. No default value - returns error if not set.

### Session Management

- `conversations` Map stores per-session context (chat history + image history + aspect ratio)
- Image history supports references: `"last"` or `"history:N"`
- `MAX_IMAGE_HISTORY = 10` images per session (memory management)
- `MAX_REFERENCE_IMAGES = 3` included in consistency prompts

### Generated Files

Default save location: `~/Documents/nanobanana_generated/`
- Generated: `generated_[timestamp].png`
- Edited: `[original]_edited_[timestamp].png`

## Configuration

Requires `GOOGLE_AI_API_KEY` environment variable. Can be set via:
- `.env` file in project root
- Environment variable in MCP client config

## Installation to Claude Code

```bash
source .env && claude mcp add nanobanana-mcp "node" "dist/index.js" \
  -e "GOOGLE_AI_API_KEY=$GOOGLE_AI_API_KEY"
```
