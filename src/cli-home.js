#!/usr/bin/env node

import 'dotenv/config'
import { config } from './lib/config.js'
import chalk from 'chalk'
import { execSync } from 'child_process'

console.clear()
console.log(chalk.cyan(`
┌─────────────────────────────────────────┐
│         VPS-CODE-BOT  v1.0              │
└─────────────────────────────────────────┘
`))

// Show status
const net = config.domain
  ? chalk.green(config.domain)
  : chalk.green(`${config.ipAddress}:${config.port}`)
const claude = config.claudeCli ? chalk.green('ready') : chalk.yellow('not set')
const telegram = config.botToken ? chalk.green('on') : chalk.gray('off')

console.log(`  Network:  ${net}`)
console.log(`  Claude:   ${claude}`)
console.log(`  Telegram: ${telegram}`)
console.log(`  Projects: ${chalk.gray(config.projectsDir)}`)
console.log()

// If not configured, run setup
if (!config.isSetupComplete()) {
  console.log(chalk.yellow('Not configured. Running setup...\n'))
  try {
    execSync('node src/setup.js', { stdio: 'inherit' })
  } catch {}
  process.exit(0)
}

// Go straight to CLI dashboard
try {
  execSync('node src/cli.js', { stdio: 'inherit' })
} catch {}
process.exit(0)
