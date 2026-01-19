# NanoBanana MCP

[![MCP](https://img.shields.io/badge/MCP-1.0.1-blue)](https://modelcontextprotocol.io)
[![Gemini](https://img.shields.io/badge/Gemini-Image%20Models-orange)](https://ai.google.dev)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

MCP server that brings Gemini's image generation and editing capabilities to Claude Desktop, Claude Code, and Cursor.

## Features

- **Image Generation** - Create 2K images from text prompts
- **Image Editing** - Transform images with natural language instructions
- **Session Consistency** - Maintain style/character across generations
- **Runtime Model Switching** - Switch between Flash and Pro models without restart
- **Multi-turn Chat** - Conversational context with image support

## Quick Start

### Prerequisites

- Node.js 18+
- Google AI API Key ([Get one here](https://makersuite.google.com/app/apikey))

### Install

```bash
git clone https://github.com/YCSE/nanobanana-mcp.git
cd nanobanana-mcp
npm install
npm run build

# Configure API Key
cp .env.example .env
# Edit .env and add your GOOGLE_AI_API_KEY
```

### Add to Claude Code

```bash
source .env && claude mcp add nanobanana-mcp "node" "$(pwd)/dist/index.js" \
  -e "GOOGLE_AI_API_KEY=$GOOGLE_AI_API_KEY"
```

### Add to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "nanobanana-mcp": {
      "command": "node",
      "args": ["/path/to/nanobanana-mcp/dist/index.js"],
      "env": {
        "GOOGLE_AI_API_KEY": "your_api_key"
      }
    }
  }
}
```

### Add to Cursor

Create or edit `.cursor/mcp.json` (project-level) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "nanobanana-mcp": {
      "command": "node",
      "args": ["/path/to/nanobanana-mcp/dist/index.js"],
      "env": {
        "GOOGLE_AI_API_KEY": "your_api_key"
      }
    }
  }
}
```

Or use environment variable interpolation:

```json
{
  "mcpServers": {
    "nanobanana-mcp": {
      "command": "node",
      "args": ["/path/to/nanobanana-mcp/dist/index.js"],
      "env": {
        "GOOGLE_AI_API_KEY": "${env:GOOGLE_AI_API_KEY}"
      }
    }
  }
}
```

See [Cursor MCP Documentation](https://cursor.com/docs/context/mcp) for more details.

## Tools

| Tool | Purpose |
|------|---------|
| `set_aspect_ratio` | **Required.** Set aspect ratio before image generation |
| `set_model` | Switch between flash/pro models at runtime |
| `gemini_generate_image` | Generate images from text prompts |
| `gemini_edit_image` | Edit images with natural language |
| `gemini_chat` | Multi-turn conversation with images |
| `get_image_history` | View session image history |
| `clear_conversation` | Reset session context |

### set_aspect_ratio (Required)

Must be called before generating or editing images.

```
Valid ratios: 1:1, 9:16, 16:9, 3:4, 4:3, 3:2, 2:3, 5:4, 4:5, 21:9
```

### set_model

Switch models per-session without restarting:

| Value | Model | Description |
|-------|-------|-------------|
| `flash` | gemini-2.5-flash-image | Faster (default) |
| `pro` | gemini-3-pro-image-preview | Higher quality |

### gemini_generate_image

```typescript
{
  prompt: string;              // Image description
  aspect_ratio?: string;       // Override session ratio
  output_path?: string;        // Save path (default: ~/Documents/nanobanana_generated/)
  conversation_id?: string;    // Session ID
  use_image_history?: boolean; // Use previous images for consistency
  reference_images?: string[]; // Reference images for style
}
```

### gemini_edit_image

```typescript
{
  image_path: string;          // File path, "last", or "history:N"
  edit_prompt: string;         // Edit instructions
  aspect_ratio?: string;       // Override session ratio
  output_path?: string;        // Save path
  conversation_id?: string;    // Session ID
  reference_images?: string[]; // Style references
}
```

## Slash Commands

### Claude Code

```bash
mkdir -p ~/.claude/commands
cp commands/claude-code/*.md ~/.claude/commands/
```

### Cursor

```bash
# Project-level
mkdir -p .cursor/commands
cp commands/cursor/*.md .cursor/commands/

# Or global
mkdir -p ~/.cursor/commands
cp commands/cursor/*.md ~/.cursor/commands/
```

See [Cursor Slash Commands](https://cursor.com/changelog/1-6) for more details.

### Available Commands

```
/nb-flash  - Switch to Flash model (faster)
/nb-pro    - Switch to Pro model (higher quality)
```

## Usage Examples

### Basic Generation

```
1. Set aspect ratio: set_aspect_ratio("16:9")
2. Generate: "A cyberpunk cityscape at sunset"
```

### Character Consistency

```typescript
// First image
{ prompt: "A red-hat cat", conversation_id: "cat" }

// Second image - same character
{ prompt: "The cat taking a nap", conversation_id: "cat", use_image_history: true }
```

### Edit with History Reference

```typescript
// Edit the last generated image
{ image_path: "last", edit_prompt: "Change hat to blue" }

// Edit specific image from history
{ image_path: "history:0", edit_prompt: "Add sunglasses" }
```

### Switch Models Mid-Session

```typescript
// Start with Flash for quick iterations
set_model({ model: "flash" })
{ prompt: "Draft concept art" }

// Switch to Pro for final render
set_model({ model: "pro" })
{ prompt: "Final polished version", use_image_history: true }
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_AI_API_KEY` | Yes | Google AI API key |
| `NANOBANANA_MODEL` | No | Default model (`gemini-2.5-flash-image` or `gemini-3-pro-image-preview`) |

### Output Location

Generated images save to `~/Documents/nanobanana_generated/`:
- Generated: `generated_[timestamp].png`
- Edited: `[original]_edited_[timestamp].png`

## Development

```bash
npm run dev      # Development mode with hot reload
npm run build    # Production build
npm run start    # Run compiled server
```

## Troubleshooting

**Image generation fails:**
- Verify API key is valid
- Check quota at [Google AI Studio](https://aistudio.google.com)
- Ensure `set_aspect_ratio` was called first

**Tools not showing:**
1. Restart Claude Desktop/Code
2. Check config file syntax
3. Verify absolute paths

## License

MIT

## Links

- [Report Issues](https://github.com/YCSE/nanobanana-mcp/issues)
- [MCP Documentation](https://modelcontextprotocol.io)
- [Google AI Studio](https://aistudio.google.com)
