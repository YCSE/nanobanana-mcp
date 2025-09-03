#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}NanoBanana MCP Installer for Claude Desktop${NC}"
echo "================================================"

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check if .env file exists
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    echo -e "${YELLOW}Warning: .env file not found!${NC}"
    echo "Please create a .env file with your GOOGLE_AI_API_KEY"
    exit 1
fi

# Load the API key from .env
source "$SCRIPT_DIR/.env"

if [ -z "$GOOGLE_AI_API_KEY" ]; then
    echo -e "${YELLOW}Warning: GOOGLE_AI_API_KEY not found in .env file!${NC}"
    exit 1
fi

# Build the project
echo -e "${BLUE}Building the project...${NC}"
cd "$SCRIPT_DIR"
npm install
npm run build

# Detect OS and set config path
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    CONFIG_PATH="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
    # Windows
    CONFIG_PATH="$APPDATA/Claude/claude_desktop_config.json"
else
    # Linux
    CONFIG_PATH="$HOME/.config/Claude/claude_desktop_config.json"
fi

# Create config directory if it doesn't exist
CONFIG_DIR=$(dirname "$CONFIG_PATH")
mkdir -p "$CONFIG_DIR"

# Create or update the config file
if [ -f "$CONFIG_PATH" ]; then
    echo -e "${BLUE}Updating existing Claude Desktop configuration...${NC}"
    # Backup existing config
    cp "$CONFIG_PATH" "$CONFIG_PATH.backup"
    
    # Use Python to merge JSON
    python3 - <<EOF
import json
import sys

config_path = "$CONFIG_PATH"
script_dir = "$SCRIPT_DIR"
api_key = "$GOOGLE_AI_API_KEY"

try:
    with open(config_path, 'r') as f:
        config = json.load(f)
except:
    config = {}

if 'mcpServers' not in config:
    config['mcpServers'] = {}

config['mcpServers']['nanobanana-mcp'] = {
    "command": "node",
    "args": [f"{script_dir}/dist/index.js"],
    "env": {
        "GOOGLE_AI_API_KEY": api_key
    }
}

with open(config_path, 'w') as f:
    json.dump(config, f, indent=2)

print("Configuration updated successfully!")
EOF
else
    echo -e "${BLUE}Creating new Claude Desktop configuration...${NC}"
    cat > "$CONFIG_PATH" <<EOF
{
  "mcpServers": {
    "nanobanana-mcp": {
      "command": "node",
      "args": ["$SCRIPT_DIR/dist/index.js"],
      "env": {
        "GOOGLE_AI_API_KEY": "$GOOGLE_AI_API_KEY"
      }
    }
  }
}
EOF
fi

echo -e "${GREEN}✓ NanoBanana MCP has been successfully installed!${NC}"
echo ""
echo "Next steps:"
echo "1. Restart Claude Desktop"
echo "2. Look for 'nanobanana-mcp' in the MCP tools list"
echo ""
echo "Available tools:"
echo "  - gemini_chat: Chat with Gemini"
echo "  - gemini_vision: Analyze images"
echo "  - gemini_generate_image: Generate images"
echo "  - gemini_edit_image: Edit images"
echo "  - clear_conversation: Clear chat history"