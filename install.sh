#!/bin/bash

# Exit on error, but allow continuing after warnings
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

# Make install.sh executable
chmod +x "${BASH_SOURCE[0]}" 2>/dev/null || true

echo -e "${CYAN}"
echo "┌─────────────────────────────────────────────────────┐"
echo "│                                                     │"
echo "│              VPS-CODE-BOT INSTALLER                │"
echo "│         Smart VPS Management Platform               │"
echo "│                                                     │"
echo "└─────────────────────────────────────────────────────┘"
echo -e "${NC}\n"

# Detect OS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
else
    echo -e "${RED}Unsupported OS: $OSTYPE${NC}"
    exit 1
fi

echo -e "${CYAN}━━━ System Detection ━━━${NC}\n"

# Check and install Node.js
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}Node.js not found. Installing...${NC}"
    if [ "$OS" = "linux" ]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif [ "$OS" = "macos" ]; then
        brew install node@20
    fi
    echo -e "${GREEN}✓ Node.js installed${NC}"
else
    echo -e "${GREEN}✓ Node.js$(node --version)${NC}"
fi

# Check and install Docker
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker not found. Installing...${NC}"
    if [ "$OS" = "linux" ]; then
        curl -fsSL https://get.docker.com -o get-docker.sh
        sudo sh get-docker.sh
        sudo usermod -aG docker $USER
        newgrp docker
        rm get-docker.sh
    elif [ "$OS" = "macos" ]; then
        echo -e "${YELLOW}Please install Docker Desktop from: https://www.docker.com/products/docker-desktop${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Docker installed${NC}"
else
    echo -e "${GREEN}✓ Docker $(docker --version | awk '{print $3}' | cut -d',' -f1)${NC}"
fi

# Check Caddy
if ! command -v caddy &> /dev/null; then
    echo -e "${YELLOW}Caddy not found. Installing...${NC}"
    if [ "$OS" = "linux" ]; then
        sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
        curl -1sLf 'https://dl.caddy.community/api/v1/repos/caddy/caddy/releases/download?tag=v2.7.6' | sudo apt-key add -
        echo "deb [trusted=yes] https://dl.caddy.community/apt caddy main" | sudo tee /etc/apt/sources.list.d/caddy-fury.list
        sudo apt-get update
        sudo apt-get install -y caddy
    elif [ "$OS" = "macos" ]; then
        brew install caddy
    fi
    echo -e "${GREEN}✓ Caddy installed${NC}"
else
    echo -e "${GREEN}✓ Caddy $(caddy version 2>/dev/null | head -1 || echo 'installed')${NC}"
fi

# Check Claude Code (don't install, just detect)
echo -n "  Claude Code: "
if command -v claude-code &> /dev/null; then
    echo -e "${GREEN}✓ detected${NC}"
    CLAUDE_CLI=$(command -v claude-code)
elif [ -f "$HOME/.local/share/code-server/extensions/anthropic.claude-code-*/resources/claude-code/cli.js" ]; then
    echo -e "${GREEN}✓ detected${NC}"
    CLAUDE_CLI=$(find "$HOME/.local/share/code-server/extensions" -name "cli.js" -path "*/claude-code/*" 2>/dev/null | head -1)
else
    echo -e "${YELLOW}⚠ not found (required)${NC}"
    CLAUDE_CLI=""
fi

echo ""

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}NPM not found. Please install Node.js.${NC}"
    exit 1
fi

# Install project dependencies
echo -e "${CYAN}━━━ Installing Dependencies ━━━${NC}\n"
npm install

echo ""
echo -e "${CYAN}━━━ Initial Setup ━━━${NC}\n"

# Run setup
node src/setup.js --claude-cli "$CLAUDE_CLI" --os "$OS"

echo ""
echo -e "${GREEN}Installation complete!${NC}"
echo ""
echo "Next steps:"
echo "  npm start      Launch main menu"
echo "  npm run bot    Start Telegram bot"
echo "  npm run cli    Web dashboard"
echo ""
