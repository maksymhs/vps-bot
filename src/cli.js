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
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

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

async function showMainMenu() {
  console.clear()
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
  } catch (err) {
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
      console.log(chalk.green(`\n${name} rebuilt successfully!\n`))
    }
  } catch (err) {
    console.error(chalk.red(`\nRebuild failed: ${err.message}\n`))
  }
}

async function showNewProject() {
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
    choices: [
      { name: 'Sonnet (recommended)', value: 'claude-sonnet-4-6' },
      { name: 'Opus (more powerful)', value: 'claude-opus-4-6' },
      { name: 'Haiku (fastest)', value: 'claude-haiku-4-5-20251001' },
    ],
  }])

  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: `Create "${name}" with ${model.includes('opus') ? 'Opus' : model.includes('haiku') ? 'Haiku' : 'Sonnet'}?`,
    default: true,
  }])

  if (!confirm) return showMainMenu()

  console.log(chalk.cyan(`\nCreating project: ${name}...\n`))

  try {
    const { deployNew } = await import('./commands/projects.js')
    buildingSet.add(name)
    const ok = await deployNew(cliCtx, name, description, model)
    buildingSet.delete(name)
    if (ok) {
      console.log(chalk.green(`\n${name} created successfully!`))
      console.log(chalk.gray(`URL: ${config.projectUrl(name)}\n`))
    }
  } catch (err) {
    buildingSet.delete(name)
    console.error(chalk.red(`\nCreation failed: ${err.message}\n`))
  }

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

async function showConfig() {
  const net = config.domain
    ? chalk.green(`${config.domain} (SSL)`)
    : chalk.green(`${config.ipAddress}:${config.port}`)

  console.log(chalk.cyan('\nCurrent Configuration:\n'))
  console.log(`  Network:     ${net}`)
  console.log(`  Code-Server: ${config.domain ? `https://code.${config.domain}` : `http://${config.ipAddress}:${config.codeServerPort}`}`)
  console.log(`  Claude CLI:  ${config.claudeCli || chalk.gray('not set')}`)
  console.log(`  Telegram:    ${config.botToken ? chalk.green('configured') : chalk.gray('not set')}`)
  console.log(`  Projects:    ${config.projectsDir}`)
  console.log('')

  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: 'Configure:',
    loop: false,
    choices: [
      { name: 'Set Custom Domain', value: 'domain' },
      { name: 'Set Telegram Bot', value: 'telegram' },
      { name: 'Change Code-Server Password', value: 'password' },
      new inquirer.Separator(),
      { name: 'Back', value: 'back' },
    ],
  }])

  if (action === 'back') return showMainMenu()
  if (action === 'domain') return configureDomain()
  if (action === 'telegram') return configureTelegram()
  if (action === 'password') return configurePassword()
}

async function configureDomain() {
  const { domain } = await inquirer.prompt([{
    type: 'input',
    name: 'domain',
    message: 'Enter domain (e.g. maksym.site) or leave empty to use IP:',
    default: config.domain || '',
  }])

  if (domain) {
    updateEnvVar('DOMAIN', domain)
    updateEnvVar('IP_ADDRESS', '', true)

    // Detect server IP for DNS instructions
    let serverIp = config.ipAddress || 'localhost'
    try {
      serverIp = execSync("hostname -I 2>/dev/null | awk '{print $1}' || curl -sf ifconfig.me 2>/dev/null || echo 'YOUR_SERVER_IP'", { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
    } catch {}

    console.log(chalk.cyan(`\n━━━ DNS Configuration Required ━━━\n`))
    console.log(chalk.yellow(`  Add these DNS records pointing to ${chalk.bold(serverIp)}:\n`))
    console.log(`    ${chalk.bold('A')}  ${domain}        → ${serverIp}`)
    console.log(`    ${chalk.bold('A')}  *.${domain}      → ${serverIp}`)
    console.log()
    console.log(chalk.gray(`  This covers code.${domain} and all {app}.${domain} subdomains.`))
    console.log(chalk.gray(`  SSL certificates are auto-managed by Caddy (Let's Encrypt).\n`))

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
  const { token } = await inquirer.prompt([{
    type: 'input',
    name: 'token',
    message: 'Telegram Bot Token (from @BotFather):',
    default: config.botToken || '',
  }])

  if (!token) {
    updateEnvVar('BOT_TOKEN', '', true)
    updateEnvVar('CHAT_ID', '', true)
    console.log(chalk.gray('\nTelegram disabled.\n'))
    return showConfig()
  }

  const { chatId } = await inquirer.prompt([{
    type: 'input',
    name: 'chatId',
    message: 'Your Telegram Chat ID:',
    default: config.chatId?.toString() || '',
    validate: (input) => /^-?\d+$/.test(input) ? true : 'Must be a number',
  }])

  updateEnvVar('BOT_TOKEN', token)
  updateEnvVar('CHAT_ID', chatId)
  console.log(chalk.green('\n✓ Telegram configured\n'))
  return showConfig()
}

async function configurePassword() {
  const { password } = await inquirer.prompt([{
    type: 'input',
    name: 'password',
    message: 'New Code-Server password:',
    validate: (input) => input && input.length >= 4 ? true : 'Min 4 characters',
  }])

  updateEnvVar('CODE_SERVER_PASSWORD', password)
  console.log(chalk.green('\n✓ Password updated. Restart code-server to apply: pkill -f code-server && npm start\n'))
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
  } catch {}
}

async function main() {
  if (!config.isSetupComplete()) {
    console.log(chalk.red('\nSystem not configured.\nRun: npm run setup\n'))
    process.exit(1)
  }

  await showMainMenu()
}

main().catch((err) => {
  console.error(chalk.red('Error:'), err.message)
  process.exit(1)
})
