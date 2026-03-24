#!/usr/bin/env node

import 'dotenv/config'
import { config } from './lib/config.js'
import chalk from 'chalk'
import inquirer from 'inquirer'
import { execSync } from 'child_process'

const PROJECT_NAME = 'VPS-CODE-BOT'
const VERSION = '1.0.0'

function printBanner() {
  const banner = `
  ${chalk.cyan('┌─────────────────────────────────────────────────────┐')}
  ${chalk.cyan('│')}                                                     ${chalk.cyan('│')}
  ${chalk.cyan('│')}              VPS-CODE-BOT                           ${chalk.cyan('│')}
  ${chalk.cyan('│')}         VPS Management Platform v1.0                ${chalk.cyan('│')}
  ${chalk.cyan('│')}                                                     ${chalk.cyan('│')}
  ${chalk.cyan('└─────────────────────────────────────────────────────┘')}
  `
  console.log(banner)
}

function printStatus() {
  const status = {
    'Domain': config.domain,
    'Projects Directory': config.projectsDir,
    'Telegram Bot': process.env.BOT_TOKEN ? chalk.green('configured') : chalk.yellow('not configured'),
    'Claude Code': process.env.CLAUDE_CLI ? chalk.green('ready') : chalk.red('not found'),
  }

  console.log(chalk.cyan('\n━━━ System Status ━━━'))
  Object.entries(status).forEach(([key, value]) => {
    console.log(`  ${chalk.gray(key + ':')} ${value}`)
  })
  console.log()
}

async function showWelcomeMenu() {
  if (!config.isSetupComplete()) {
    console.log(chalk.yellow('\nSetup required.\n'))
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'System not configured. What would you like to do?',
        choices: [
          { name: 'Run initial setup', value: 'setup' },
          { name: 'Exit', value: 'exit' },
        ],
      },
    ])

    if (action === 'setup') {
      try {
        console.log('\n')
        execSync('node src/setup.js', { stdio: 'inherit' })
      } catch (err) {
        console.error(chalk.red('\nSetup cancelled.\n'))
      }
    }
    process.exit(0)
  }

  printStatus()

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        new inquirer.Separator(chalk.gray('─────────────────')),
        { name: 'Web Dashboard (CLI)', value: 'cli' },
        { name: 'Start Telegram Bot', value: 'bot' },
        { name: 'Reconfigure System', value: 'setup' },
        new inquirer.Separator(chalk.gray('─────────────────')),
        { name: 'View Help', value: 'help' },
        { name: 'Exit', value: 'exit' },
      ],
    },
  ])

  switch (action) {
    case 'cli':
      console.log(chalk.cyan('\nStarting CLI dashboard...\n'))
      execSync('node src/cli.js', { stdio: 'inherit' })
      break

    case 'bot':
      console.log(chalk.cyan('\nStarting Telegram bot...\n'))
      execSync('node src/bot.js', { stdio: 'inherit' })
      break

    case 'setup':
      console.log(chalk.cyan('\nReconfiguring system...\n'))
      execSync('node src/setup.js', { stdio: 'inherit' })
      break

    case 'help':
      showHelp()
      await showWelcomeMenu()
      break

    case 'exit':
      console.log(chalk.gray('\nGoodbye.\n'))
      process.exit(0)
  }
}

function showHelp() {
  const help = `
${chalk.bold('VPS-CODE-BOT - Intelligent VPS Management')}

${chalk.cyan('Description:')}
  Automated VPS management platform with intelligent application
  generation using Claude Code and Docker deployment.

${chalk.cyan('Features:')}
  - Auto-generate applications with Claude Code
  - Manage Docker containers seamlessly
  - Automatic reverse proxy with Caddy
  - Telegram remote control
  - Interactive CLI dashboard
  - Real-time logs and monitoring

${chalk.cyan('Quick Commands:')}
  ${chalk.gray('npm start')}              Launch main menu
  ${chalk.gray('npm run bot')}            Start Telegram bot
  ${chalk.gray('npm run cli')}            Web dashboard
  ${chalk.gray('npm run setup')}          Initial setup
  ${chalk.gray('npm run dev')}            Watch mode

${chalk.cyan('Documentation:')}
  ${chalk.gray('README.md')}              Complete guide
  ${chalk.gray('TESTING.md')}             Docker testing

${chalk.cyan('Repository:')}
  ${chalk.gray('github.com/maksymhs/vps-bot')}
`
  console.log(help)
}

async function main() {
  console.clear()
  printBanner()
  console.log(chalk.gray(`v${VERSION}\n`))

  try {
    await showWelcomeMenu()
  } catch (err) {
    if (err.isTtyError) {
      console.error(chalk.red('❌ Error: Interactive mode not available'))
      process.exit(1)
    } else {
      console.error(chalk.red('❌ Error:'), err.message)
      process.exit(1)
    }
  }
}

main()
