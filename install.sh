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
        sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
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

# Check and install code-server
if ! command -v code-server &> /dev/null; then
    echo -e "${YELLOW}Code-Server not found. Installing...${NC}"
    if [ "$OS" = "linux" ]; then
        curl -fsSL https://code-server.dev/install.sh | sh
    elif [ "$OS" = "macos" ]; then
        brew install code-server
    fi
    if command -v code-server &> /dev/null; then
        echo -e "${GREEN}✓ Code-Server installed${NC}"
    else
        echo -e "${YELLOW}⚠ Code-Server installation failed (optional, continuing)${NC}"
    fi
else
    echo -e "${GREEN}✓ Code-Server $(code-server --version 2>/dev/null | head -1 || echo 'installed')${NC}"
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

# Run setup wizard
node src/setup.js --claude-cli "$CLAUDE_CLI" --os "$OS"

echo ""
echo -e "${CYAN}━━━ Infrastructure Setup ━━━${NC}\n"

# Create Docker network 'caddy' if it doesn't exist
if docker network ls --format '{{.Name}}' | grep -qx 'caddy'; then
    echo -e "${GREEN}✓ Docker network 'caddy' exists${NC}"
else
    echo -e "${YELLOW}Creating Docker network 'caddy'...${NC}"
    docker network create caddy
    echo -e "${GREEN}✓ Docker network 'caddy' created${NC}"
fi

# Ensure Caddy is running (Linux systemd only)
if [ "$OS" = "linux" ]; then
    if systemctl is-active --quiet caddy 2>/dev/null; then
        echo -e "${GREEN}✓ Caddy is running${NC}"
    else
        echo -e "${YELLOW}Starting Caddy...${NC}"
        sudo systemctl enable caddy 2>/dev/null || true
        sudo systemctl start caddy 2>/dev/null || true
        if systemctl is-active --quiet caddy 2>/dev/null; then
            echo -e "${GREEN}✓ Caddy started${NC}"
        else
            echo -e "${YELLOW}⚠ Could not start Caddy via systemd. Start it manually if needed.${NC}"
        fi
    fi
elif [ "$OS" = "macos" ]; then
    if curl -sf http://localhost:2019/config/ > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Caddy Admin API responding${NC}"
    else
        echo -e "${YELLOW}⚠ Caddy not running. Start it with: caddy run --config Caddyfile${NC}"
    fi
fi

# Ensure Docker is running
if docker info &> /dev/null; then
    echo -e "${GREEN}✓ Docker daemon is running${NC}"
else
    echo -e "${YELLOW}Starting Docker...${NC}"
    if [ "$OS" = "linux" ]; then
        sudo systemctl start docker 2>/dev/null || true
        sudo systemctl enable docker 2>/dev/null || true
    fi
    if docker info &> /dev/null; then
        echo -e "${GREEN}✓ Docker started${NC}"
    else
        echo -e "${RED}⚠ Docker daemon not running. Please start Docker manually.${NC}"
    fi
fi

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}          Installation complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${CYAN}npm start${NC}      Launch main menu"
echo -e "  ${CYAN}npm run bot${NC}    Start Telegram bot"
echo -e "  ${CYAN}npm run cli${NC}    CLI dashboard"
echo -e "  ${CYAN}npm run setup${NC}  Reconfigure"
echo ""

# Ask if user wants to start now
read -p "$(echo -e ${CYAN})Launch VPS-CODE-BOT now? (y/n) $(echo -e ${NC})" -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    node src/cli-home.js
fi
