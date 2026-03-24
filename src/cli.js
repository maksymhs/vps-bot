#!/usr/bin/env node

import 'dotenv/config'
import { config } from './lib/config.js'
import { getDocker } from './lib/docker-client.js'
import { store } from './lib/store.js'
import { getUsageText } from './lib/usage.js'
import { statusCommand } from './commands/status.js'
import { getBanner, PROJECT } from './lib/branding.js'
import inquirer from 'inquirer'
import si from 'systeminformation'
import chalk from 'chalk'

const ctx = {
  reply: (text) => {
    const plain = text
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .replace(/_/g, '')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    console.log(plain)
    return Promise.resolve({ message_id: 0 })
  },
  chat: { id: 'cli' },
  telegram: { editMessageText: async () => {} },
}

async function showMainMenu() {
  console.clear()
  console.log(chalk.cyan(getBanner()))
  console.log(chalk.gray(`v${PROJECT.version}\n`))

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Navigation',
      choices: [
        new inquirer.Separator(chalk.gray('─────────────────')),
        { name: 'View Projects', value: 'list' },
        { name: 'Create New Project', value: 'new' },
        { name: 'Server Status', value: 'status' },
        { name: 'Docker Containers', value: 'containers' },
        new inquirer.Separator(chalk.gray('─────────────────')),
        { name: 'Configuration', value: 'config' },
        { name: 'Exit', value: 'exit' },
      ],
    },
  ])

  switch (action) {
    case 'list':
      return showProjects()
    case 'new':
      return showNewProject()
    case 'status':
      return showStatus()
    case 'containers':
      return showContainers()
    case 'config':
      return showConfig()
    case 'exit':
      console.log(chalk.gray('\nGoodbye.\n'))
      process.exit(0)
  }
}

async function showProjects() {
  const projects = store.getAll()
  const names = Object.keys(projects)

  if (!names.length) {
    console.log(chalk.yellow('\nNo projects found.\n'))
    return showMainMenu()
  }

  const { name } = await inquirer.prompt([
    {
      type: 'list',
      name: 'name',
      message: 'Select a project:',
      choices: [...names, new inquirer.Separator(), 'Back'],
    },
  ])

  if (name === 'Back') return showMainMenu()

  return showProjectMenu(name)
}

async function showProjectMenu(name) {
  const project = store.get(name)
  if (!project) {
    console.log(chalk.red(`\nProject "${name}" not found.\n`))
    return showProjects()
  }

  try {
    const containers = await getDocker().listContainers({
      all: true,
      filters: JSON.stringify({ name: [`${name}-app`] }),
    })
    const status = containers[0]?.State ?? 'unknown'
    const statusStr = status === 'running' ? chalk.green('running') : chalk.red('stopped')

    console.log(chalk.cyan(`\n[${name}] Status: ${statusStr}\n`))

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: `Project: ${name}`,
        choices: [
          { name: 'View Logs', value: 'logs' },
          ...(status === 'running'
            ? [{ name: 'Stop', value: 'stop' }]
            : [{ name: 'Start', value: 'start' }]),
          { name: 'Rebuild', value: 'rebuild' },
          { name: 'Copy URL', value: 'url' },
          new inquirer.Separator(),
          { name: 'Back', value: 'back' },
        ],
      },
    ])

    if (action === 'back') return showProjects()
    if (action === 'url') {
      console.log(chalk.gray(`\n${project.url}\n`))
      return showProjectMenu(name)
    }

    // TODO: Implement logs, stop, start, rebuild
    console.log(chalk.yellow(`\n${action} not yet implemented in CLI.\n`))
    return showProjectMenu(name)
  } catch (err) {
    console.error(chalk.red(`\nError: ${err.message}\n`))
    return showProjects()
  }
}

async function showNewProject() {
  const { name, description } = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Project name:',
      validate: (input) => input ? true : 'Name is required',
    },
    {
      type: 'input',
      name: 'description',
      message: 'Description:',
      validate: (input) => input ? true : 'Description is required',
    },
  ])

  console.log(chalk.cyan(`\nCreating project: ${name}...`))
  console.log(chalk.gray('(Use Telegram bot or wait for CLI implementation)\n'))

  return showMainMenu()
}

async function showStatus() {
  try {
    const [cpu, mem, disk] = await Promise.all([si.currentLoad(), si.mem(), si.fsSize()])
    const gb = (b) => (b / 1024 ** 3).toFixed(1)
    const pct = (n) => Math.round(n)
    const d = disk.find((d) => d.mount === '/') || disk[0]

    console.log(chalk.cyan('\nServer Status:\n'))
    console.log(`  CPU Usage:   ${pct(cpu.currentLoad)}%`)
    console.log(`  Memory:      ${gb(mem.used)}GB / ${gb(mem.total)}GB (${pct((mem.used / mem.total) * 100)}%)`)
    console.log(`  Disk Space:  ${gb(d.used)}GB / ${gb(d.size)}GB (${pct(d.use)}%)\n`)
  } catch (err) {
    console.log(chalk.red(`\nError: ${err.message}\n`))
  }

  return showMainMenu()
}

async function showContainers() {
  try {
    const containers = await getDocker().listContainers({ all: true })

    if (!containers.length) {
      console.log(chalk.yellow('\nNo containers found.\n'))
      return showMainMenu()
    }

    console.log(chalk.cyan('\nDocker Containers:\n'))
    containers.forEach((c) => {
      const name = c.Names[0].replace('/', '')
      const statusStr = c.State === 'running' ? chalk.green('running') : chalk.red('stopped')
      console.log(`  ${name}`)
      console.log(`    Status: ${statusStr}`)
      console.log(`    Image:  ${c.Image}`)
      console.log('')
    })
  } catch (err) {
    console.log(chalk.red(`\nError: ${err.message}\n`))
  }

  return showMainMenu()
}

function showConfig() {
  console.log(chalk.cyan('\nSystem Configuration:\n'))
  console.log(`  Domain:            ${config.domain}`)
  console.log(`  Projects Dir:      ${config.projectsDir}`)
  console.log(`  Caddy Admin:       ${config.caddyAdminUrl}`)
  console.log(`  Claude CLI:        ${config.claudeCli}`)
  console.log('')

  return showMainMenu()
}

async function main() {
  if (!config.isSetupComplete()) {
    console.log(chalk.red('\nSystem not configured.\nRun: npm run setup\n'))
    process.exit(1)
  }

  while (true) {
    await showMainMenu()
  }
}

main().catch((err) => {
  console.error(chalk.red('Error:'), err.message)
  process.exit(1)
})
