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

Everything managed from an interactive CLI menu or Telegram bot.

## CLI Dashboard

```
? Navigation
❯ View Projects
  Create New Project
  Server Status
  Docker Containers
  ─────────────────
  Configuration
  Exit
```

### Configuration Menu

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

## Telegram Bot

From **Configuration → Set Telegram Bot**:

1. Instructions to create bot via `@BotFather`
2. Enter bot token
3. **Auto-detect Chat ID** — send a message to your bot, select auto-detect
4. Start bot as systemd service (background)

Manage from **🟢 Telegram Bot** → Start / Stop / Restart

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
│   │   └── menu.js             # Telegram UI
│   └── lib/
│       ├── config.js           # Environment config
│       ├── docker-client.js
│       ├── store.js            # Project state (JSON)
│       └── caddy.js            # Caddy Admin API
├── install.sh                  # One-command installer
├── bootstrap.sh                # Remote installer
└── .env                        # Configuration (auto-generated)

/root/vps-code-bot-projects/        # Generated apps (owned by vpsbot)
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
