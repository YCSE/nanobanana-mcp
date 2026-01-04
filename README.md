# 🍌 NanoBanana MCP - Gemini Vision & Image Generation for Claude

[![MCP](https://img.shields.io/badge/MCP-1.0.1-blue)](https://modelcontextprotocol.io)
[![Gemini](https://img.shields.io/badge/Gemini-3%20Pro-orange)](https://ai.google.dev)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

Supercharge Claude Desktop and Claude Code with Google's Gemini multimodal capabilities! Generate stunning images with session-based consistency, edit existing ones, and leverage advanced vision AI - all within your Claude environment.

## ✨ Features

- 🎨 **Image Generation** - Create 2K images from text prompts using Gemini 2.5 Flash
- 📐 **Dynamic Aspect Ratio** - Set custom aspect ratios (1:1, 16:9, 9:16, 4:3, 3:4, etc.) per session
- 🔄 **Image Consistency** - Maintain character/style consistency across multiple generations within a session
- 🖼️ **Image Editing** - Transform existing images with natural language instructions
- 🔍 **Google Search Integration** - Ground image generation with real-world references
- 💬 **Multi-turn Chat** - Maintain conversational context across interactions
- 📜 **Session History** - Reference previous images using `last` or `history:N`

## 🎬 Demo

```bash
# Generate an image
"Create a serene Korean beach scene with traditional architecture"

# Edit an existing image
"Add a dramatic T-Rex appearing on the beach, people reacting with surprise"
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- One of: Claude Desktop, Claude Code, VSCode, Cursor, or Windsurf
- Google AI API Key ([Get it here](https://makersuite.google.com/app/apikey))

### Installation

First, clone and build the project:

```bash
git clone https://github.com/YCSE/nanobanana-mcp.git
cd nanobanana-mcp
npm install
npm run build

# Configure API Key
cp .env.example .env
# Edit .env and add your GOOGLE_AI_API_KEY
```

Then choose your platform:

#### Claude Desktop

Edit your Claude Desktop config:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "nanobanana-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/nanobanana-mcp/dist/index.js"],
      "env": {
        "GOOGLE_AI_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

Restart Claude Desktop after adding the configuration.

#### Claude Code (Recommended)

```bash
# After building, install to Claude Code
source .env && claude mcp add nanobanana-mcp "node" "dist/index.js" \
  -e "GOOGLE_AI_API_KEY=$GOOGLE_AI_API_KEY"
```

#### VSCode

Install the [Continue extension](https://marketplace.visualstudio.com/items?itemName=Continue.continue) and add to `~/.continue/config.json`:

```json
{
  "models": [
    // Your existing models
  ],
  "mcpServers": {
    "nanobanana-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/nanobanana-mcp/dist/index.js"],
      "env": {
        "GOOGLE_AI_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

#### Cursor

Add to your Cursor settings file `~/.cursor/config.json`:

```json
{
  "mcpServers": {
    "nanobanana-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/nanobanana-mcp/dist/index.js"],
      "env": {
        "GOOGLE_AI_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

#### Windsurf

Add to your Windsurf configuration file `~/.windsurf/config.json`:

```json
{
  "mcpServers": {
    "nanobanana-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/nanobanana-mcp/dist/index.js"],
      "env": {
        "GOOGLE_AI_API_KEY": "your_api_key_here"
      }
    }
  }
}
```


## 🛠️ Available Tools

### `set_aspect_ratio` ⚠️ Required
Set the aspect ratio for image generation/editing. **Must be called before generating or editing images.**

```typescript
{
  aspect_ratio: string;        // Required: "1:1" | "9:16" | "16:9" | "3:4" | "4:3" | "3:2" | "2:3" | "5:4" | "4:5" | "21:9"
  conversation_id?: string;    // Session ID (default: "default")
}
```

**Example:**
```typescript
// Set 16:9 widescreen ratio for the session
{ aspect_ratio: "16:9", conversation_id: "my-session" }

// Then generate images - they will use 16:9
{ prompt: "A panoramic mountain landscape", conversation_id: "my-session" }
```

### `gemini_generate_image`
Generate 2K images from text descriptions with session-based consistency.

```typescript
{
  prompt: string;              // Image description
  output_path?: string;        // Optional save path (default: ~/Documents/nanobanana_generated/)
  conversation_id?: string;    // Session ID for image history
  use_image_history?: boolean; // Use previous images for style/character consistency
  reference_images?: string[]; // Manual reference images for consistency
  enable_google_search?: boolean; // Enable Google Search for real-world grounding
}
```

**Example - Basic:**
```
"Generate a cyberpunk cityscape at sunset with flying cars"
```

**Example - With Consistency:**
```typescript
// First image
{ prompt: "A cute red-hat cat", conversation_id: "cat-session" }

// Second image - maintains same character
{ prompt: "The same cat taking a nap", conversation_id: "cat-session", use_image_history: true }
```

### `gemini_edit_image`
Edit existing images using natural language. Supports session history references.

```typescript
{
  image_path: string;          // Path, or "last", or "history:N"
  edit_prompt: string;         // Edit instructions
  output_path?: string;        // Optional save path
  conversation_id?: string;    // Session ID for accessing history
  reference_images?: string[]; // Additional style references
  enable_google_search?: boolean; // Enable Google Search
}
```

**Example - File Path:**
```
"Remove the background and make it transparent"
```

**Example - History Reference:**
```typescript
// Edit the most recent image in the session
{ image_path: "last", edit_prompt: "Change hat color to blue", conversation_id: "cat-session" }

// Edit a specific image from history
{ image_path: "history:0", edit_prompt: "Add sunglasses", conversation_id: "cat-session" }
```

### `gemini_chat`
Chat with Gemini for general queries.

```typescript
{
  message: string;           // Your message
  conversation_id?: string;  // Optional conversation ID
  system_prompt?: string;    // Optional system instructions
}
```

### `get_image_history`
View generated/edited images in a session.

```typescript
{
  conversation_id: string;   // Session to view
}
```

**Response includes:**
- Image index and reference (`history:0`, `history:1`, etc.)
- File paths
- Original prompts
- Timestamps

### `clear_conversation`
Reset conversation history.

```typescript
{
  conversation_id: string;   // Conversation to clear
}
```

## 🔀 Model Variants

NanoBanana MCP uses Gemini models optimized for each task:

| Tool | Model | Purpose |
|------|-------|---------|
| `set_aspect_ratio` | N/A | Session configuration |
| `gemini_generate_image` | `gemini-2.5-flash-image` | 2K image generation |
| `gemini_edit_image` | `gemini-2.5-flash-image` | Image editing with consistency |
| `gemini_chat` | `gemini-2.5-flash-image` | Multi-turn conversation |
| `get_image_history` | N/A | View session history |
| `clear_conversation` | N/A | Reset session |

## 🎯 Use Cases

### For Developers
- Generate placeholder images for web development
- Create app icons and assets
- Analyze UI/UX screenshots
- Generate test data images

### For Content Creators
- Edit images with text commands
- Generate blog illustrations
- Create social media visuals
- Batch process image modifications

### For Designers
- Rapid prototyping with generated visuals
- Style transfer and variations
- Color scheme analysis
- Accessibility checking

## 📁 Default Save Locations

Images are automatically saved to:
- **Generated images:** `~/Documents/nanobanana_generated/generated_[timestamp].png`
- **Edited images:** `~/Documents/nanobanana_generated/[original_name]_edited_[timestamp].png`

All images are saved in PNG format for maximum quality.

## 🔧 Development

```bash
# Run in development mode with hot reload
npm run dev

# Build for production
npm run build

# Type checking
npm run typecheck
```

## 🏗️ Architecture

```
nanobanana-mcp/
├── src/
│   └── index.ts         # MCP server implementation
├── dist/                # Compiled JavaScript
├── .env                 # API configuration
├── claude-mcp           # CLI management tool
└── package.json
```

## 🔐 Security

- API keys are stored locally in `.env`
- Never commit `.env` to version control
- All image operations happen locally
- No data is stored on external servers

## 🐛 Troubleshooting

### "Failed to connect" error
```bash
# Check installation
./claude-mcp status

# Rebuild if needed
npm run build
```

### Image generation fails
- Verify API key is valid
- Check API quota at [Google AI Studio](https://makersuite.google.com)
- Ensure output directory has write permissions

### Claude doesn't show the tools
1. Restart Claude Desktop/Code
2. Check config file syntax
3. Verify absolute paths in configuration

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🌟 Star History

If you find this project useful, please consider giving it a star ⭐️

[![Star History Chart](https://api.star-history.com/svg?repos=YCSE/nanobanana-mcp&type=Date)](https://star-history.com/#YCSE/nanobanana-mcp&Date)

## 🙏 Acknowledgments

- [Anthropic](https://anthropic.com) for Claude and MCP
- [Google](https://ai.google.dev) for Gemini API
- [Model Context Protocol](https://modelcontextprotocol.io) community

## 📧 Support

- 🐛 [Report Issues](https://github.com/YCSE/nanobanana-mcp/issues)
- 💬 [Discussions](https://github.com/YCSE/nanobanana-mcp/discussions)
- 📖 [Documentation](https://github.com/YCSE/nanobanana-mcp/wiki)

---

<p align="center">
  Made with ❤️ for the Claude community
</p>

<p align="center">
  <a href="https://modelcontextprotocol.io">
    <img src="https://img.shields.io/badge/Learn%20More-MCP-blue?style=for-the-badge" alt="Learn More about MCP">
  </a>
</p>