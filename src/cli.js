#!/usr/bin/env node

import 'dotenv/config'
import { config } from './lib/config.js'
import { getDocker } from './lib/docker-client.js'
import { store } from './lib/store.js'
import { getUsageText } from './lib/usage.js'
import { statusCommand } from './commands/status.js'
import { getBanner, PROJECT } from './lib/branding.js'
import { buildingSet } from './lib/build-state.js'
import inquirer from 'inquirer'
import si from 'systeminformation'
import chalk from 'chalk'
import { execFile, execSync, spawn } from 'child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { log } from './lib/logger.js'
import { getCodeServerUrl, getCodeServerBaseUrl, ensureCodeServer } from './lib/code-server.js'
import { gitPush, gitPull, gitStatus, initGitRepo, gitCommit } from './commands/git.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envFile = join(dirname(__dirname), '.env')

// CLI context that mimics Telegram bot context for reusing deploy functions
const cliCtx = {
  reply: (text, opts) => {
    const plain = text
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/`{3}[\s\S]*?`{3}/g, (m) => m.replace(/`/g, ''))
      .replace(/`/g, '')
      .replace(/_/g, '')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    console.log(plain)
    return Promise.resolve({ message_id: 0 })
  },
  chat: { id: 'cli' },
  telegram: { editMessageText: async () => {} },
}

async function showMainMenu(clear = true) {
  if (clear) console.clear()
  console.log(chalk.cyan(getBanner()))
  console.log(chalk.gray(`v${PROJECT.version}\n`))

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Navigation',
      loop: false,
      choices: [
        { name: 'View Projects', value: 'list' },
        { name: 'Create New Project', value: 'new' },
        { name: 'Server Status', value: 'status' },
        { name: 'Docker Containers', value: 'containers' },
        { name: 'Code-Server (IDE)', value: 'codeserver' },
        { name: 'Claude Usage', value: 'usage' },
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
    case 'codeserver':
      return showCodeServer()
    case 'usage':
      return showClaudeUsage()
    case 'config':
      return showConfig()
    case 'exit':
      console.log(chalk.gray('\nGoodbye.\n'))
      process.exit(0)
  }
}

async function showSystemLogs() {
  const { readdirSync } = await import('fs')
  const logsDir = log.dir

  let logFiles = []
  try {
    logFiles = readdirSync(logsDir).filter(f => f.endsWith('.log')).sort()
  } catch {}

  if (!logFiles.length) {
    console.log(chalk.yellow('\nNo logs yet.\n'))
    await inquirer.prompt([{ type: 'list', name: 'back', message: '', loop: false, choices: ['← Back'] }])
    return showConfig()
  }

  const { file } = await inquirer.prompt([{
    type: 'list',
    name: 'file',
    message: 'Select log file:',
    loop: false,
    choices: [
      ...logFiles.map(f => ({ name: f, value: f })),
      new inquirer.Separator(),
      { name: 'Back', value: 'back' },
    ],
  }])

  if (file === 'back') return showConfig()

  const filePath = join(logsDir, file)
  if (existsSync(filePath)) {
    const content = readFileSync(filePath, 'utf8')
    const lines = content.trim().split('\n')
    const tail = lines.slice(-50).join('\n')
    console.log(chalk.cyan(`\n─── ${file} (last ${Math.min(lines.length, 50)} lines) ───\n`))
    console.log(tail)
    console.log()
  }

  await inquirer.prompt([{ type: 'list', name: 'back', message: '', loop: false, choices: ['← Back to logs'] }])
  return showSystemLogs()
}

async function showProjects() {
  const projects = store.getAll()
  const names = Object.keys(projects)

  if (!names.length) {
    console.log(chalk.yellow('\nNo projects yet. Use "Create New Project" to get started.\n'))
    await inquirer.prompt([{ type: 'list', name: 'back', message: '', loop: false, choices: ['← Back to menu'] }])
    return showMainMenu()
  }

  const { name } = await inquirer.prompt([
    {
      type: 'list',
      name: 'name',
      message: 'Select a project:',
      loop: false,
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
        loop: false,
        choices: [
          { name: 'View Logs', value: 'logs' },
          ...(status === 'running'
            ? [{ name: 'Stop', value: 'stop' }]
            : [{ name: 'Start', value: 'start' }]),
          { name: 'Rebuild', value: 'rebuild' },
          { name: 'Code-Server (IDE)', value: 'codeserver' },
          { name: 'Git', value: 'git' },
          { name: 'Copy URL', value: 'url' },
          new inquirer.Separator(),
          { name: 'Delete Project', value: 'delete' },
          { name: 'Back', value: 'back' },
        ],
      },
    ])

    if (action === 'back') return showProjects()
    if (action === 'url') {
      const url = project.url || (project.port ? `http://${config.ipAddress || 'localhost'}:${project.port}` : '(no URL)')
      console.log(chalk.gray(`\n${url}\n`))
      return showProjectMenu(name)
    }
    if (action === 'logs') {
      await showLogs(name)
      return showProjectMenu(name)
    }
    if (action === 'stop') {
      await stopContainer(name)
      return showProjectMenu(name)
    }
    if (action === 'start') {
      await startContainer(name)
      return showProjectMenu(name)
    }
    if (action === 'rebuild') {
      await rebuildProject(name)
      return showProjectMenu(name)
    }
    if (action === 'codeserver') {
      await openProjectCodeServer(name)
      return showProjectMenu(name)
    }
    if (action === 'git') {
      await showGitMenu(name)
      return showProjectMenu(name)
    }
    if (action === 'delete') {
      await deleteProject(name)
      return showProjects()
    }
  } catch (err) {
    log.error(`[cli] project action failed for ${name}`, err.message)
    console.error(chalk.red(`\nError: ${err.message}\n`))
    return showProjects()
  }
}

async function showLogs(name) {
  try {
    const containers = await getDocker().listContainers({
      all: true,
      filters: JSON.stringify({ name: [`${name}-app`] }),
    })
    if (!containers.length) {
      console.log(chalk.yellow(`\nNo container found for "${name}".\n`))
      return
    }
    const stream = await getDocker().getContainer(containers[0].Id).logs({ stdout: true, stderr: true, tail: 40 })
    const text = (Buffer.isBuffer(stream) ? stream.toString() : String(stream)).trim() || '(no logs)'
    console.log(chalk.cyan(`\nLogs for ${name}:\n`))
    console.log(text)
    console.log()
  } catch (err) {
    console.error(chalk.red(`\nError fetching logs: ${err.message}\n`))
  }
}

async function stopContainer(name) {
  try {
    const containers = await getDocker().listContainers({
      filters: JSON.stringify({ name: [`${name}-app`] }),
    })
    if (!containers.length) {
      console.log(chalk.yellow(`\nNo running container for "${name}".\n`))
      return
    }
    await getDocker().getContainer(containers[0].Id).stop()
    console.log(chalk.green(`\n${name} stopped.\n`))
  } catch (err) {
    console.error(chalk.red(`\nError stopping container: ${err.message}\n`))
  }
}

async function startContainer(name) {
  try {
    const containers = await getDocker().listContainers({
      all: true,
      filters: JSON.stringify({ name: [`${name}-app`] }),
    })
    if (!containers.length) {
      console.log(chalk.yellow(`\nNo container found for "${name}".\n`))
      return
    }
    await getDocker().getContainer(containers[0].Id).start()
    console.log(chalk.green(`\n${name} started.\n`))
  } catch (err) {
    console.error(chalk.red(`\nError starting container: ${err.message}\n`))
  }
}

async function rebuildProject(name) {
  const project = store.get(name)
  if (!project) {
    console.log(chalk.red(`\nProject "${name}" not found.\n`))
    return
  }

  const { mode } = await inquirer.prompt([{
    type: 'list',
    name: 'mode',
    message: 'Rebuild mode:',
    choices: [
      { name: 'Patch — add changes to existing code', value: 'patch' },
      { name: 'Full — regenerate from scratch', value: 'full' },
      { name: 'Cancel', value: 'cancel' },
    ],
  }])

  if (mode === 'cancel') return

  const { desc } = await inquirer.prompt([{
    type: 'input',
    name: 'desc',
    message: mode === 'patch' ? 'What changes do you want?' : 'New full description:',
    validate: (input) => input ? true : 'Description is required',
  }])

  const { model } = await inquirer.prompt([{
    type: 'list',
    name: 'model',
    message: 'Select model:',
    choices: [
      { name: 'Sonnet (recommended)', value: 'claude-sonnet-4-6' },
      { name: 'Opus (more powerful)', value: 'claude-opus-4-6' },
      { name: 'Haiku (fastest)', value: 'claude-haiku-4-5-20251001' },
    ],
  }])

  const description = mode === 'patch'
    ? `${project.description}\n\nCambios solicitados: ${desc}`
    : desc

  console.log(chalk.cyan(`\nRebuilding ${name}...\n`))

  try {
    const { deployRebuild } = await import('./commands/projects.js')
    const ok = await deployRebuild(cliCtx, name, description, model, mode)
    if (ok) {
      console.log(chalk.green(`\n✓ ${name} rebuilt successfully!\n`))
    } else {
      console.log(chalk.red(`\n✗ Rebuild failed.\n`))
    }
  } catch (err) {
    console.error(chalk.red(`\nRebuild failed: ${err.message}\n`))
  }

  await inquirer.prompt([{ type: 'list', name: 'back', message: '', loop: false, choices: ['← Continue'] }])
}

async function showNewProject() {
  // Step 1: Check Claude Code is installed
  let claudeInstalled = false
  try {
    execSync("su - vpsbot -c 'claude --version'", { stdio: 'ignore' })
    claudeInstalled = true
  } catch {}

  if (!claudeInstalled) {
    console.log(chalk.red('\n⚠ Claude Code CLI not installed.\n'))
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'Claude Code is required to create projects:',
      loop: false,
      choices: [
        { name: 'Install & configure Claude Code', value: 'install' },
        { name: 'Back to menu', value: 'back' },
      ],
    }])
    if (action === 'install') {
      console.log(chalk.yellow('\nInstalling Claude Code CLI...\n'))
      try {
        execSync('npm install -g @anthropic-ai/claude-code', { stdio: 'inherit' })
        try {
          const cliPath = execSync('which claude', { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
          updateEnvVar('CLAUDE_CLI', cliPath)
        } catch {}
        claudeInstalled = true
      } catch {
        console.log(chalk.red('\n✗ Installation failed.\n'))
        return showMainMenu()
      }
    } else {
      return showMainMenu()
    }
  }

  // Step 2: Check Claude Code is logged in
  let claudeLoggedIn = false
  try {
    execSync("su - vpsbot -c 'claude auth status'", { stdio: 'ignore' })
    claudeLoggedIn = true
  } catch {}

  if (!claudeLoggedIn) {
    console.log(chalk.yellow('\n⚠ Claude Code not logged in. You need to authenticate first.\n'))
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'Login to Claude:',
      loop: false,
      choices: [
        { name: 'Login now (opens auth URL)', value: 'login' },
        { name: 'Back to menu', value: 'back' },
      ],
    }])
    if (action === 'login') {
      try {
        execSync("su - vpsbot -c 'claude login'", { stdio: 'inherit' })
        // Verify login worked
        execSync("su - vpsbot -c 'claude auth status'", { stdio: 'ignore' })
        console.log(chalk.green('\n✓ Claude authenticated!\n'))
      } catch {
        console.log(chalk.red('\n✗ Login failed or cancelled. Cannot create project without authentication.\n'))
        return showMainMenu()
      }
    } else {
      return showMainMenu()
    }
  }

  const { name: rawName, description } = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Project name:',
      validate: (input) => input ? true : 'Name is required',
    },
    {
      type: 'input',
      name: 'description',
      message: 'Describe what the app should do:',
      validate: (input) => input ? true : 'Description is required',
    },
  ])

  const name = rawName.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  if (store.get(name)) {
    console.log(chalk.yellow(`\nProject "${name}" already exists. Use rebuild instead.\n`))
    return showMainMenu()
  }

  const { model } = await inquirer.prompt([{
    type: 'list',
    name: 'model',
    message: 'Select model:',
    loop: false,
    choices: [
      { name: 'Sonnet (recommended)', value: 'claude-sonnet-4-6' },
      { name: 'Opus (more powerful)', value: 'claude-opus-4-6' },
      { name: 'Haiku (fastest)', value: 'claude-haiku-4-5-20251001' },
    ],
  }])

  const modelLabel = model.includes('opus') ? 'Opus' : model.includes('haiku') ? 'Haiku' : 'Sonnet'
  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: `Create "${name}" with ${modelLabel}?`,
    loop: false,
    choices: [
      { name: '→ Create project', value: 'go' },
      { name: '← Back', value: 'back' },
    ],
  }])

  if (action === 'back') return showMainMenu()

  console.log(chalk.cyan(`\nCreating project: ${name}...\n`))

  try {
    const { deployNew } = await import('./commands/projects.js')
    buildingSet.add(name)
    const ok = await deployNew(cliCtx, name, description, model)
    buildingSet.delete(name)
    if (ok) {
      const p = store.get(name)
      const url = p?.url || (p?.port ? `http://${config.ipAddress || 'localhost'}:${p.port}` : '')
      console.log(chalk.green(`\n✓ ${name} created successfully!`))
      if (url) console.log(chalk.gray(`URL: ${url}\n`))
    } else {
      console.log(chalk.red(`\n✗ Project creation failed.\n`))
    }
  } catch (err) {
    buildingSet.delete(name)
    console.error(chalk.red(`\nCreation failed: ${err.message}\n`))
  }

  await inquirer.prompt([{ type: 'list', name: 'back', message: '', loop: false, choices: ['← Back to menu'] }])
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

  await inquirer.prompt([{ type: 'list', name: 'back', message: '', loop: false, choices: ['← Back to menu'] }])
  return showMainMenu()
}

async function showContainers() {
  try {
    const containers = await getDocker().listContainers({ all: true })

    if (!containers.length) {
      console.log(chalk.yellow('\nNo Docker containers running.\n'))
    } else {
      console.log(chalk.cyan('\nDocker Containers:\n'))
      containers.forEach((c) => {
        const name = c.Names[0].replace('/', '')
        const statusStr = c.State === 'running' ? chalk.green('running') : chalk.red('stopped')
        console.log(`  ${name}`)
        console.log(`    Status: ${statusStr}`)
        console.log(`    Image:  ${c.Image}`)
        console.log('')
      })
    }
  } catch (err) {
    console.log(chalk.red(`\nError: ${err.message}\n`))
  }

  await inquirer.prompt([{ type: 'list', name: 'back', message: '', loop: false, choices: ['← Back to menu'] }])
  return showMainMenu()
}

async function showCodeServer() {
  try {
    console.log(chalk.cyan('\nStarting Code-Server...\n'))
    const result = await ensureCodeServer()
    if (!result.success) {
      console.log(chalk.red(`\n✗ ${result.message}\n`))
    } else {
      const url = getCodeServerBaseUrl()
      console.log(chalk.green(`✓ Code-Server running`))
      console.log(`  URL:      ${url}`)
      console.log(`  Password: ${config.codeServerPassword}\n`)
    }
  } catch (err) {
    console.log(chalk.red(`\nError: ${err.message}\n`))
  }

  await inquirer.prompt([{ type: 'list', name: 'back', message: '', loop: false, choices: ['← Back to menu'] }])
  return showMainMenu()
}

async function showClaudeUsage() {
  const text = getUsageText()
    .replace(/\*/g, '')
    .replace(/`/g, '')
    .replace(/_/g, '')
  console.log(`\n${text}\n`)

  await inquirer.prompt([{ type: 'list', name: 'back', message: '', loop: false, choices: ['← Back to menu'] }])
  return showMainMenu()
}

async function openProjectCodeServer(name) {
  try {
    const result = await ensureCodeServer()
    if (!result.success) {
      console.log(chalk.red(`\n✗ ${result.message}\n`))
      return
    }
    const url = getCodeServerUrl(name)
    console.log(chalk.green(`\n✓ Code-Server ready`))
    console.log(`  URL:      ${url}`)
    console.log(`  Password: ${config.codeServerPassword}\n`)
  } catch (err) {
    console.log(chalk.red(`\nError: ${err.message}\n`))
  }
}

async function showGitMenu(name) {
  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: `Git: ${name}`,
    loop: false,
    choices: [
      { name: 'Status', value: 'status' },
      { name: 'Push', value: 'push' },
      { name: 'Pull', value: 'pull' },
      { name: 'Commit', value: 'commit' },
      { name: 'Init Repository', value: 'init' },
      new inquirer.Separator(),
      { name: 'Back', value: 'back' },
    ],
  }])

  if (action === 'back') return

  if (action === 'status') {
    try {
      const result = await gitStatus(name)
      const plain = result.replace(/\*/g, '').replace(/`/g, '')
      console.log(`\n${plain}\n`)
    } catch (err) {
      if (err.message === 'INIT_REPO_NEEDED') {
        console.log(chalk.yellow('\n⚠ Not a Git repository. Use "Init Repository" first.\n'))
      } else {
        console.log(chalk.red(`\nError: ${err.message}\n`))
      }
    }
    return showGitMenu(name)
  }

  if (action === 'push') {
    try {
      console.log(chalk.cyan('\nPushing...\n'))
      const result = await gitPush(name)
      const plain = result.replace(/\*/g, '').replace(/`/g, '')
      console.log(`${plain}\n`)
    } catch (err) {
      if (err.message === 'INIT_REPO_NEEDED') {
        console.log(chalk.yellow('\n⚠ Not a Git repository. Use "Init Repository" first.\n'))
      } else {
        console.log(chalk.red(`\nError: ${err.message}\n`))
      }
    }
    return showGitMenu(name)
  }

  if (action === 'pull') {
    try {
      console.log(chalk.cyan('\nPulling...\n'))
      const result = await gitPull(name)
      const plain = result.replace(/\*/g, '').replace(/`/g, '')
      console.log(`${plain}\n`)
    } catch (err) {
      if (err.message === 'INIT_REPO_NEEDED') {
        console.log(chalk.yellow('\n⚠ Not a Git repository. Use "Init Repository" first.\n'))
      } else {
        console.log(chalk.red(`\nError: ${err.message}\n`))
      }
    }
    return showGitMenu(name)
  }

  if (action === 'commit') {
    const { message } = await inquirer.prompt([{
      type: 'input',
      name: 'message',
      message: 'Commit message:',
      validate: (input) => input ? true : 'Message is required',
    }])
    try {
      const result = await gitCommit(name, message)
      console.log(chalk.green(`\n${result}\n`))
    } catch (err) {
      console.log(chalk.red(`\nError: ${err.message}\n`))
    }
    return showGitMenu(name)
  }

  if (action === 'init') {
    const { gitUrl } = await inquirer.prompt([{
      type: 'input',
      name: 'gitUrl',
      message: 'Remote URL (leave empty for local only):',
    }])
    try {
      await initGitRepo(name, gitUrl || null)
      console.log(chalk.green(`\n✓ Git repository initialized${gitUrl ? ` (remote: ${gitUrl})` : ''}\n`))
    } catch (err) {
      console.log(chalk.red(`\nError: ${err.message}\n`))
    }
    return showGitMenu(name)
  }
}

async function deleteProject(name) {
  const { confirm } = await inquirer.prompt([{
    type: 'list',
    name: 'confirm',
    message: `Delete "${name}"? This removes the container, image, and all files.`,
    loop: false,
    choices: [
      { name: 'Yes, delete', value: true },
      { name: 'Cancel', value: false },
    ],
  }])

  if (!confirm) return

  try {
    const dir = join(config.projectsDir, name)

    // Stop and remove containers
    try {
      execSync(`docker compose down --rmi local`, { cwd: dir, stdio: 'ignore' })
    } catch {}

    // Remove directory
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
    }

    store.delete(name)
    console.log(chalk.green(`\n✓ "${name}" deleted.\n`))
  } catch (err) {
    console.log(chalk.red(`\nError deleting project: ${err.message}\n`))
  }
}

async function showConfig() {
  const net = config.domain
    ? chalk.green(`${config.domain} (SSL)`)
    : chalk.green(`${config.ipAddress}:${config.port}`)

  // Detect server IP
  let serverIp = config.ipAddress || ''
  try { serverIp = execSync("hostname -I 2>/dev/null | awk '{print $1}' || echo ''", { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim() } catch {}

  console.log(chalk.cyan('\nCurrent Configuration:\n'))
  console.log(`  Server IP:   ${serverIp || chalk.gray('unknown')}`)
  if (config.domain) {
    console.log(`  Domain:      ${chalk.green(config.domain)} (SSL)`)
  }
  const csUrl = config.domain ? `https://code.${config.domain}` : `http://${serverIp || config.ipAddress}:${config.codeServerPort}`
  console.log(`  Code-Server: ${csUrl} (pass: ${config.codeServerPassword})`)

  // Claude Code status
  let claudeStatus = chalk.gray('not installed')
  try {
    execSync('claude --version', { stdio: 'ignore' })
    try {
      execSync("su - vpsbot -c 'claude auth status'", { stdio: 'ignore' })
      claudeStatus = chalk.green('logged in')
    } catch {
      claudeStatus = chalk.yellow('installed (not logged in)')
    }
  } catch {}
  console.log(`  Claude Code: ${claudeStatus}`)
  // Telegram status
  let botRunning = false
  try { execSync('systemctl is-active --quiet vps-bot-telegram', { stdio: 'ignore' }); botRunning = true } catch {}
  const telegramStatus = !process.env.BOT_TOKEN
    ? chalk.gray('not set')
    : botRunning ? chalk.green('running') : chalk.yellow('configured (stopped)')
  console.log(`  Telegram:    ${telegramStatus}`)
  console.log(`  Projects:    ${config.projectsDir}`)
  console.log('')

  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: 'Configure:',
    loop: false,
    choices: [
      { name: 'Configure Claude Code', value: 'claude' },
      { name: 'Set Custom Domain', value: 'domain' },
      { name: 'Set Telegram Bot', value: 'telegram' },
      ...(process.env.BOT_TOKEN ? [{ name: `${botRunning ? '🟢' : '🔴'} Telegram Bot (${botRunning ? 'running' : 'stopped'})`, value: 'bot' }] : []),
      { name: 'Change Code-Server Password', value: 'password' },
      new inquirer.Separator(),
      { name: 'View System Logs', value: 'logs' },
      { name: 'Back', value: 'back' },
    ],
  }])

  if (action === 'back') return showMainMenu()
  if (action === 'claude') return configureClaude()
  if (action === 'domain') return configureDomain()
  if (action === 'telegram') return configureTelegram()
  if (action === 'bot') return manageTelegramBot()
  if (action === 'password') return configurePassword()
  if (action === 'logs') return showSystemLogs()
}

async function configureClaude() {
  // Check if installed
  let installed = false
  try {
    const ver = execSync('claude --version 2>/dev/null', { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
    console.log(chalk.green(`\n✓ Claude Code CLI: ${ver}\n`))
    installed = true
  } catch {
    console.log(chalk.yellow('\nClaude Code CLI not installed.\n'))
  }

  // Step 1: Install if needed
  if (!installed) {
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'Install Claude Code?',
      loop: false,
      choices: [
        { name: 'Install now (npm install -g @anthropic-ai/claude-code)', value: 'install' },
        { name: 'Back', value: 'back' },
      ],
    }])

    if (action === 'back') return showConfig()

    console.log(chalk.yellow('\nInstalling Claude Code CLI...\n'))
    try {
      execSync('npm install -g @anthropic-ai/claude-code', { stdio: 'inherit' })
      installed = true
    } catch (err) {
      console.log(chalk.red(`\n✗ Installation failed: ${err.message}\n`))
      return showConfig()
    }
  }

  // Step 2: Save path
  try {
    const cliPath = execSync('which claude', { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
    updateEnvVar('CLAUDE_CLI', cliPath)
    console.log(chalk.green(`✓ Path: ${cliPath}\n`))
  } catch {}

  // Step 3: Login
  const { doLogin } = await inquirer.prompt([{
    type: 'list',
    name: 'doLogin',
    message: 'Login to Claude (opens auth URL):',
    loop: false,
    choices: [
      { name: 'Login now', value: true },
      { name: 'Skip (login later)', value: false },
    ],
  }])

  if (doLogin) {
    console.log(chalk.cyan('\nLaunching Claude login... Follow the URL to authenticate.\n'))
    try {
      execSync("su - vpsbot -c 'claude login'", { stdio: 'inherit' })
      console.log(chalk.green('\n✓ Claude authenticated!\n'))
    } catch {
      console.log(chalk.yellow('\nLogin cancelled or failed. You can login later: su - vpsbot -c \'claude login\'\n'))
    }
  }

  return showConfig()
}

async function configureDomain() {
  const { domain } = await inquirer.prompt([{
    type: 'input',
    name: 'domain',
    message: 'Enter domain (e.g. maksym.site) or leave empty to use IP:',
    default: config.domain || '',
  }])

  if (domain) {
    // Detect server IP
    let serverIp = config.ipAddress || 'localhost'
    try {
      serverIp = execSync("hostname -I 2>/dev/null | awk '{print $1}' || curl -sf ifconfig.me 2>/dev/null || echo ''", { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
    } catch {}

    // Verify DNS before applying
    console.log(chalk.cyan('\n━━━ Verifying DNS ━━━\n'))
    const dns = await import('dns')
    const { promisify } = await import('util')
    const resolve4 = promisify(dns.resolve4)

    let dnsOk = true
    const checks = [`code.${domain}`]
    for (const host of checks) {
      try {
        console.log(chalk.gray(`  Resolving ${host}...`))
        const ips = await resolve4(host)
        if (ips.includes(serverIp)) {
          console.log(chalk.green(`  ✓ ${host} → ${ips.join(', ')}`))
        } else {
          console.log(chalk.red(`  ✗ ${host} → ${ips.join(', ')} (expected ${serverIp})`))
          dnsOk = false
        }
      } catch (err) {
        console.log(chalk.red(`  ✗ ${host} → DNS resolution failed (${err.code || err.message})`))
        dnsOk = false
      }
    }

    if (!dnsOk) {
      console.log(chalk.red(`\n✗ DNS does not point to this server (${serverIp}).\n`))
      console.log(chalk.yellow(`  Add this DNS record first:\n`))
      console.log(`    ${chalk.bold('A')}  *.${domain}      → ${serverIp}`)
      console.log()
      console.log(chalk.gray(`  DNS propagation can take a few minutes. Try again after updating.\n`))
      await inquirer.prompt([{ type: 'list', name: 'back', message: '', loop: false, choices: ['← Back'] }])
      return showConfig()
    }

    console.log(chalk.green(`\n✓ DNS verified — ${domain} points to ${serverIp}\n`))

    updateEnvVar('DOMAIN', domain)
    updateEnvVar('IP_ADDRESS', '', true)

    console.log(chalk.yellow(`Setting up Caddy SSL for *.${domain}...\n`))

    const csPort = config.codeServerPort || 8080

    // Stop code-server (non-critical, ignore errors)
    try { execSync('pkill -f code-server', { stdio: 'ignore' }) } catch {}

    const steps = [
      { name: 'Stop system Caddy', cmd: 'sudo systemctl stop caddy 2>/dev/null || true && sudo systemctl disable caddy 2>/dev/null || true' },
      { name: 'Free ports 80/443', cmd: 'sudo fuser -k 80/tcp 2>/dev/null || true && sudo fuser -k 443/tcp 2>/dev/null || true' },
      { name: 'Create Docker network', cmd: 'docker network create caddy 2>/dev/null || true' },
      { name: 'Remove old caddy-proxy', cmd: 'docker rm -f caddy-proxy 2>/dev/null || true' },
      { name: 'Pull caddy-docker-proxy', cmd: 'docker pull lucaslorentz/caddy-docker-proxy:ci-alpine' },
      { name: 'Start caddy-proxy', cmd: `docker run -d --name caddy-proxy --restart unless-stopped --network caddy -p 80:80 -p 443:443 -p 2019:2019 -v /var/run/docker.sock:/var/run/docker.sock -v caddy_data:/data -l "caddy.admin=0.0.0.0:2019" -l "caddy_0=code.${domain}" -l "caddy_0.reverse_proxy=host.docker.internal:${csPort}" --add-host host.docker.internal:host-gateway lucaslorentz/caddy-docker-proxy:ci-alpine` },
    ]

    let failed = false
    for (const step of steps) {
      try {
        console.log(chalk.gray(`  [${step.name}]...`))
        execSync(step.cmd, { stdio: 'inherit' })
        console.log(chalk.green(`  ✓ ${step.name}`))
      } catch (err) {
        console.log(chalk.red(`  ✗ ${step.name} FAILED`))
        console.log(chalk.red(`    ${err.stderr ? err.stderr.toString().trim() : err.message}`))
        failed = true
        break
      }
    }

    if (!failed) {
      // Rebind code-server behind Caddy
      const csConfigDir = `${process.env.HOME}/.config/code-server`
      mkdirSync(csConfigDir, { recursive: true })
      writeFileSync(join(csConfigDir, 'config.yaml'),
        `bind-addr: 127.0.0.1:${csPort}\nauth: password\npassword: ${config.codeServerPassword}\ncert: false\n`)
      spawn('code-server', ['--disable-telemetry', config.projectsDir], {
        detached: true, stdio: 'ignore',
      }).unref()

      console.log(chalk.green(`\n✓ Caddy running with auto-SSL`))
      console.log(chalk.green(`✓ https://code.${domain} → Code-Server`))
      console.log(chalk.green(`✓ https://{app}.${domain} → Project apps`))
    }
  } else {
    updateEnvVar('DOMAIN', '', true)
    const ip = config.ipAddress || 'localhost'
    updateEnvVar('IP_ADDRESS', ip)

    // Stop caddy-proxy, rebind code-server to 0.0.0.0
    execSync('docker rm -f caddy-proxy 2>/dev/null || true')
    execSync('systemctl stop caddy 2>/dev/null; systemctl disable caddy 2>/dev/null || true')
    execSync('pkill -f code-server 2>/dev/null || true')
    const csPort = config.codeServerPort || 8080
    const csConfigDir = `${process.env.HOME}/.config/code-server`
    execSync(`mkdir -p ${csConfigDir}`)
    writeFileSync(join(csConfigDir, 'config.yaml'),
      `bind-addr: 0.0.0.0:${csPort}\nauth: password\npassword: ${config.codeServerPassword}\ncert: false\n`)
    spawn('code-server', ['--disable-telemetry', config.projectsDir], {
      detached: true, stdio: 'ignore',
    }).unref()

    console.log(chalk.green(`\n✓ Switched to IP mode`))
    console.log(chalk.green(`✓ Code-Server: http://${ip}:${csPort}\n`))
  }

  console.log()
  return showConfig()
}

async function configureTelegram() {
  console.log(chalk.cyan('\n━━━ Telegram Bot Setup ━━━\n'))
  console.log(chalk.gray('  1. Open Telegram and talk to @BotFather'))
  console.log(chalk.gray('  2. Send /newbot and follow the steps'))
  console.log(chalk.gray('  3. Copy the Bot Token\n'))

  const { token } = await inquirer.prompt([{
    type: 'input',
    name: 'token',
    message: 'Bot Token (leave empty to disable):',
    default: config.botToken || '',
  }])

  if (!token) {
    updateEnvVar('BOT_TOKEN', '', true)
    updateEnvVar('CHAT_ID', '', true)
    console.log(chalk.gray('\nTelegram disabled.\n'))
    return showConfig()
  }

  updateEnvVar('BOT_TOKEN', token)

  // Try to auto-detect Chat ID
  console.log(chalk.cyan('\n━━━ Chat ID ━━━\n'))
  console.log(chalk.gray('  Send any message to your bot in Telegram, then:'))
  console.log()

  const { method } = await inquirer.prompt([{
    type: 'list',
    name: 'method',
    message: 'How to get your Chat ID:',
    loop: false,
    choices: [
      { name: 'Auto-detect (send a message to your bot first, then select this)', value: 'auto' },
      { name: 'Enter manually (use @userinfobot to find it)', value: 'manual' },
      { name: 'Skip for now', value: 'skip' },
    ],
  }])

  if (method === 'auto') {
    console.log(chalk.yellow('\nFetching latest messages from bot...\n'))
    try {
      const result = execSync(`curl -sf "https://api.telegram.org/bot${token}/getUpdates" 2>/dev/null`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString()
      const data = JSON.parse(result)
      if (data.ok && data.result && data.result.length > 0) {
        const lastMsg = data.result[data.result.length - 1]
        const chatId = lastMsg.message?.chat?.id || lastMsg.my_chat_member?.chat?.id
        if (chatId) {
          const chatName = lastMsg.message?.chat?.first_name || lastMsg.my_chat_member?.chat?.first_name || ''
          console.log(chalk.green(`✓ Found Chat ID: ${chatId} ${chatName ? `(${chatName})` : ''}\n`))
          updateEnvVar('CHAT_ID', chatId.toString())
          console.log(chalk.green('✓ Telegram configured!\n'))
          return offerStartBot()
        }
      }
      console.log(chalk.yellow('No messages found. Send a message to your bot first and try again.\n'))
    } catch {
      console.log(chalk.red('Could not reach Telegram API. Check your token.\n'))
    }
    return showConfig()
  }

  if (method === 'manual') {
    console.log(chalk.gray('\n  Tip: Send /start to @userinfobot in Telegram to get your Chat ID\n'))
    const { chatId } = await inquirer.prompt([{
      type: 'input',
      name: 'chatId',
      message: 'Your Chat ID:',
      default: config.chatId?.toString() || '',
      validate: (input) => /^-?\d+$/.test(input) ? true : 'Must be a number',
    }])
    updateEnvVar('CHAT_ID', chatId)
    console.log(chalk.green('\n✓ Telegram configured!\n'))
    return offerStartBot()
  }

  return showConfig()
}

async function offerStartBot() {
  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: 'Start Telegram bot now?',
    loop: false,
    choices: [
      { name: 'Start bot (background)', value: 'start' },
      { name: 'Back to menu', value: 'back' },
    ],
  }])

  if (action === 'start') {
    startBotBackground()
  }
  return showConfig()
}

function startBotBackground() {
  try {
    execSync('systemctl enable vps-bot-telegram && systemctl restart vps-bot-telegram', { stdio: 'inherit' })
    console.log(chalk.green('\n✓ Telegram bot started (systemd service)\n'))
  } catch {
    console.log(chalk.red('\n✗ Failed to start bot service. Run install.sh first.\n'))
  }
}

function stopBot() {
  try {
    execSync('systemctl stop vps-bot-telegram', { stdio: 'inherit' })
    console.log(chalk.green('\n✓ Telegram bot stopped\n'))
  } catch {
    console.log(chalk.gray('\nBot was not running.\n'))
  }
}

async function manageTelegramBot() {
  let running = false
  try { execSync('systemctl is-active --quiet vps-bot-telegram', { stdio: 'ignore' }); running = true } catch {}

  const choices = running
    ? [
        { name: 'Stop bot', value: 'stop' },
        { name: 'Restart bot', value: 'restart' },
      ]
    : [
        { name: 'Start bot', value: 'start' },
      ]

  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: `Telegram bot is ${running ? chalk.green('running') : chalk.red('stopped')}:`,
    loop: false,
    choices: [...choices, new inquirer.Separator(), { name: 'Back', value: 'back' }],
  }])

  if (action === 'back') return showConfig()
  if (action === 'start') startBotBackground()
  if (action === 'stop') stopBot()
  if (action === 'restart') {
    stopBot()
    startBotBackground()
  }
  return showConfig()
}

async function configurePassword() {
  const { password } = await inquirer.prompt([{
    type: 'input',
    name: 'password',
    message: 'New Code-Server password:',
    validate: (input) => input && input.length >= 4 ? true : 'Min 4 characters',
  }])

  // Update .env
  updateEnvVar('CODE_SERVER_PASSWORD', password)

  // Update code-server config.yaml (the actual file code-server reads)
  const csConfigPath = join(process.env.HOME || '/root', '.config/code-server/config.yaml')
  try {
    let csConfig = readFileSync(csConfigPath, 'utf-8')
    csConfig = csConfig.replace(/^password:.*$/m, `password: ${password}`)
    writeFileSync(csConfigPath, csConfig)
  } catch (err) {
    console.log(chalk.yellow(`⚠ Could not update ${csConfigPath}: ${err.message}`))
  }

  // Restart code-server service
  try {
    execSync('systemctl restart code-server', { stdio: 'ignore' })
    console.log(chalk.green(`\n✓ Password updated and code-server restarted. New password: ${password}\n`))
  } catch {
    console.log(chalk.green(`\n✓ Password updated. New password: ${password}`))
    console.log(chalk.yellow('⚠ Could not restart code-server. Run: systemctl restart code-server\n'))
  }
  return showConfig()
}

function updateEnvVar(key, value, comment = false) {
  try {
    let content = readFileSync(envFile, 'utf-8')
    const regex = new RegExp(`^#?\\s*${key}=.*$`, 'm')
    const newLine = comment ? `# ${key}=` : `${key}=${value}`
    if (regex.test(content)) {
      content = content.replace(regex, newLine)
    } else {
      content += `\n${newLine}\n`
    }
    writeFileSync(envFile, content)
    // Also update process.env so config reflects changes immediately
    if (comment) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  } catch {}
}

async function main() {
  if (!config.isSetupComplete()) {
    console.log(chalk.red('\nSystem not configured.\nRun: npm run setup\n'))
    process.exit(1)
  }

  await showMainMenu()
}

process.on('uncaughtException', (err) => {
  log.error('[CRASH] uncaughtException', err.stack || err.message)
  console.error(chalk.red(`\nCrash: ${err.message}`))
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  log.error('[CRASH] unhandledRejection', String(reason))
  console.error(chalk.red(`\nUnhandled rejection: ${reason}`))
})

main().catch((err) => {
  log.error('[CRASH] main()', err.stack || err.message)
  console.error(chalk.red('Error:'), err.message)
  process.exit(1)
})
