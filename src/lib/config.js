import 'dotenv/config'
import { existsSync } from 'fs'
import { join } from 'path'

export const config = {
  // Paths
  projectsDir: process.env.PROJECTS_DIR ?? '/home/vps-code-bot/projects',
  get stateFile() {
    return join(this.projectsDir, 'projects.json')
  },
  get usageFile() {
    return join(process.cwd(), '.claude-usage.json')
  },

  // Network configuration
  // Can be either DOMAIN or IP_ADDRESS + PORT
  domain: process.env.DOMAIN,
  ipAddress: process.env.IP_ADDRESS,
  port: parseInt(process.env.PORT ?? '80'),

  // Generate project URL based on network config
  projectUrl: (name) => {
    if (process.env.DOMAIN) {
      return `https://${name}.${process.env.DOMAIN}`
    } else if (process.env.IP_ADDRESS) {
      const portStr = process.env.PORT && process.env.PORT !== '80' ? `:${process.env.PORT}` : ''
      return `http://${process.env.IP_ADDRESS}${portStr}`
    }
    return `http://localhost:3000`
  },

  // Telegram Bot (optional)
  botToken: process.env.BOT_TOKEN,
  chatId: process.env.CHAT_ID ? parseInt(process.env.CHAT_ID) : null,
  hasTelegramBot() {
    return !!(this.botToken && this.chatId)
  },

  // Claude CLI (required)
  claudeCli: process.env.CLAUDE_CLI,
  nodeBin: process.env.NODE_BIN ?? '/usr/bin/node',
  openrouterKey: process.env.OPENROUTER_API_KEY ?? null,

  // Code-Server
  codeServerPort: parseInt(process.env.CODE_SERVER_PORT ?? '8080'),
  codeServerPassword: process.env.CODE_SERVER_PASSWORD ?? 'changeme',

  // Caddy Admin API
  caddyAdminUrl: process.env.CADDY_ADMIN_URL ?? 'http://localhost:2019',

  // Docker socket
  dockerSocketPath: process.env.DOCKER_SOCKET ?? '/var/run/docker.sock',

  // Verify setup is complete (only Claude CLI is required)
  isSetupComplete() {
    return !!(this.claudeCli && (this.domain || this.ipAddress))
  },

  // Get network type
  getNetworkType() {
    if (this.domain) return 'domain'
    if (this.ipAddress) return 'ipport'
    return null
  },
}
