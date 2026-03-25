import { execFile, execSync, spawn } from 'child_process'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { getDocker } from '../lib/docker-client.js'
import { buildingSet } from '../lib/build-state.js'
import { config } from '../lib/config.js'
import { store } from '../lib/store.js'
import { recordClaudeCall } from '../lib/usage.js'
import { log } from '../lib/logger.js'
import { initGitRepo, gitCommit } from './git.js'

const MAX_RETRIES = 2

function projectDir(name) {
  return join(config.projectsDir, name)
}

function projectUrl(name) {
  if (config.domain) {
    return `https://${name}.${config.domain}`
  }
  const project = store.get(name)
  const port = project?.port
  const ip = config.ipAddress || 'localhost'
  return port ? `http://${ip}:${port}` : `http://${ip}`
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout: 300_000, stdio: ['pipe', 'pipe', 'pipe'], ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message))
      else resolve(stdout)
    })
    // Close stdin immediately to prevent hanging
    if (child.stdin) child.stdin.end()
  })
}

// Versión con streaming de output
function runWithStreaming(cmd, args, opts = {}) {
  const { onData, timeout = 300_000, cwd, env } = opts
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    let pendingCallbacks = 0
    let childClosed = false

    const tryResolve = () => {
      if (childClosed && pendingCallbacks === 0) {
        resolve(output)
      }
    }

    child.stdout?.on('data', (data) => {
      output += data.toString()
      if (onData) {
        pendingCallbacks++
        Promise.resolve(onData(data.toString())).finally(() => {
          pendingCallbacks--
          tryResolve()
        })
      }
    })

    child.stderr?.on('data', (data) => {
      output += data.toString()
      if (onData) {
        pendingCallbacks++
        Promise.resolve(onData(`❌ ${data.toString()}`)).finally(() => {
          pendingCallbacks--
          tryResolve()
        })
      }
    })

    const timeoutHandle = setTimeout(() => {
      child.kill()
      reject(new Error(`Comando excedió timeout (${timeout / 1000}s)`))
    }, timeout)

    child.on('close', (code) => {
      clearTimeout(timeoutHandle)
      childClosed = true
      if (code !== 0) {
        reject(new Error(output))
      } else {
        tryResolve()
      }
    })

    child.on('error', reject)
    if (child.stdin) child.stdin.end()
  })
}

function getNextPort() {
  const BASE_PORT = 4000
  const projects = store.getAll()
  const usedPorts = new Set(Object.values(projects).map(p => p.port).filter(Boolean))
  let port = BASE_PORT
  while (usedPorts.has(port)) port++
  return port
}


function writeComposeFile(dir, name) {
  let compose
  if (config.domain) {
    compose = `services:
  app:
    container_name: ${name}-app
    build: .
    restart: unless-stopped
    networks:
      - caddy
    labels:
      caddy: ${name}.${config.domain}
      caddy.reverse_proxy: "{{upstreams 3000}}"
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3

networks:
  caddy:
    external: true
`
  } else {
    const port = store.get(name)?.port || getNextPort()
    const url = `http://${config.ipAddress || 'localhost'}:${port}`
    store.set(name, { port, url })
    compose = `services:
  app:
    container_name: ${name}-app
    build: .
    restart: unless-stopped
    ports:
      - "${port}:3000"
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
`
  }
  writeFileSync(join(dir, 'docker-compose.yml'), compose)
}

function buildClaudePrompt(name, description, errorContext = null) {
  const base =
    `Crea una aplicación web Node.js completa y funcional.\n\n` +
    `Nombre: ${name}\n` +
    `Descripción: ${description}\n\n` +
    `ESTRUCTURA OBLIGATORIA:\n` +
    `- src/index.js        → Entry point: servidor Express en process.env.PORT || 3000\n` +
    `- src/routes/          → Rutas separadas si la app tiene múltiples endpoints\n` +
    `- src/public/          → Archivos estáticos (CSS, JS cliente, imágenes) si aplica\n` +
    `- package.json         → name "${name}", "type": "module", scripts.start "node src/index.js"\n` +
    `- Dockerfile           → FROM node:20-alpine, WORKDIR /app, COPY package*.json ., RUN npm install --omit=dev, COPY . ., EXPOSE 3000, CMD ["node","src/index.js"]\n` +
    `- .dockerignore        → node_modules, .git, .env, *.md\n` +
    `- .gitignore           → node_modules/, .env, dist/\n\n` +
    `REGLAS:\n` +
    `1. GET /health debe devolver { status: "ok" } — endpoint obligatorio para health checks\n` +
    `2. Usa express.static('src/public') para servir archivos estáticos\n` +
    `3. CSS va en src/public/style.css (NO inline). El diseño debe ser moderno, responsivo y visualmente atractivo\n` +
    `4. Si la app tiene UI, usa HTML semántico con un layout profesional\n` +
    `5. Maneja errores con middleware de Express (404 + error handler)\n` +
    `6. Usa SOLO caracteres ASCII en código JS. Nunca uses − (U+2212), comillas tipográficas ni otros Unicode\n` +
    `7. NO uses import maps, NO uses require(). Usa ESM (import/export)\n` +
    `8. NO añadas el nombre del proyecto como título visible. La app decide su propio contenido\n\n` +
    `Escribe TODOS los archivos al disco. Solo código, sin explicaciones.`

  if (!errorContext) return base

  return base + `\n\n⚠️ CORRECCIÓN: El intento anterior falló con este error. Analiza el error y corrige el código:\n${errorContext}`
}

function buildRebuildPrompt(name, description, mode, existingFiles, errorContext = null) {
  if (mode === 'full') {
    return buildClaudePrompt(name, description, errorContext)
  }

  // Patch mode: give Claude context about existing files
  const fileList = existingFiles.map(f => `  - ${f}`).join('\n')

  const prompt =
    `Modifica el proyecto existente "${name}".\n\n` +
    `Descripción original del proyecto: ${description.split('\nCambios solicitados:')[0].split('\n\nCambios solicitados:')[0]}\n\n` +
    `CAMBIOS SOLICITADOS:\n${description.split('Cambios solicitados:').pop()?.trim() || description}\n\n` +
    `ARCHIVOS EXISTENTES:\n${fileList}\n\n` +
    `REGLAS:\n` +
    `1. Modifica SOLO los archivos necesarios para implementar los cambios\n` +
    `2. NO borres funcionalidad existente a menos que se pida explícitamente\n` +
    `3. Mantén GET /health → { status: "ok" }\n` +
    `4. Mantén la estructura de archivos existente\n` +
    `5. Si necesitas nuevas dependencias, actualiza package.json\n` +
    `6. Usa SOLO caracteres ASCII en código JS\n` +
    `7. Escribe los archivos modificados al disco. Solo código, sin explicaciones.`

  if (!errorContext) return prompt
  return prompt + `\n\n⚠️ CORRECCIÓN: El intento anterior falló:\n${errorContext}`
}

function fixUnicodeChars(dir) {
  try {
    execSync(
      `find "${dir}/src" -name "*.js" -exec sed -i ` +
      `'s/\xe2\x88\x92/-/g; s/\xe2\x80\x9c/"/g; s/\xe2\x80\x9d/"/g; s/\xe2\x80\x99/'"'"'/g' {} + < /dev/null`,
      { shell: true, stdio: ['pipe', 'pipe', 'pipe'] }
    )
  } catch { /* ignore */ }
}

function getExistingFiles(dir) {
  try {
    const entries = execSync(`find ${JSON.stringify(dir)} -type f -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null || true`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString().trim().split('\n').filter(Boolean)
    return entries.map(e => e.replace(dir + '/', '')).filter(f => f && !f.startsWith('.git/'))
  } catch {
    return []
  }
}

async function runClaude(dir, name, description, onProgress = null, errorContext = null, model = 'claude-sonnet-4-6', mode = 'new') {
  const existingFiles = mode === 'new' ? [] : getExistingFiles(dir)
  const prompt = mode === 'new' || mode === 'full'
    ? buildClaudePrompt(name, description, errorContext)
    : buildRebuildPrompt(name, description, 'patch', existingFiles, errorContext)

  const { readdirSync, statSync, readFileSync: readF } = await import('fs')
  const startTime = Date.now()

  if (onProgress) {
    await onProgress('🧠 Claude Code generando código...')
  }

  // Track files created during build
  const initialFiles = new Set()
  try {
    for (const f of readdirSync(dir, { recursive: true })) {
      if (typeof f === 'string') initialFiles.add(f)
    }
  } catch {}

  try {
    const claudeBin = config.claudeCli || 'claude'
    const claudeCmd = `cd ${JSON.stringify(dir)} && ${claudeBin} -p ${JSON.stringify(prompt)} --dangerously-skip-permissions --model ${model}`
    await run('su', ['-', 'vpsbot', '-c', claudeCmd], { timeout: 300_000 })
    try {
      recordClaudeCall(Math.round(prompt.length / 4))
    } catch {}
  } finally {
    // nothing to clean up
  }

  // Show summary of generated/modified files
  if (onProgress) {
    const elapsed = Math.round((Date.now() - startTime) / 1000)
    try {
      const files = readdirSync(dir, { recursive: true })
      const newFiles = []
      const modifiedFiles = []

      for (const file of files) {
        if (typeof file === 'string' && !file.includes('node_modules') && !file.includes('.git')) {
          const fullPath = join(dir, file)
          try {
            const stat = statSync(fullPath)
            if (!stat.isFile()) continue
            const icon = file.endsWith('.js') ? '📄' : file.endsWith('.json') ? '📦' : file.endsWith('.css') ? '🎨' : file.endsWith('.html') ? '🌐' : file === 'Dockerfile' ? '🐳' : '📁'
            const sizeStr = stat.size > 1024 ? `${(stat.size/1024).toFixed(1)}KB` : `${stat.size}B`
            const entry = `${icon} \`${file}\` (${sizeStr})`
            if (initialFiles.has(file)) {
              modifiedFiles.push(entry)
            } else {
              newFiles.push(entry)
            }
          } catch {}
        }
      }

      let summary = `✅ Código generado en ${elapsed}s\n\n`
      if (newFiles.length) summary += `*Archivos creados:*\n${newFiles.slice(0, 15).join('\n')}\n`
      if (modifiedFiles.length && mode !== 'new') summary += `\n*Archivos modificados:*\n${modifiedFiles.slice(0, 10).join('\n')}`
      await onProgress(summary.trim())
    } catch {
      await onProgress(`✅ Código generado en ${elapsed}s`)
    }
  }
  fixUnicodeChars(dir)
}

async function runClaudeWithStreaming(dir, name, description, onProgress, errorContext = null, model = 'claude-sonnet-4-6') {
  const prompt = buildClaudePrompt(name, description, errorContext)
  const lines = []
  let lastUpdate = Date.now()

  const claudeBin = config.claudeCli || 'claude'
  const claudeCmd = `cd ${JSON.stringify(dir)} && ${claudeBin} -p ${JSON.stringify(prompt)} --dangerously-skip-permissions --model ${model}`
  await runWithStreaming('su', ['-', 'vpsbot', '-c', claudeCmd], {
    onData: async (chunk) => {
      lines.push(...chunk.split('\n').filter(l => l.trim()))

      // Actualizar cada 2 segundos
      if (Date.now() - lastUpdate > 2000) {
        lastUpdate = Date.now()
        const recent = lines.slice(-12).join('\n')
        await onProgress(recent)
      }
    }
  })

  fixUnicodeChars(dir)
}

async function runOpenRouter(dir, name, description, errorContext = null, model = 'minimax/MiniMax-M2.5') {
  const prompt = buildClaudePrompt(name, description, errorContext)
  
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.openrouterKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://vps-bot.local',
      'X-Title': 'VPS-Bot',
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content

  if (!content) {
    throw new Error('OpenRouter no devolvió contenido')
  }

  // OpenRouter models usually return code in markdown blocks, extract them
  const codeBlocks = content.match(/```(?:javascript|js|node)?\n?([\s\S]*?)```/g) || []
  
  // If we got code blocks, write them to files. Otherwise try to parse as JSON or use whole response
  if (codeBlocks.length > 0) {
    // Common patterns: multiple files might be in separate code blocks
    // For simplicity, we'll try to detect file structure from the content
    const cleanContent = content.replace(/```[\w]*\n?|```/g, '').trim()
    
    // Try to create a simple single-file output (index.js + package.json approach)
    // The prompt asks for src/index.js, package.json, Dockerfile
    // For now, write the main content and handle file detection
    if (cleanContent.includes('package.json') || cleanContent.includes('src/index.js')) {
      // Multi-file response
      const files = parseMultiFileContent(cleanContent)
      for (const [filename, fileContent] of Object.entries(files)) {
        const filePath = join(dir, filename)
        mkdirSync(dirname(filePath), { recursive: true })
        writeFileSync(filePath, fileContent)
      }
    } else {
      // Single file response - assume it's the main index.js
      mkdirSync(join(dir, 'src'), { recursive: true })
      writeFileSync(join(dir, 'src', 'index.js'), cleanContent)
      // Create minimal package.json if not present
      if (!existsSync(join(dir, 'package.json'))) {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({
          name: name,
          type: "module",
          scripts: { start: "node src/index.js" },
          dependencies: { express: "^4.18.0" }
        }, null, 2))
      }
    }
  } else {
    // No code blocks found, write the whole content as index.js
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'index.js'), content)
  }
  
  fixUnicodeChars(dir)
}

function parseMultiFileContent(content) {
  const files = {}
  const filePattern = /(?:^|\n)(```(?:javascript|js|json|dockerfile|docker)?\s*(?:\/\/.*?\n)?(?:filename|file):\s*["']?([^"'\n]+)["']?\n)([\s\S]*?)(?=(?:\n```)|$)/gm
  const simplePattern = /```(?:javascript|js|node)?\n([\s\S]*?)```/g
  
  let match
  let currentFile = null
  let currentContent = []
  
  // Pattern 1: Try to match files with filename markers
  const lines = content.split('\n')
  let currentFilename = null
  let inCodeBlock = false
  let codeBuffer = []
  let codeLanguage = null
  
  for (const line of lines) {
    if (line.startsWith('```') && !inCodeBlock) {
      inCodeBlock = true
      codeBuffer = []
      const langMatch = line.match(/```(\w*)/)
      codeLanguage = langMatch ? langMatch[1] : null
      // Check for filename on same line or next
      const fnMatch = line.match(/file[":]+\s*([^\s"']+)/) || (lines[lines.indexOf(line) + 1]?.match(/^\s*"?([^"'\n]+)"?\s*$/))
      if (fnMatch) currentFilename = fnMatch[1]
    } else if (line.startsWith('```') && inCodeBlock) {
      inCodeBlock = false
      const content = codeBuffer.join('\n')
      if (currentFilename && content) {
        files[currentFilename] = content
      } else if (!currentFilename) {
        // Try to infer filename from language
        if (codeLanguage === 'json' || content.includes('"name"')) {
          files['package.json'] = content
        } else if (codeLanguage === 'dockerfile' || content.startsWith('FROM')) {
          files['Dockerfile'] = content
        } else {
          files['src/index.js'] = content
        }
      }
      currentFilename = null
      codeBuffer = []
    } else if (inCodeBlock) {
      codeBuffer.push(line)
    }
  }
  
  // Fallback: if no files parsed, try simple extraction
  if (Object.keys(files).length === 0) {
    const blocks = content.split(/```/).filter((_, i) => i % 2 === 1)
    if (blocks.length > 0) {
      blocks.forEach((block, idx) => {
        const clean = block.replace(/^\w*\n/, '').trim()
        if (clean.includes('"name"')) {
          files['package.json'] = clean
        } else if (clean.startsWith('FROM')) {
          files['Dockerfile'] = clean
        } else if (idx === 0 || !files['src/index.js']) {
          files['src/index.js'] = clean
        }
      })
    }
  }
  
  return files
}


async function dockerComposeUp(dir, onProgress = null) {
  if (!onProgress) {
    // Modo simple (sin callbacks)
    await run('docker', ['compose', 'up', '--build', '-d'], { cwd: dir })
    return
  }

  // Modo con salida simplificada
  return new Promise((resolve, reject) => {
    const allLines = []
    const child = spawn('docker', ['compose', 'up', '--build', '-d'], { cwd: dir })
    const steps = new Set()

    const parseStep = (line) => {
      // Extract meaningful Docker build steps
      if (/\[\d+\/\d+\]/.test(line)) {
        const match = line.match(/\[\d+\/\d+\]\s+(.+)/)
        if (match) return `📦 ${match[1].split(' ').slice(0, 3).join(' ')}`
      }
      if (/Building/.test(line)) return '🔨 Building image...'
      if (/Built/.test(line)) return '✅ Image built'
      if (/Creating/.test(line) && /Container/.test(line)) return '📦 Creating container...'
      if (/Started/.test(line)) return '🚀 Container started'
      if (/npm install/.test(line) || /added \d+ packages/.test(line)) return '📦 npm install...'
      return null
    }

    child.stdout?.on('data', (data) => {
      allLines.push(data.toString())
    })

    child.stderr?.on('data', (data) => {
      const text = data.toString()
      allLines.push(text)
      for (const line of text.split('\n')) {
        const step = parseStep(line)
        if (step && !steps.has(step)) {
          steps.add(step)
          onProgress(step)
        }
      }
    })

    child.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(`docker compose up falló\n${allLines.slice(-3).join('\n')}`))
      } else {
        resolve()
      }
    })

    child.on('error', reject)
    if (child.stdin) child.stdin.end()
  })
}

async function dockerComposeDown(dir) {
  try {
    await run('docker', ['compose', 'down', '--rmi', 'local'], { cwd: dir })
  } catch { /* ignore */ }
}

async function getContainerIp(name) {
  const containers = await getDocker().listContainers({
    filters: JSON.stringify({ name: [`${name}-app`] }),
  })
  if (!containers.length) return null
  const info = await getDocker().getContainer(containers[0].Id).inspect()
  // Try caddy network first, then any network with an IP
  const networks = info.NetworkSettings.Networks || {}
  if (networks.caddy?.IPAddress) return networks.caddy.IPAddress
  for (const net of Object.values(networks)) {
    if (net.IPAddress) return net.IPAddress
  }
  return null
}

async function getContainerLogs(name) {
  try {
    const containers = await getDocker().listContainers({
      all: true,
      filters: JSON.stringify({ name: [`${name}-app`] }),
    })
    if (!containers.length) return ''
    const container = getDocker().getContainer(containers[0].Id)
    const stream = await container.logs({ stdout: true, stderr: true, tail: 30 })
    return Buffer.isBuffer(stream) ? stream.toString() : String(stream)
  } catch {
    return ''
  }
}

async function pollHealth(ip, port, timeoutMs = 40_000, onProgress = null) {
  const deadline = Date.now() + timeoutMs
  let attempts = 0

  while (Date.now() < deadline) {
    attempts++
    try {
      if (onProgress) {
        const elapsed = Math.round((Date.now() - (deadline - timeoutMs)) / 1000)
        await onProgress(`Intento ${attempts}: conectando a http://${ip}:${port}...`)
      }

      const res = await fetch(`http://${ip}:${port}/`, {
        signal: AbortSignal.timeout(3000),
      })
      if (res.status < 500) return true
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 2000))
  }
  return false
}

function isOpenRouterModel(model) {
  return config.openrouterKey && (model.startsWith('openrouter/') || model.includes(':'))
}

async function buildAndVerify(dir, name, description, onStatus, errorContext = null, model = 'claude-sonnet-4-6', mode = 'new') {
  let modelTag = '🚀 Sonnet'
  if (model.includes('opus')) modelTag = '🧠 Opus'
  else if (model.includes('haiku')) modelTag = '⚡ Haiku'

  log.info(`[${name}] build start`, `model=${model} dir=${dir} mode=${mode}`)

  if (isOpenRouterModel(model)) {
    await onStatus(`${modelTag} Usando OpenRouter...`)
    await runOpenRouter(dir, name, description, errorContext, model.replace('openrouter/', ''))
  } else {
    const modeLabel = mode === 'new' ? 'Generando proyecto' : mode === 'full' ? 'Regenerando proyecto' : 'Aplicando cambios'
    await onStatus(`${modelTag} ${modeLabel}...`)
    try {
      await runClaude(dir, name, description, onStatus, errorContext, model, mode)
      log.info(`[${name}] code generated`)
    } catch (err) {
      log.error(`[${name}] code generation failed`, err.message)
      throw new Error(`Error generando código: ${err.message}`)
    }
  }

  if (!existsSync(join(dir, 'Dockerfile'))) {
    if (isOpenRouterModel(model)) {
      const dockerfile = `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]`
      writeFileSync(join(dir, 'Dockerfile'), dockerfile)
    } else {
      log.error(`[${name}] no Dockerfile generated`)
      throw new Error('Claude no generó el Dockerfile.')
    }
  }

  writeComposeFile(dir, name)
  await onStatus('🐳 Levantando Docker...')

  const onDockerProgress = async (step) => {
    await onStatus(`🐳 ${step}`)
  }

  try {
    await dockerComposeUp(dir, onDockerProgress)
    log.info(`[${name}] docker compose up OK`)
  } catch (err) {
    log.error(`[${name}] docker compose up failed`, err.message)
    throw err
  }

  await onStatus('🔍 Verificando que arranca...')

  // In IP mode, check via localhost:mappedPort; in domain mode, use container IP:3000
  const project = store.get(name)
  let healthHost, healthPort
  log.info(`[${name}] health check setup`, `domain=${config.domain || 'none'} project.port=${project?.port}`)

  if (!config.domain && project?.port) {
    healthHost = '127.0.0.1'
    healthPort = project.port
  } else {
    const ip = await getContainerIp(name)
    log.info(`[${name}] container IP: ${ip || 'null'}`)
    if (!ip) {
      const logs = await getContainerLogs(name)
      log.error(`[${name}] container has no IP`, logs)
      throw new Error(`Container no arrancó.\n${logs.slice(-800)}`)
    }
    healthHost = ip
    healthPort = 3000
  }

  log.info(`[${name}] polling health at ${healthHost}:${healthPort}`)
  await onStatus(`🔄 Esperando respuesta HTTP en ${healthHost}:${healthPort}...`)

  const onHealthProgress = async (msg) => {
    await onStatus(`🔍 ${msg}`)
  }

  const healthy = await pollHealth(healthHost, healthPort, 40_000, onHealthProgress)
  if (!healthy) {
    const logs = await getContainerLogs(name)
    log.error(`[${name}] health check failed after 40s`, logs)
    throw new Error(`App no responde en 40s.\n${logs.slice(-800)}`)
  }

  const url = projectUrl(name)
  log.info(`[${name}] deploy OK → ${url}`)
  await onStatus(`✅ App en ejecución\n🔗 ${url}`)
}

async function deployWithRetry(ctx, dir, name, description, action, model = 'claude-sonnet-4-6', mode = null) {
  let lastError = null
  let statusMsgId = null
  const buildStart = Date.now()

  if (!mode) mode = action === 'new' ? 'new' : 'rebuild'

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const onStatus = async (text) => {
      const elapsed = Math.round((Date.now() - buildStart) / 1000)
      const timeStr = elapsed > 60 ? `${Math.floor(elapsed/60)}m ${elapsed%60}s` : `${elapsed}s`
      const prefix = attempt > 1 ? `🔄 Reintento ${attempt}/${MAX_RETRIES} · ` : ''
      const fullText = `${prefix}⏱ ${timeStr}\n\n${text}`

      // Try to edit existing message, create new if needed
      if (statusMsgId) {
        try {
          await ctx.telegram.editMessageText(ctx.chat.id, statusMsgId, null, fullText, { parse_mode: 'Markdown' })
          return
        } catch {
          // edit failed (message too old or content same), send new
        }
      }
      const msg = await ctx.reply(fullText, { parse_mode: 'Markdown' })
      statusMsgId = msg.message_id
    }

    try {
      if (attempt > 1) {
        statusMsgId = null
        await onStatus(`🔄 *Reintento ${attempt}/${MAX_RETRIES}*\nCorrigiendo errores del intento anterior...`)
      }

      await buildAndVerify(dir, name, description, onStatus,
        attempt > 1 ? lastError?.message : null, model, mode)

      return true
    } catch (err) {
      lastError = err
      log.error(`[${name}] attempt ${attempt} failed`, err.message)
      if (attempt < MAX_RETRIES) {
        statusMsgId = null
        await ctx.reply(`⚠️ Intento ${attempt} fallido, reintentando...\n\`${err.message.slice(0, 200)}\``, { parse_mode: 'Markdown' })
        await new Promise(r => setTimeout(r, 2000))
      }
    }
  }

  log.error(`[${name}] failed after ${MAX_RETRIES} attempts`, lastError?.message)
  await ctx.reply(`❌ Falló tras ${MAX_RETRIES} intentos:\n\`${lastError?.message?.slice(0, 400)}\``, { parse_mode: 'Markdown' })
  return false
}

export async function deployNew(ctx, name, description, model = 'claude-sonnet-4-6') {
  mkdirSync(projectDir(name), { recursive: true })
  try { execSync(`chown -R vpsbot:vpsbot ${JSON.stringify(projectDir(name))}`) } catch {}
  const ok = await deployWithRetry(ctx, projectDir(name), name, description, 'new', model)
  if (ok) {
    store.set(name, { description, url: projectUrl(name), dir: projectDir(name), model })

    // Auto-init git repo + initial commit
    try {
      await initGitRepo(name, null)
      log.info(`[${name}] git repo initialized`)
    } catch (err) {
      log.error(`[${name}] git init failed`, err.message)
    }

    // Mensaje final elegante con botones
    const { Markup } = await import('telegraf')
    const url = projectUrl(name)
    const finalMsg = `✅ *Proyecto creado exitosamente*

📦 *${name}*
_${description}_

🔗 URL: \`${url}\`
📁 Directorio: \`${projectDir(name)}\`
🤖 Modelo: ${model.includes('opus') ? '🧠 Opus' : model.includes('haiku') ? '⚡ Haiku' : '🚀 Sonnet'}

🎉 ¡Listo para usar!`

    await ctx.reply(finalMsg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('♻️ Rebuild', `rb:${name}`), Markup.button.callback('📋 Logs', `lg:${name}`)],
        [Markup.button.callback('💻 Code-Server', `cs:${name}`), Markup.button.callback('🔗 Copiar URL', `url:${name}`)],
        [Markup.button.callback('▶️ Start', `go:${name}`), Markup.button.callback('🗑️ Eliminar', `del:${name}`)],
        [Markup.button.callback('⬅️ Lista', 'list')],
      ]),
    })
  }
  return ok
}

export async function deployRebuild(ctx, name, description, model = 'claude-sonnet-4-6', mode = 'patch') {
  const dir = projectDir(name)

  // Si es un rebuild full, borrar el proyecto primero para recrearlo desde cero
  if (mode === 'full') {
    try {
      await dockerComposeDown(dir)
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true })
      }
      mkdirSync(dir, { recursive: true })
      try { execSync(`chown -R vpsbot:vpsbot ${JSON.stringify(dir)}`) } catch {}
    } catch (err) {
      console.error('Error limpiando directorio:', err.message)
    }
  }

  const ok = await deployWithRetry(ctx, dir, name, description, 'rebuild', model, mode)
  if (ok) {
    store.set(name, { description, url: projectUrl(name), dir: dir, model })

    // Auto-commit changes
    try {
      const commitMsg = mode === 'full'
        ? `Rebuild completo: ${description.slice(0, 100)}`
        : `Patch: ${description.split('Cambios solicitados:').pop()?.trim().slice(0, 100) || description.slice(0, 100)}`
      await gitCommit(name, commitMsg)
      log.info(`[${name}] git commit after rebuild`)
    } catch (err) {
      log.error(`[${name}] git commit failed`, err.message)
    }

    // Mensaje final elegante con botones
    const { Markup } = await import('telegraf')
    const url = projectUrl(name)
    const finalMsg = `✅ *Proyecto reconstruido exitosamente*

📦 *${name}*
_${description}_

🔗 URL: \`${url}\`
🤖 Modelo: ${model.includes('opus') ? '🧠 Opus' : model.includes('haiku') ? '⚡ Haiku' : '🚀 Sonnet'}

♻️ Cambios aplicados y verificados`

    await ctx.reply(finalMsg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('♻️ Rebuild', `rb:${name}`), Markup.button.callback('📋 Logs', `lg:${name}`)],
        [Markup.button.callback('💻 Code-Server', `cs:${name}`), Markup.button.callback('🔗 Copiar URL', `url:${name}`)],
        [Markup.button.callback('🛑 Stop', `st:${name}`), Markup.button.callback('🗑️ Eliminar', `del:${name}`)],
        [Markup.button.callback('⬅️ Lista', 'list')],
      ]),
    })
  }
  return ok
}

export async function newCommand(ctx) {
  const parts = ctx.message.text.split(' ')
  const rawName = parts[1]
  const description = parts.slice(2).join(' ').trim()

  if (!rawName || !description) {
    return ctx.reply('Uso: /new <nombre> <descripción del proyecto>')
  }

  const name = rawName.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  if (store.get(name)) {
    return ctx.reply(`Ya existe "${name}". Usa /rebuild ${name} para actualizarlo.`)
  }
  if (buildingSet.has(name)) return ctx.reply(`Ya se está construyendo "${name}"...`)

  buildingSet.add(name)
  const msg = await ctx.reply('⚙️ Iniciando...', { parse_mode: 'Markdown' })
  const ok = await deployNew(ctx, name, description)
  buildingSet.delete(name)

  if (ok) {
    return ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, undefined,
      `✅ *${name}* listo!\n\n🔗 ${projectUrl(name)}\n\n_/rebuild ${name} para iterar_`,
      { parse_mode: 'Markdown' }
    )
  }
}

export async function rebuildCommand(ctx) {
  const parts = ctx.message.text.split(' ')
  const name = parts[1]?.toLowerCase()
  const newDescription = parts.slice(2).join(' ').trim()

  if (!name) return ctx.reply('Uso: /rebuild <nombre> [nueva descripción]')

  const project = store.get(name)
  if (!project) return ctx.reply(`Proyecto "${name}" no encontrado. Usa /new para crearlo.`)
  if (buildingSet.has(name)) return ctx.reply(`Ya se está construyendo "${name}"...`)

  buildingSet.add(name)
  const description = newDescription || project.description
  const msg = await ctx.reply('♻️ Iniciando...', { parse_mode: 'Markdown' })
  const ok = await deployRebuild(ctx, name, description)
  buildingSet.delete(name)

  if (ok) {
    return ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, undefined,
      `✅ *${name}* actualizado!\n\n🔗 ${projectUrl(name)}`,
      { parse_mode: 'Markdown' }
    )
  }
}

export async function listCommand(ctx) {
  const projects = store.getAll()
  const names = Object.keys(projects)

  if (!names.length) {
    return ctx.reply('No hay proyectos. Usa `/new <nombre> <descripción>` para crear uno.', { parse_mode: 'Markdown' })
  }

  const lines = names.map(n => {
    const p = projects[n]
    return `• *${n}*\n  🔗 ${p.url}\n  _${(p.description ?? '').slice(0, 80)}_`
  })

  return ctx.reply(lines.join('\n\n'), { parse_mode: 'Markdown' })
}

export async function urlCommand(ctx) {
  const name = ctx.message.text.split(' ')[1]?.toLowerCase()
  if (!name) return ctx.reply('Uso: /url <nombre>')

  const project = store.get(name)
  if (!project) return ctx.reply(`Proyecto "${name}" no encontrado.`)

  return ctx.reply(`🔗 *${name}*: ${project.url}`, { parse_mode: 'Markdown' })
}

export async function deleteProjectCommand(ctx) {
  const name = ctx.message.text.split(' ')[1]?.toLowerCase()
  if (!name) return ctx.reply('Uso: /delete <nombre>')

  const project = store.get(name)
  if (!project) return ctx.reply(`Proyecto "${name}" no encontrado.`)

  const msg = await ctx.reply(`🗑️ Eliminando *${name}*...`, { parse_mode: 'Markdown' })
  const dir = projectDir(name)

  try {
    await dockerComposeDown(dir)
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    store.delete(name)

    return ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, undefined,
      `🗑️ *${name}* eliminado.`,
      { parse_mode: 'Markdown' }
    )
  } catch (err) {
    return ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, undefined,
      `❌ Error eliminando *${name}*:\n\`${err.message.slice(0, 300)}\``,
      { parse_mode: 'Markdown' }
    )
  }
}