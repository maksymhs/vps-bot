#!/usr/bin/env node

import 'dotenv/config'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import inquirer from 'inquirer'
import chalk from 'chalk'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(__dirname)
const envFile = join(projectRoot, '.env')

// Helper functions
function isValidBotToken(token) {
  return /^\d+:[A-Za-z0-9_-]+$/.test(token)
}

function isValidChatId(id) {
  return /^-?\d+$/.test(id)
}

function isValidDomain(domain) {
  return /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(domain)
}

function isValidIp(ip) {
  const parts = ip.split('.')
  return parts.length === 4 && parts.every(p => {
    const num = parseInt(p)
    return num >= 0 && num <= 255
  })
}

function isValidPort(port) {
  const num = parseInt(port)
  return num > 0 && num < 65536
}

function detectIpAddress() {
  try {
    // Try to get the public/primary IP
    const result = execSync("hostname -I 2>/dev/null | awk '{print $1}' || curl -sf ifconfig.me 2>/dev/null || echo ''", { stdio: ['pipe', 'pipe', 'pipe'] })
    const ip = result.toString().trim()
    if (ip && isValidIp(ip)) return ip
  } catch {}
  return null
}

function detectClaudeCode(providedPath) {
  if (providedPath && existsSync(providedPath)) {
    return providedPath
  }

  // Try to find 'claude' command (npm global install)
  try {
    const which = execSync('which claude 2>/dev/null', { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = which.toString().trim()
    if (p) return p
  } catch {}

  // Check various common locations
  const paths = [
    process.env.CLAUDE_CLI,
    '/usr/local/bin/claude',
    '/usr/local/bin/claude-code',
  ]

  for (const path of paths) {
    if (path && existsSync(path)) return path
  }

  return null
}

async function runSetupWizard() {
  console.log(chalk.cyan(`\n┌─────────────────────────────────────────────────────┐`))
  console.log(chalk.cyan(`│  VPS-CODE-BOT Setup                                  │`))
  console.log(chalk.cyan(`│  Configure your intelligent VPS platform             │`))
  console.log(chalk.cyan(`└─────────────────────────────────────────────────────┘\n`))

  // Check if already configured
  if (existsSync(envFile) && process.env.BOT_TOKEN && process.env.CHAT_ID) {
    const { reconfigure } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'reconfigure',
        message: 'System already configured. Reconfigure?',
        default: false,
      },
    ])

    if (!reconfigure) {
      console.log(chalk.gray('\nSetup skipped.\n'))
      return
    }
  }

  // Detect Claude Code (installed by install.sh or already present)
  const cliArg = process.argv.includes('--claude-cli')
    ? process.argv[process.argv.indexOf('--claude-cli') + 1]
    : null
  let cliPath = (cliArg && cliArg !== '' && cliArg !== '--os') ? cliArg : detectClaudeCode()

  if (cliPath) {
    console.log(chalk.green(`✓ Claude Code CLI: ${cliPath}\n`))
  } else {
    cliPath = 'claude'
    console.log(chalk.yellow('⚠ Claude Code CLI not found — install later: npm install -g @anthropic-ai/claude-code\n'))
  }

  // Configuration wizard
  console.log(chalk.cyan('━━━ Network Configuration ━━━\n'))

  const networkType = await inquirer.prompt([
    {
      type: 'list',
      name: 'type',
      message: 'How will you access your applications?',
      choices: [
        {
          name: 'Custom domain (example.com)',
          value: 'domain',
          description: 'Use a domain name with SSL',
        },
        {
          name: 'IP address + port (192.168.1.1:3000)',
          value: 'ipport',
          description: 'Use IP and port number',
        },
      ],
    },
  ])

  let domain = ''
  let ipAddress = ''
  let port = ''

  if (networkType.type === 'domain') {
    const domainConfig = await inquirer.prompt([
      {
        type: 'input',
        name: 'domain',
        message: 'Enter your domain:',
        default: 'example.com',
        validate: (input) => {
          if (!input) return 'Domain is required'
          if (!isValidDomain(input)) return 'Invalid domain format'
          return true
        },
      },
    ])
    domain = domainConfig.domain
  } else {
    // Auto-detect VPS IP
    const detectedIp = detectIpAddress()
    if (detectedIp) {
      console.log(chalk.green(`✓ Detected IP: ${detectedIp}\n`))
      ipAddress = detectedIp
    } else {
      const ipInput = await inquirer.prompt([{
        type: 'input',
        name: 'ip',
        message: 'Could not detect IP. Enter server IP:',
        validate: (input) => input && isValidIp(input) ? true : 'Invalid IP',
      }])
      ipAddress = ipInput.ip
    }

    port = '80'
  }

  // Code-Server configuration
  console.log(chalk.cyan('\n━━━ Code-Server Configuration ━━━\n'))
  if (networkType.type === 'domain') {
    console.log(chalk.gray(`Code-Server: https://code.${domain} (SSL auto)\n`))
  } else {
    console.log(chalk.gray(`Code-Server: http://${ipAddress}:8080\n`))
  }

  const codeServerConfig = await inquirer.prompt([{
    type: 'input',
    name: 'password',
    message: 'Code-Server password:',
    validate: (input) => {
      if (!input) return 'Password is required'
      if (input.length < 4) return 'Min 4 characters'
      return true
    },
  }])
  const codeServerPort = '8080'

  // Telegram (optional)
  console.log(chalk.cyan('\n━━━ Telegram Configuration (Optional) ━━━\n'))
  console.log(chalk.gray('Leave blank to skip Telegram bot integration\n'))

  const telegramConfig = await inquirer.prompt([
    {
      type: 'password',
      name: 'botToken',
      message: 'Telegram Bot Token:',
      default: '',
    },
  ])

  let chatId = ''
  if (telegramConfig.botToken) {
    if (!isValidBotToken(telegramConfig.botToken)) {
      console.log(chalk.red('\nInvalid token format. Skipping Telegram.\n'))
    } else {
      const chatConfig = await inquirer.prompt([
        {
          type: 'input',
          name: 'chatId',
          message: 'Your Telegram Chat ID:',
          validate: (input) => {
            if (!input) return 'Chat ID is required'
            if (!isValidChatId(input)) return 'Must be a number'
            return true
          },
        },
      ])
      chatId = chatConfig.chatId
    }
  }

  // Projects directory (always default)
  const storageConfig = { projectsDir: `${process.env.HOME}/vps-code-bot-projects` }
  try {
    mkdirSync(storageConfig.projectsDir, { recursive: true })
    console.log(chalk.green(`✓ Projects dir: ${storageConfig.projectsDir}\n`))
  } catch (err) {
    console.error(chalk.red(`✗ Error creating directory: ${err.message}`))
    process.exit(1)
  }

  // Generate .env file
  const envContent = `# Generated by VPS-CODE-BOT Setup

# Network Configuration
${networkType.type === 'domain'
    ? `DOMAIN=${domain}\nCADDY_ADMIN_URL=http://localhost:2019`
    : `IP_ADDRESS=${ipAddress}\nPORT=${port}\nCADDY_ADMIN_URL=http://localhost:2019`
  }

# Storage
PROJECTS_DIR=${storageConfig.projectsDir}

# Claude Code
CLAUDE_CLI=${cliPath}
NODE_BIN=${process.env.NODE_BIN || '/usr/bin/node'}

# Code-Server Configuration
CODE_SERVER_PASSWORD=${codeServerConfig.password}
CODE_SERVER_PORT=${codeServerPort}

# Telegram (optional)
${chatId ? `BOT_TOKEN=${telegramConfig.botToken}\nCHAT_ID=${chatId}` : `# BOT_TOKEN=\n# CHAT_ID=`}

# OpenRouter (optional, for alternative models)
# OPENROUTER_API_KEY=

# Docker
DOCKER_SOCKET=/var/run/docker.sock
`

  writeFileSync(envFile, envContent)
  console.log(chalk.green('✓ Configuration saved to .env\n'))

  // Summary
  console.log(chalk.cyan('━━━ Configuration Summary ━━━\n'))
  if (networkType.type === 'domain') {
    console.log(`  Network:     Domain (${domain})`)
  } else {
    console.log(`  Network:     IP + Port (${ipAddress}:${port})`)
  }
  console.log(`  Projects:    ${storageConfig.projectsDir}`)
  console.log(`  Claude:      ${cliPath}`)
  if (networkType.type === 'domain') {
    console.log(`  Code-Server: https://code.${domain} (SSL auto)`)
  } else {
    console.log(`  Code-Server: http://${ipAddress}:${codeServerPort}`)
  }
  console.log(`  Telegram:    ${chatId ? 'configured' : 'disabled'}\n`)

  console.log(chalk.green('Setup complete!\n'))
  console.log('Next steps:')
  console.log('  npm start      Launch main menu')
  console.log('  npm run bot    Start Telegram bot')
  console.log('  npm run cli    Web dashboard\n')
}

// Run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSetupWizard().catch(err => {
    console.error(chalk.red('Error:'), err.message)
    process.exit(1)
  })
}

export { runSetupWizard }
