# VPS-CODE-BOT

Intelligent VPS management platform — describe an app, get it running with Docker + SSL in minutes.

## Quick Start

```bash
git clone https://<TOKEN>@github.com/maksymhs/vps-bot.git && cd vps-bot && bash install.sh
```

The installer automatically:
- Installs Node.js, Docker, Caddy, Claude Code CLI, code-server (all as root)
- Creates a `vpsbot` user (non-root, required by Claude Code)
- Runs setup wizard (only asks for code-server password)
- Auto-detects server IP
- Creates systemd services (persist after SSH close)
- Launches the CLI dashboard

## What It Does

1. **Describe** what app you want
2. **Claude Code** generates the full project (Express + Docker)
3. **Docker** builds and deploys as an isolated container
4. **Caddy** exposes it with SSL on `{app}.yourdomain.com`

Everything managed from an interactive CLI menu or Telegram bot — both interfaces offer the same capabilities.

## Feature Comparison

Both the CLI and Telegram bot share the same core features. The only difference is that **Configuration** is CLI-only (server-side settings).

| Feature | CLI | Telegram | Description |
|---------|:---:|:--------:|-------------|
| **View Projects** | ✅ | ✅ | List all deployed projects |
| **Create New Project** | ✅ | ✅ | AI-generated app from description |
| **Server Status** | ✅ | ✅ | CPU, RAM, disk usage |
| **Docker Containers** | ✅ | ✅ | List all containers with status |
| **Code-Server (IDE)** | ✅ | ✅ | Open VS Code in browser |
| **Claude Usage** | ✅ | ✅ | API call stats and limits |
| **Configuration** | ✅ | — | Domain, Telegram, Claude, password |

### Per-Project Actions

| Action | CLI | Telegram | Description |
|--------|:---:|:--------:|-------------|
| **View Logs** | ✅ | ✅ | Container stdout/stderr |
| **Start / Stop** | ✅ | ✅ | Toggle container |
| **Rebuild** | ✅ | ✅ | Patch or full rebuild with AI |
| **Code-Server** | ✅ | ✅ | Open project folder in IDE |
| **Git** | ✅ | ✅ | Status, push, pull, commit, init |
| **Copy URL** | ✅ | ✅ | Project URL |
| **Delete** | ✅ | ✅ | Remove container, image, and files |

## CLI Dashboard

```
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

### Project Menu (CLI)

```
? Project: my-app
❯ View Logs
  Stop
  Rebuild
  Code-Server (IDE)
  Git
  Copy URL
  ─────────────────
  Delete Project
  Back
```

### Git Submenu (CLI)

```
? Git: my-app
❯ Status
  Push
  Pull
  Commit
  Init Repository
  ─────────────────
  Back
```

### Configuration Menu (CLI only)

All settings configurable from the CLI — no need to edit files:

```
Current Configuration:

  Server IP:   185.x.x.x
  Domain:      maksym.site (SSL)
  Code-Server: https://code.maksym.site
  Claude Code: logged in
  Telegram:    running

? Configure:
  Configure Claude Code      ← install + login
  Set Custom Domain          ← auto SSL with Caddy
  Set Telegram Bot           ← auto-detect Chat ID
  🟢 Telegram Bot (running)  ← start/stop/restart
  Change Code-Server Password
  View System Logs
```

### Create New Project

```
? Project name: my-app
? Describe what the app should do: A real-time chat application with rooms
? Select model:
❯ Sonnet (recommended)
  Opus (more powerful)
  Haiku (fastest)
? Create "my-app" with Sonnet?
❯ → Create project
  ← Back
```

Before creating, the CLI checks:
- Is Claude Code installed? → offers to install
- Is Claude Code logged in? → launches `claude login` for OAuth

## Telegram Bot

### Main Menu

```
👾 VPS Bot

📊 Estado    📦 Containers
🚀 Mis proyectos
➕ Nuevo proyecto
💻 Code-Server    ⚡ Claude Usage
```

### Project Menu (Telegram)

```
📦 my-app  🟢

♻️ Rebuild    📋 Logs
💻 Code-Server    🔗 Copiar URL
⚙️ Git    🗑️ Eliminar
▶️ Start / 🛑 Stop    ⬅️ Lista
```

### Git Menu (Telegram)

```
🔧 Git - my-app

📤 Push    📥 Pull
📊 Status
⚙️ Inicializar Repo
💬 Commit Personalizado
⬅️ Volver
```

### Text Commands

| Command | Description |
|---------|-------------|
| `/start`, `/menu` | Main menu |
| `/new <name> <description>` | Create project |
| `/rebuild <name>` | Rebuild project |
| `/list` | List projects |
| `/status` | Server status |
| `/ps` | Docker containers |
| `/logs <name>` | Container logs |
| `/start <name>` | Start container |
| `/stop <name>` | Stop container |
| `/restart <name>` | Restart container |
| `/url <name>` | Get project URL |
| `/delete <name>` | Delete project |

### Setup (from CLI)

From **Configuration → Set Telegram Bot**:

1. Instructions to create bot via `@BotFather`
2. Enter bot token
3. **Auto-detect Chat ID** — send a message to your bot, select auto-detect
4. Start bot as systemd service (background)

Manage from **🟢 Telegram Bot** → Start / Stop / Restart

## Domain + SSL Setup

From **Configuration → Set Custom Domain**:

1. Shows DNS instructions:
   ```
   Add these DNS records pointing to 185.x.x.x:
     A  maksym.site      → 185.x.x.x
     A  *.maksym.site    → 185.x.x.x
   ```
2. Stops system Caddy, frees ports 80/443
3. Pulls and launches `caddy-docker-proxy`
4. Routes `code.maksym.site` → code-server
5. Routes `{app}.maksym.site` → project containers
6. SSL certificates auto-managed by Let's Encrypt

Leave domain empty to switch back to IP mode.

## Architecture

```
┌──────────┐     ┌──────────┐
│ CLI Menu │     │ Telegram │
└────┬─────┘     └────┬─────┘
     │                │
     └───────┬────────┘
             │
      VPS-CODE-BOT (vpsbot user)
             │
   ┌─────────┼──────────┐
   │         │          │
Claude    Docker     Caddy
 Code     Build    (auto SSL)
   │         │          │
   v         v          v
 Source → Container → https://{app}.domain
```

## Services & Persistence

Everything runs as systemd services (root for Docker access, `vpsbot` only for Claude Code):

| Service | Description | Auto-start |
|---------|-------------|------------|
| `code-server.service` | Code-Server IDE | Yes |
| `vps-bot-telegram.service` | Telegram bot | From CLI menu |
| `caddy-proxy` (Docker) | Reverse proxy + SSL | Yes (restart policy) |

**Close SSH → everything keeps running. Reboot → services auto-start.**

## After Installation

```bash
# Launch CLI dashboard (as root)
cd /root/vps-bot && npm start

# Or from anywhere
npm start --prefix /root/vps-bot
```

## Project Structure

```
/root/vps-bot/                      # Platform code (runs as root)
├── src/
│   ├── bot.js                  # Telegram bot
│   ├── cli.js                  # CLI dashboard + config
│   ├── cli-home.js             # Entry point
│   ├── setup.js                # Setup wizard
│   ├── commands/
│   │   ├── projects.js         # Claude Code (→ vpsbot) + Docker deploy
│   │   ├── docker.js           # Container management
│   │   ├── git.js              # Git operations
│   │   ├── menu.js             # Telegram UI
│   │   └── status.js           # Server status
│   └── lib/
│       ├── config.js           # Environment config
│       ├── code-server.js      # Code-Server management
│       ├── docker-client.js    # Docker client
│       ├── store.js            # Project state (JSON)
│       ├── usage.js            # Claude usage tracking
│       ├── logger.js           # Logging
│       ├── branding.js         # ASCII banner
│       └── caddy.js            # Caddy Admin API
├── install.sh                  # One-command installer
├── bootstrap.sh                # Remote installer
└── .env                        # Configuration (auto-generated)

/home/vpsbot/projects/              # Generated apps (owned by vpsbot)
├── my-app/
│   ├── src/index.js
│   ├── Dockerfile
│   └── docker-compose.yml
└── another-app/
```

## Tech Stack

- **Runtime** — Node.js 20
- **AI** — Claude Code CLI (Sonnet / Opus / Haiku)
- **Containers** — Docker + Docker Compose
- **Reverse Proxy** — Caddy (caddy-docker-proxy)
- **IDE** — code-server (VS Code in browser)
- **Bot** — Telegraf (Telegram)
- **CLI** — Inquirer.js
- **Services** — systemd

## Security

- Main process runs as root (Docker needs it)
- Claude Code runs as non-root `vpsbot` user (Claude Code requirement)
- Bot token + passwords in `.env` (gitignored)
- Single-user Telegram access via `CHAT_ID`
- Apps isolated in Docker containers
- HTTPS with auto-renewed Let's Encrypt certificates

## Troubleshooting

```bash
# Check services
systemctl status code-server
systemctl status vps-bot-telegram
docker ps                        # Check caddy-proxy + app containers
docker logs caddy-proxy          # SSL/proxy issues

# Reconfigure
cd /root/vps-bot && npm run setup

# Claude Code issues (runs as vpsbot user)
su - vpsbot -c 'claude --version'
su - vpsbot -c 'claude auth status'
su - vpsbot -c 'claude login'

# Logs
journalctl -u code-server -f
journalctl -u vps-bot-telegram -f
```

## License

MIT

---

**VPS-CODE-BOT** — Describe → Generate → Deploy → Done.
