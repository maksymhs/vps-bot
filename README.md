# VPS-CODE-BOT

Intelligent VPS management platform with automatic application generation powered by Claude Code.

## One-Command Installation

**From anywhere, execute:**

```bash
bash <(curl -sL https://raw.githubusercontent.com/maksymhs/vps-bot/main/bootstrap.sh)
```

Or manually:
```bash
git clone https://github.com/maksymhs/vps-bot.git
cd vps-bot
bash bootstrap.sh
```

**The installer will automatically:**
- Clone repository (if needed)
- Detect your OS (Linux/macOS)
- Install Node.js, Docker, Caddy (if missing)
- Validate Claude Code CLI installation
- Launch interactive setup wizard
- Configure network (domain or IP+port)
- Setup projects directory
- Optionally configure Telegram bot
- Start the system

## Overview

VPS-CODE-BOT is a professional-grade infrastructure automation platform that combines:
- **Claude Code** for intelligent code generation (required)
- **Docker** for application containerization
- **Caddy** for reverse proxy and SSL
- **Telegram** for remote control (optional)
- **Interactive CLI** for local management

Generate applications by describing requirements, deploy them automatically to Docker, and manage everything via web dashboard (Telegram optional).

## Features

- **Intelligent Code Generation** — Describe what you need, Claude Code generates complete applications
- **Automated Deployment** — Build and deploy as isolated Docker containers
- **Flexible Networking** — Use custom domain OR IP+port, you decide
- **Reverse Proxy** — Caddy automatically exposes applications with SSL (domain mode)
- **Remote Control** — Manage infrastructure via Telegram (optional)
- **Web Dashboard** — Interactive CLI for local management
- **Smart Rebuilds** — Apply patches or rebuild from scratch
- **System Monitoring** — Real-time logs, status, container management

## Installation

**Prerequisites:** Git, bash

**Install in one command:**
```bash
bash <(curl -sL https://raw.githubusercontent.com/maksymhs/vps-bot/main/install.sh)
```

Or manually:
```bash
git clone https://github.com/maksymhs/vps-bot.git
cd vps-bot
bash install.sh
```

## After Installation

```bash
npm start      # Launch main menu
npm run bot    # Start Telegram bot (if configured)
npm run cli    # Web dashboard
```

## Commands

```bash
npm start      # Main menu
npm run setup  # Reconfigure
npm run bot    # Telegram bot
npm run cli    # Web dashboard
npm run dev    # Development mode (watch)
```

## Requirements

**Automatically installed by `install.sh`:**
- Node.js 18+
- Docker
- Caddy

**Manual requirement:**
- **Claude Code CLI** (download from https://claude.com/download)

## Configuration

### Initial Setup
The `install.sh` script will guide you through:
1. **Choosing network mode:**
   - Domain (example.com) — Uses Caddy with automatic SSL
   - IP+Port (192.168.1.1:8080) — Direct IP access
2. **Claude Code path** — Auto-detected or provide manually
3. **Telegram (optional)** — Leave blank to skip
4. **Projects directory** — Where applications are stored

### Manual Configuration
Edit `.env` file:

```bash
# Network - Choose ONE:
DOMAIN=example.com              # For domain mode
# OR
IP_ADDRESS=192.168.1.100        # For IP mode
PORT=8080

# Required
CLAUDE_CLI=/path/to/claude-code/cli.js
PROJECTS_DIR=/home/user/vps-code-bot-projects

# Optional
BOT_TOKEN=your_telegram_token
CHAT_ID=your_chat_id
```

### Reconfigure Later
```bash
npm run setup
```

## Architecture

```
User Input
    |
    +--- Telegram Bot ──┐
    |                   |
    +--- Web Dashboard  |
                        |
                    VPS-CODE-BOT
                        |
        ┌───────────────┼───────────────┐
        |               |               |
    Claude Code    Docker Client    Config
        |               |
        v               v
    Generate        Containers
    Code
        |
        v
    Docker Registry
        |
        v
    Running Apps
```

## Workflow

1. **Describe** — Tell the system what application you need
2. **Generate** — Claude Code generates complete source code
3. **Build** — Docker builds container image
4. **Deploy** — Container starts and health checks pass
5. **Expose** — Caddy reverse proxy makes it accessible

## Project Structure

```
vps-code-bot/
├── src/
│   ├── bot.js              # Telegram bot entry point
│   ├── cli.js              # Web dashboard
│   ├── cli-home.js         # Main menu screen
│   ├── setup.js            # Configuration wizard
│   ├── commands/
│   │   ├── projects.js     # Project management
│   │   ├── docker.js       # Docker operations
│   │   ├── git.js          # Git operations
│   │   └── menu.js         # UI components
│   └── lib/
│       ├── config.js       # Configuration management
│       ├── docker-client.js# Docker singleton
│       ├── store.js        # Data persistence
│       ├── branding.js     # Project branding
│       └── caddy.js        # Caddy Admin API
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

## Technology Stack

- **Runtime** — Node.js 18+
- **Bot Framework** — Telegraf
- **Code Generation** — Claude Code CLI
- **Containerization** — Docker & Docker Compose
- **Reverse Proxy** — Caddy
- **CLI UI** — Inquirer.js
- **Data Storage** — JSON files

## Security

- Bot token stored in `.env` (never committed)
- Single-user access via Telegram CHAT_ID
- Docker socket access restricted to local
- Applications isolated in containers
- HTTPS via Caddy with automatic certificates

## Troubleshooting

### System not configured
```bash
npm run setup
```

### Bot won't start
Check that `.env` file exists with valid configuration:
```bash
cat .env
```

### Docker containers not building
Check Claude Code CLI is properly installed:
```bash
which claude-code
echo $CLAUDE_CLI   # Should match .env value
```

## Documentation

- `.env.example` — Configuration template
- `src/setup.js` — Configuration wizard
- `src/cli-home.js` — Main menu

## License

MIT

---

**VPS-CODE-BOT** — Intelligent VPS Management Platform
