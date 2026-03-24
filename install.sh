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

# Install dir = where this script lives
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${CYAN}━━━ System Detection ━━━${NC}\n"

# Check and install Node.js
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}Node.js not found. Installing...${NC}"
    if [ "$OS" = "linux" ]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
    elif [ "$OS" = "macos" ]; then
        brew install node@20
    fi
    echo -e "${GREEN}✓ Node.js installed${NC}"
else
    echo -e "${GREEN}✓ Node.js $(node --version)${NC}"
fi

# Check and install Docker
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker not found. Installing...${NC}"
    if [ "$OS" = "linux" ]; then
        curl -fsSL https://get.docker.com -o get-docker.sh
        sh get-docker.sh
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
        apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
        apt-get update
        apt-get install -y caddy
    elif [ "$OS" = "macos" ]; then
        brew install caddy
    fi
    echo -e "${GREEN}✓ Caddy installed${NC}"
else
    echo -e "${GREEN}✓ Caddy $(caddy version 2>/dev/null | head -1 || echo 'installed')${NC}"
fi

# Check and install Claude Code CLI (global, as root)
if command -v claude &> /dev/null; then
    echo -e "${GREEN}✓ Claude Code CLI $(claude --version 2>/dev/null || echo 'installed')${NC}"
    CLAUDE_CLI=$(command -v claude)
else
    echo -e "${YELLOW}Claude Code CLI not found. Installing...${NC}"
    npm install -g @anthropic-ai/claude-code
    if command -v claude &> /dev/null; then
        echo -e "${GREEN}✓ Claude Code CLI installed${NC}"
        CLAUDE_CLI=$(command -v claude)
    else
        echo -e "${YELLOW}⚠ Claude Code CLI installation failed. Install manually: npm install -g @anthropic-ai/claude-code${NC}"
        CLAUDE_CLI=""
    fi
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

# Create vpsbot user (non-root, only for Claude Code execution)
VPSBOT_USER="vpsbot"
VPSBOT_HOME="/home/${VPSBOT_USER}"

if id "$VPSBOT_USER" &>/dev/null; then
    echo -e "${GREEN}✓ User '${VPSBOT_USER}' exists (for Claude Code)${NC}"
else
    echo -e "${YELLOW}Creating user '${VPSBOT_USER}' (required by Claude Code)...${NC}"
    useradd -m -s /bin/bash "$VPSBOT_USER"
    echo -e "${GREEN}✓ User '${VPSBOT_USER}' created${NC}"
fi

# Allow root to su to vpsbot without password
# Give vpsbot read access to project dir
chmod -R o+rX "$INSTALL_DIR" 2>/dev/null || true

echo ""

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}NPM not found. Please install Node.js.${NC}"
    exit 1
fi

# Install dependencies (as root, in place)
echo -e "${CYAN}━━━ Installing Dependencies ━━━${NC}\n"
cd "$INSTALL_DIR"
npm install

echo ""
echo -e "${CYAN}━━━ Initial Setup ━━━${NC}\n"

# Run setup wizard (as root)
if ! node src/setup.js --claude-cli "$CLAUDE_CLI" --os "$OS"; then
    echo -e "${RED}Setup wizard failed. You can run it later with: npm run setup${NC}"
fi

echo ""
echo -e "${CYAN}━━━ Infrastructure Setup ━━━${NC}\n"

# Read .env values for infrastructure config
if [ -f "${INSTALL_DIR}/.env" ]; then
    source "${INSTALL_DIR}/.env" 2>/dev/null || true
fi

# Ensure Docker is running
if docker info &> /dev/null; then
    echo -e "${GREEN}✓ Docker daemon is running${NC}"
else
    echo -e "${YELLOW}Starting Docker...${NC}"
    if [ "$OS" = "linux" ]; then
        systemctl start docker 2>/dev/null || true
        systemctl enable docker 2>/dev/null || true
    fi
    if docker info &> /dev/null; then
        echo -e "${GREEN}✓ Docker started${NC}"
    else
        echo -e "${RED}⚠ Docker daemon not running. Please start Docker manually.${NC}"
    fi
fi

# Create Docker network 'caddy' if it doesn't exist
if docker network ls --format '{{.Name}}' | grep -qx 'caddy'; then
    echo -e "${GREEN}✓ Docker network 'caddy' exists${NC}"
else
    echo -e "${YELLOW}Creating Docker network 'caddy'...${NC}"
    docker network create caddy
    echo -e "${GREEN}✓ Docker network 'caddy' created${NC}"
fi

# Setup Caddy reverse proxy
CS_PORT="${CODE_SERVER_PORT:-8080}"

if [ -n "$DOMAIN" ]; then
    echo -e "${CYAN}Setting up Caddy for domain: ${DOMAIN}${NC}"

    # Stop system Caddy if running (we use Docker Caddy instead)
    systemctl stop caddy 2>/dev/null || true
    systemctl disable caddy 2>/dev/null || true

    # Remove old caddy-proxy container if exists
    docker rm -f caddy-proxy 2>/dev/null || true

    docker run -d \
        --name caddy-proxy \
        --restart unless-stopped \
        --network caddy \
        -p 80:80 \
        -p 443:443 \
        -p 2019:2019 \
        -v /var/run/docker.sock:/var/run/docker.sock \
        -v caddy_data:/data \
        -l "caddy.admin=0.0.0.0:2019" \
        -l "caddy_0=code.${DOMAIN}" \
        -l "caddy_0.reverse_proxy=host.docker.internal:${CS_PORT}" \
        --add-host host.docker.internal:host-gateway \
        lucaslorentz/caddy-docker-proxy:ci-alpine 2>/dev/null

    if docker ps --format '{{.Names}}' | grep -qx 'caddy-proxy'; then
        echo -e "${GREEN}✓ Caddy running (caddy-docker-proxy)${NC}"
        echo -e "${GREEN}  → https://code.${DOMAIN} → Code-Server${NC}"
        echo -e "${GREEN}  → https://{app}.${DOMAIN} → Project containers (auto)${NC}"
        echo -e "${GREEN}  → SSL certificates managed automatically${NC}"
    else
        echo -e "${RED}⚠ Caddy container failed to start. Check: docker logs caddy-proxy${NC}"
    fi
else
    echo -e "${GRAY}IP mode — Caddy not needed (direct port access)${NC}"
fi

# Setup systemd services (persist after SSH close)
NODE_BIN=$(which node)
PROJECTS_DIR="${PROJECTS_DIR:-/home/vpsbot/projects}"
mkdir -p "$PROJECTS_DIR"

# Code-Server service (runs as root)
if command -v code-server &> /dev/null; then
    CS_BIND="0.0.0.0:${CS_PORT}"
    if [ -n "$DOMAIN" ]; then
        CS_BIND="127.0.0.1:${CS_PORT}"
    fi
    CS_PASS="${CODE_SERVER_PASSWORD:-changeme}"

    mkdir -p "$HOME/.config/code-server"
    cat > "$HOME/.config/code-server/config.yaml" << EOF
bind-addr: ${CS_BIND}
auth: password
password: ${CS_PASS}
cert: false
EOF

    cat > /etc/systemd/system/code-server.service << EOF
[Unit]
Description=Code Server
After=network.target

[Service]
Type=simple
ExecStart=$(which code-server) --disable-telemetry ${PROJECTS_DIR}
Restart=always
RestartSec=5
Environment=HOME=$HOME

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable code-server
    systemctl restart code-server
    sleep 2

    if systemctl is-active --quiet code-server; then
        if [ -n "$DOMAIN" ]; then
            echo -e "${GREEN}✓ Code-Server → https://code.${DOMAIN} (systemd)${NC}"
        else
            echo -e "${GREEN}✓ Code-Server → http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):${CS_PORT} (systemd)${NC}"
        fi
    else
        echo -e "${YELLOW}⚠ Code-Server service failed to start${NC}"
    fi
else
    echo -e "${YELLOW}⚠ Code-Server not installed (optional)${NC}"
fi

# Telegram Bot service (runs as root for Docker access)
cat > /etc/systemd/system/vps-bot-telegram.service << EOF
[Unit]
Description=VPS-CODE-BOT Telegram Bot
After=network.target docker.service

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
ExecStart=${NODE_BIN} src/bot.js
Restart=always
RestartSec=10
EnvironmentFile=${INSTALL_DIR}/.env
Environment=HOME=$HOME

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
echo -e "${GREEN}✓ Systemd services installed (persist after SSH close)${NC}"
echo -e "${GRAY}  code-server.service         → auto-start${NC}"
echo -e "${GRAY}  vps-bot-telegram.service    → start from CLI menu${NC}"

# Give vpsbot user access to projects dir (for Claude Code to write)
chown -R "${VPSBOT_USER}:${VPSBOT_USER}" "$PROJECTS_DIR" 2>/dev/null || true

# Authenticate Claude Code for vpsbot (OAuth — credentials stored in vpsbot's home)
echo ""
echo -e "${CYAN}━━━ Claude Code Authentication ━━━${NC}\n"
echo -e "Claude Code needs to be authenticated for the '${VPSBOT_USER}' user."
echo -e "A URL will appear — open it in your browser to log in.\n"
su - "$VPSBOT_USER" -c "$(command -v claude || echo claude) auth login" </dev/tty >>/dev/tty 2>>/dev/tty || \
    echo -e "${YELLOW}⚠ Auth skipped or failed. Run later: su - ${VPSBOT_USER} -c 'claude auth login'${NC}"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}          Installation complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${CYAN}npm start${NC}      Launch main menu"
echo -e "  ${CYAN}npm run cli${NC}    CLI dashboard"
echo -e "  ${CYAN}npm run setup${NC}  Reconfigure"
echo ""
echo -e "  ${GREEN}Services persist after closing SSH!${NC}"
echo -e "  ${GRAY}Claude Code runs as '${VPSBOT_USER}' user (non-root)${NC}"
echo ""

# Launch directly
cd "$INSTALL_DIR"
node src/cli-home.js
