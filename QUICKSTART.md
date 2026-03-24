# VPS-CODE-BOT Quick Start

## Installation (One Command)

Run this from anywhere:

```bash
bash <(curl -sL https://raw.githubusercontent.com/your-username/vps-code-bot/main/bootstrap.sh)
```

That's it. The script will:
1. Clone the repository
2. Detect your system
3. Install missing tools (Node.js, Docker, Caddy)
4. Validate Claude Code CLI
5. Launch interactive setup

## Setup (Interactive)

The setup wizard will ask you:

1. **Network Mode**
   - Domain: `example.com` → SSL, reverse proxy
   - IP+Port: `192.168.1.100:8080` → Direct access

2. **Claude Code Path**
   - Auto-detected or provide manually
   - Get from: https://claude.com/download

3. **Telegram Bot** (optional)
   - Leave blank to skip
   - Get token from: https://t.me/botfather

4. **Projects Directory**
   - Where your apps are stored

## After Setup

```bash
# Main menu
npm start

# Telegram bot
npm run bot

# Web dashboard
npm run cli

# Reconfigure anytime
npm run setup
```

## Troubleshooting

### "Claude Code not found"
Install Claude Code from https://claude.com/download first

### "Docker not accessible"
Make sure Docker is running:
```bash
docker ps
```

### "Port already in use"
Change PORT in setup or use domain mode with Caddy

### Reconfigure
```bash
npm run setup
```

## Next Steps

1. Create your first project via web dashboard
2. Check status with Telegram bot (if configured)
3. Access apps via domain or IP+port

For full documentation see: [README.md](README.md)
