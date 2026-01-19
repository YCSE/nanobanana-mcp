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
| `set_model` | N/A | Switch between flash/pro models at runtime |
| `gemini_chat` | configurable | Multi-turn conversation with up to 10 images |
| `gemini_generate_image` | configurable | 2K image generation with consistency support |
| `gemini_edit_image` | configurable | Image editing via natural language |
| `get_image_history` | N/A | View session image history |
| `clear_conversation` | N/A | Reset conversation context |

### Aspect Ratio (Required)

Valid values: `1:1`, `9:16`, `16:9`, `3:4`, `4:3`, `3:2`, `2:3`, `5:4`, `4:5`, `21:9`

Must call `set_aspect_ratio` before `gemini_generate_image` or `gemini_edit_image`. No default value - returns error if not set.

### Runtime Model Selection

Use `set_model` tool to switch models per-session without restarting:
- `model="flash"` → gemini-2.5-flash-image (faster, default)
- `model="pro"` → gemini-3-pro-image-preview (higher quality)

**Slash Commands**:
- Claude Code: `cp commands/claude-code/*.md ~/.claude/commands/`
- Cursor: `cp commands/cursor/*.md ~/.cursor/commands/`
- `/nb-flash` - Switch to Flash model
- `/nb-pro` - Switch to Pro model

### Session Management

- `conversations` Map stores per-session context (chat history + image history + aspect ratio + model)
- Image history supports references: `"last"` or `"history:N"`
- `MAX_IMAGE_HISTORY = 10` images per session (memory management)
- `MAX_REFERENCE_IMAGES = 3` included in consistency prompts

### Generated Files

Default save location: `~/Documents/nanobanana_generated/`
- Generated: `generated_[timestamp].png`
- Edited: `[original]_edited_[timestamp].png`

## Configuration

**Required:**
- `GOOGLE_AI_API_KEY` - Your Google AI API key

**Optional:**
- `NANOBANANA_MODEL` - Model selection (default: `gemini-2.5-flash-image`)
  - `gemini-2.5-flash-image` - NanoBanana (faster, default)
  - `gemini-3-pro-image-preview` - NanoBanana Pro (higher quality)

Can be set via `.env` file in project root or environment variable in MCP client config.

## Installation to Claude Code

```bash
# Default model (gemini-2.5-flash-image)
source .env && claude mcp add nanobanana-mcp "node" "dist/index.js" \
  -e "GOOGLE_AI_API_KEY=$GOOGLE_AI_API_KEY"

# Pro model (gemini-3-pro-image-preview)
source .env && claude mcp add nanobanana-mcp "node" "dist/index.js" \
  -e "GOOGLE_AI_API_KEY=$GOOGLE_AI_API_KEY" \
  -e "NANOBANANA_MODEL=gemini-3-pro-image-preview"
```
