#!/bin/bash

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m'

chmod +x "${BASH_SOURCE[0]}" 2>/dev/null || true

# Silent runner — shows a spinner while command runs
run_silent() {
    local msg="$1"
    shift
    printf "  ${GRAY}%-40s${NC}" "$msg"
    if "$@" > /dev/null 2>&1; then
        echo -e " ${GREEN}✓${NC}"
        return 0
    else
        echo -e " ${RED}✗${NC}"
        return 1
    fi
}

# Silent runner for piped commands (bash -c)
run_silent_sh() {
    local msg="$1"
    shift
    printf "  ${GRAY}%-40s${NC}" "$msg"
    if bash -c "$*" > /dev/null 2>&1; then
        echo -e " ${GREEN}✓${NC}"
        return 0
    else
        echo -e " ${RED}✗${NC}"
        return 1
    fi
}

echo -e "${CYAN}"
echo "┌─────────────────────────────────────────────────────┐"
echo "│              VPS-CODE-BOT INSTALLER                │"
echo "│         Smart VPS Management Platform               │"
echo "└─────────────────────────────────────────────────────┘"
echo -e "${NC}"

# Detect OS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
else
    echo -e "${RED}Unsupported OS: $OSTYPE${NC}"
    exit 1
fi

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${CYAN}Installing dependencies...${NC}\n"

# Node.js
if command -v node &> /dev/null; then
    echo -e "  Node.js $(node --version)                          ${GREEN}✓${NC}"
else
    run_silent_sh "Node.js" "curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs"
fi

# Docker
if command -v docker &> /dev/null; then
    echo -e "  Docker $(docker --version 2>/dev/null | awk '{print $3}' | cut -d',' -f1)                            ${GREEN}✓${NC}"
else
    run_silent_sh "Docker" "curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sh /tmp/get-docker.sh && rm /tmp/get-docker.sh"
fi

# Caddy
if command -v caddy &> /dev/null; then
    echo -e "  Caddy $(caddy version 2>/dev/null | awk '{print $1}' || echo '')                          ${GREEN}✓${NC}"
else
    run_silent_sh "Caddy" \
        "apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl && \
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && \
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list && \
        apt-get update && apt-get install -y caddy"
fi

# Claude Code CLI
if command -v claude &> /dev/null; then
    echo -e "  Claude Code CLI                              ${GREEN}✓${NC}"
    CLAUDE_CLI=$(command -v claude)
else
    run_silent "Claude Code CLI" npm install -g @anthropic-ai/claude-code
    CLAUDE_CLI=$(command -v claude 2>/dev/null || echo "claude")
fi

# Code-Server
if command -v code-server &> /dev/null; then
    echo -e "  Code-Server                                  ${GREEN}✓${NC}"
else
    run_silent_sh "Code-Server" "curl -fsSL https://code-server.dev/install.sh | sh"
fi

# vpsbot user
VPSBOT_USER="vpsbot"
VPSBOT_HOME="/home/${VPSBOT_USER}"
if id "$VPSBOT_USER" &>/dev/null; then
    echo -e "  User '${VPSBOT_USER}'                                 ${GREEN}✓${NC}"
else
    run_silent "User '${VPSBOT_USER}'" useradd -m -s /bin/bash "$VPSBOT_USER"
fi

chmod -R o+rX "$INSTALL_DIR" 2>/dev/null || true

# npm install
echo ""
run_silent "npm install" bash -c "cd '$INSTALL_DIR' && npm install"

# Setup
echo ""
echo -e "${CYAN}Configuring...${NC}\n"

cd "$INSTALL_DIR"
node src/setup.js --claude-cli "$CLAUDE_CLI" --os "$OS" 2>/dev/null || true

# Source .env
if [ -f "${INSTALL_DIR}/.env" ]; then
    source "${INSTALL_DIR}/.env" 2>/dev/null || true
fi

# Docker daemon
if ! docker info &> /dev/null; then
    run_silent "Starting Docker" bash -c "systemctl start docker && systemctl enable docker"
fi

# Docker network
if ! docker network ls --format '{{.Name}}' | grep -qx 'caddy'; then
    run_silent "Docker network 'caddy'" docker network create caddy
fi

# Caddy reverse proxy (domain mode only)
CS_PORT="${CODE_SERVER_PORT:-8080}"
if [ -n "$DOMAIN" ]; then
    systemctl stop caddy 2>/dev/null || true
    systemctl disable caddy 2>/dev/null || true
    docker rm -f caddy-proxy 2>/dev/null || true

    run_silent "Caddy proxy → ${DOMAIN}" docker run -d \
        --name caddy-proxy \
        --restart unless-stopped \
        --network caddy \
        -p 80:80 -p 443:443 -p 2019:2019 \
        -v /var/run/docker.sock:/var/run/docker.sock \
        -v caddy_data:/data \
        -l "caddy.admin=0.0.0.0:2019" \
        -l "caddy_0=code.${DOMAIN}" \
        -l "caddy_0.reverse_proxy=host.docker.internal:${CS_PORT}" \
        --add-host host.docker.internal:host-gateway \
        lucaslorentz/caddy-docker-proxy:ci-alpine
fi

# Systemd services
NODE_BIN=$(which node)
PROJECTS_DIR="${PROJECTS_DIR:-/home/vpsbot/projects}"
mkdir -p "$PROJECTS_DIR"

if command -v code-server &> /dev/null; then
    CS_BIND="0.0.0.0:${CS_PORT}"
    [ -n "$DOMAIN" ] && CS_BIND="127.0.0.1:${CS_PORT}"
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

    systemctl daemon-reload > /dev/null 2>&1
    systemctl enable code-server > /dev/null 2>&1
    systemctl restart code-server > /dev/null 2>&1
    sleep 1
    if systemctl is-active --quiet code-server; then
        IP_DISPLAY=$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost')
        echo -e "  Code-Server → http://${IP_DISPLAY}:${CS_PORT}      ${GREEN}✓${NC}"
    fi
fi

# Bot service
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

systemctl daemon-reload > /dev/null 2>&1

chown -R "${VPSBOT_USER}:${VPSBOT_USER}" "$PROJECTS_DIR" 2>/dev/null || true

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Installation complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Launch main menu
cd "$INSTALL_DIR"
exec node src/cli-home.js
