<p align="center">
  <img src="https://img.shields.io/badge/node-20-339933?logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white" />
  <img src="https://img.shields.io/badge/claude-AI-D97706?logo=anthropic&logoColor=white" />
  <img src="https://img.shields.io/badge/telegram-bot-26A5E4?logo=telegram&logoColor=white" />
  <img src="https://img.shields.io/badge/license-MIT-green" />
</p>

<h1 align="center">vps-bot</h1>
<p align="center"><strong>Describe it. Deploy it.</strong></p>
<p align="center">AI-powered VPS platform — describe an app, get it running with Docker + SSL in minutes.</p>

---

## How It Works

```
  You: "A real-time chat app with rooms"
   │
   ▼
  Claude Code → generates full project
   │
   ▼
  Docker → builds & deploys container
   │
   ▼
  Caddy → https://chat.yourdomain.com ✓
```

Manage everything from an **interactive CLI** or **Telegram bot** — same features, two interfaces.

## Quick Start

```bash
curl -sL https://raw.githubusercontent.com/maksymhs/vps-bot/main/install.sh | bash -s -- --clone
```

Or manually:

```bash
git clone https://github.com/maksymhs/vps-bot.git && cd vps-bot && bash install.sh
```

The installer handles everything: Node.js, Docker, Caddy, Claude Code, code-server, user setup, systemd services.

## Features

| | CLI | Telegram |
|---|:---:|:---:|
| **Create project** (AI-generated from description) | ✓ | ✓ |
| **Rebuild** (patch or full regeneration) | ✓ | ✓ |
| **Logs, start, stop, delete** | ✓ | ✓ |
| **Git** (status, commit, push, pull) | ✓ | ✓ |
| **Code-Server** (VS Code in browser) | ✓ | ✓ |
| **Server status** (CPU, RAM, disk) | ✓ | ✓ |
| **Configuration** (domain, Telegram, passwords) | ✓ | — |

## CLI

```
                       __          __
  _   ______  _____   / /_  ____  / /_
  | | / / __ \/ ___/  / __ \/ __ \/ __/
  | |/ / /_/ (__  )  / /_/ / /_/ / /_
  |___/ .___/____/  /_.___/\____/\__/
     /_/          by maksymhs

  Describe it. Deploy it.  ·  v1.0.0

? Navigation
❯ View Projects
  Create New Project
  Server Status
  Docker Containers
  Code-Server (IDE)
  Claude Usage
  ─────────────────
  Configuration
  Exit
```

### Creating a project

```
? Project name: chat-app
? Describe what the app should do: A real-time chat with rooms and nicknames
? Select model: Sonnet (recommended)
? Create "chat-app" with Sonnet? → Create project

  Creating chat-app

  ⠹ Generando codigo...
  ⠼ Construyendo imagen...
  ⠧ Verificando...
  ✓ Listo → http://185.x.x.x:4000
```

### Rebuilding

```
? Rebuild mode:
  Patch — add changes to existing code
  Full — regenerate from scratch

? What changes do you want? Add dark mode and user avatars

  Rebuilding chat-app

  ⠹ Aplicando cambios...
  ✓ Listo → http://185.x.x.x:4000
```

## Telegram Bot

```
⚙️ chat-app
� Construyendo imagen... 1m 12s
```
```
✅ chat-app creado
� https://chat.yourdomain.com
[♻️ Rebuild] [📋 Logs]
[🔗 URL]    [⬅️ Lista]
```

### Commands

| Command | |
|---|---|
| `/new <name> <desc>` | Create project |
| `/rebuild <name>` | Rebuild |
| `/list` | List projects |
| `/status` | Server resources |
| `/logs <name>` | Container logs |
| `/start` `/stop` `/restart` `<name>` | Control container |
| `/delete <name>` | Delete project |

## Domain + SSL

From **Configuration → Set Custom Domain**:

1. Set DNS: `A  *.yourdomain.com → your-server-ip`
2. DNS is verified automatically before applying
3. Caddy Docker Proxy handles SSL via Let's Encrypt
4. Projects get `https://{app}.yourdomain.com`
5. Code-Server at `https://code.yourdomain.com`

No domain? Works with `http://ip:port` out of the box.

## Auto-sleep

Save resources by automatically stopping idle containers. From **Configuration → Auto-sleep**:

```
? Stop idle containers after:
  Disabled
  5 minutes
❯ 10 minutes
  30 minutes
  60 minutes
```

- Containers with no network traffic are stopped after the configured timeout
- Sleeping containers show 🌙 in the project list
- **Wake on request**: visiting a sleeping app shows a "waking up" page and auto-restarts the container
- Wake manually from CLI (`☀️ Wake`) or Telegram
- All sleep/wake events logged to `logs/system.log`

## Architecture

```
┌─────────┐     ┌──────────┐
│   CLI   │     │ Telegram │
└────┬────┘     └────┬─────┘
     └───────┬───────┘
             │
         vps-bot
             │
   ┌─────────┼──────────┐
   │         │          │
Claude    Docker     Caddy
 Code     Build    (SSL)
   │         │          │
   ▼         ▼          ▼
 Code → Container → https://
```

## Project Structure

```
vps-bot/
├── src/
│   ├── bot.js              # Telegram bot
│   ├── cli.js              # CLI dashboard
│   ├── cli-home.js         # Entry point
│   ├── setup.js            # Setup wizard
│   ├── commands/
│   │   ├── projects.js     # AI generation + Docker deploy
│   │   ├── docker.js       # Container management
│   │   ├── git.js          # Git operations
│   │   ├── menu.js         # Telegram UI menus
│   │   └── status.js       # Server stats
│   └── lib/
│       ├── config.js       # Environment config
│       ├── code-server.js  # IDE management
│       ├── docker-client.js
│       ├── store.js        # Project state (JSON)
│       ├── usage.js        # API usage tracking
│       ├── logger.js       # Centralized logging
│       ├── branding.js     # Branding + ASCII art
│       └── caddy.js        # Caddy admin API
├── logs/                   # All logs (system, install, per-project builds)
├── install.sh              # One-command installer
└── .env                    # Auto-generated config
```

## Tech Stack

| | |
|---|---|
| **AI** | Claude Code (Sonnet / Opus / Haiku) |
| **Runtime** | Node.js 20 |
| **Containers** | Docker + Compose |
| **Proxy** | Caddy (auto SSL) |
| **IDE** | code-server |
| **Bot** | Telegraf |
| **CLI** | Inquirer.js + chalk |

## Logs

All logs centralized in `logs/`:

| File | Content |
|---|---|
| `system.log` | General operations |
| `install.log` | Full install process |
| `build-{name}.log` | Per-project: prompt, Claude output, Docker build, health checks |

View from CLI: **Configuration → View System Logs**

## Troubleshooting

```bash
# Services
systemctl status code-server
systemctl status vps-bot-telegram
docker ps

# Claude Code (runs as vpsbot user)
su - vpsbot -c 'claude --version'
su - vpsbot -c 'claude auth status'

# Build logs
cat logs/build-myapp.log

# Reconfigure
npm run setup
```

## License

MIT © 2025 [Maksym](https://github.com/maksymhs)

---

<p align="center"><strong>vps-bot</strong> — Describe it. Deploy it.</p>
