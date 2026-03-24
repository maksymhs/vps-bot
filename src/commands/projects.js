import { execFile, execSync, spawn } from 'child_process'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { getDocker } from '../lib/docker-client.js'
import { buildingSet } from '../lib/build-state.js'
import { config } from '../lib/config.js'
import { store } from '../lib/store.js'
import { recordClaudeCall } from '../lib/usage.js'

const MAX_RETRIES = 2

function projectDir(name) {
  return join(config.projectsDir, name)
}

function projectUrl(name) {
  return config.projectUrl(name)
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

function writeComposeFile(dir, name) {
  const compose = `services:
  app:
    build: .
    restart: unless-stopped
    networks:
      - caddy
    labels:
      caddy: ${name}.${config.domain}
      caddy.reverse_proxy: "{{upstreams 3000}}"

networks:
  caddy:
    external: true
`
  writeFileSync(join(dir, 'docker-compose.yml'), compose)
}

function buildClaudePrompt(name, description, errorContext = null) {
  const base =
    `Crea un proyecto Node.js. Descripción: ${description}\n\n` +
    `Requisitos estrictos:\n` +
    `1. Crea src/index.js — servidor Express que escucha en process.env.PORT || 3000\n` +
    `2. La app implementa lo que describe la descripción. NO añadas el nombre del proyecto ni la descripción como contenido visible en el HTML — eso lo decide la app según su lógica\n` +
    `3. Crea package.json con name "${name}", "type": "module", scripts.start "node src/index.js"\n` +
    `4. Crea Dockerfile: FROM node:20-alpine, WORKDIR /app, COPY package*.json ., RUN npm install, COPY . ., EXPOSE 3000, CMD ["npm","start"]\n` +
    `5. Crea .dockerignore con: node_modules\\n.git\\n.env\n` +
    `6. Usa SOLO caracteres ASCII en el código JavaScript. Nunca uses − (U+2212), " " (comillas tipográficas) ni otros Unicode en código JS\n` +
    `Escribe TODOS los archivos al disco. Solo código, sin explicaciones.`

  if (!errorContext) return base

  return base + `\n\nEl intento anterior falló con este error — corrígelo:\n${errorContext}`
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

async function runClaude(dir, name, description, onProgress = null, errorContext = null, model = 'claude-sonnet-4-6') {
  const prompt = buildClaudePrompt(name, description, errorContext)
  const { readdirSync } = await import('fs')

  if (onProgress) {
    await onProgress('🧠 Claude Code analizando...')
  }

  // Polling de archivos creados
  const createdFiles = new Set()
  let pollInterval = null
  let pendingFiles = []
  let lastFileUpdate = Date.now()

  if (onProgress) {
    pollInterval = setInterval(async () => {
      try {
        const files = readdirSync(dir, { recursive: true })
        for (const file of files) {
          if (typeof file === 'string' && !file.includes('node_modules') && !createdFiles.has(file)) {
            createdFiles.add(file)
            const icon = file.endsWith('.js') ? '📄' : file.endsWith('.json') ? '📦' : file.endsWith('.yml') || file.endsWith('.yaml') ? '⚙️' : '📁'
            pendingFiles.push(`${icon} \`${file}\``)
          }
        }

        // Enviar archivos acumulados cada 2 segundos
        if (pendingFiles.length > 0 && Date.now() - lastFileUpdate > 2000) {
          lastFileUpdate = Date.now()
          await onProgress(`✏️ Creando archivos:\n${pendingFiles.join('\n')}`)
          pendingFiles = []
        }
      } catch (err) {
        // Ignorar errores de lectura
      }
    }, 500)
  }

  try {
    const claudeBin = config.claudeCli || 'claude'
    const claudeCmd = `cd ${JSON.stringify(dir)} && ${claudeBin} -p ${JSON.stringify(prompt)} --dangerously-skip-permissions --model ${model}`
    await run('su', ['-', 'vpsbot', '-c', claudeCmd], { timeout: 300_000 })
    // Registrar uso de Claude
    try {
      recordClaudeCall(Math.round(prompt.length / 4)) // Estima tokens (aprox 1 token por 4 chars)
    } catch (err) {
      console.error('Error registrando uso:', err.message)
    }
  } finally {
    if (pollInterval) clearInterval(pollInterval)
    // Enviar archivos pendientes
    if (pendingFiles.length > 0 && onProgress) {
      await onProgress(`✏️ Creando archivos:\n${pendingFiles.join('\n')}`)
    }
  }

  if (onProgress) {
    // Mostrar resumen de archivos creados
    try {
      const { readFileSync, statSync } = await import('fs')
      const files = readdirSync(dir, { recursive: true })
      const summary = []

      for (const file of files) {
        if (typeof file === 'string' && !file.includes('node_modules')) {
          const path = `${dir}/${file}`
          try {
            const stat = statSync(path)
            if (stat.isFile()) {
              const icon = file.endsWith('.js') ? '📄' : file.endsWith('.json') ? '📦' : file.endsWith('.yml') ? '⚙️' : file.endsWith('Dockerfile') ? '🐳' : '📁'
              const size = stat.size
              const sizeStr = size > 1024 ? `${(size/1024).toFixed(1)}KB` : `${size}B`
              summary.push(`${icon} \`${file}\` (${sizeStr})`)

              // Mostrar primeras líneas de archivos clave
              if (file === 'package.json' || file === 'src/index.js') {
                const content = readFileSync(path, 'utf8').split('\n').slice(0, 3).join('\n')
                summary.push(`  \`\`\`\n${content}\n  ...\`\`\``)
              }
            }
          } catch (err) {
            // Ignorar errores
          }
        }
      }

      if (summary.length > 0) {
        await onProgress(`📋 Archivos generados:\n${summary.slice(0, 12).join('\n')}`)
      }
    } catch (err) {
      // Ignorar errores de resumen
    }

    await onProgress('✅ Código listo')
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

  // Modo con salida en vivo
  return new Promise((resolve, reject) => {
    const lines = []
    const child = spawn('docker', ['compose', 'up', '--build', '-d'], { cwd: dir })

    child.stdout?.on('data', (data) => {
      lines.push(...data.toString().split('\n').filter(l => l.trim()))
      updateProgress()
    })

    child.stderr?.on('data', (data) => {
      lines.push(`❌ ${data.toString()}`)
      updateProgress()
    })

    let lastUpdate = Date.now()
    const updateProgress = async () => {
      if (Date.now() - lastUpdate > 1000) {
        lastUpdate = Date.now()
        const recent = lines.slice(-15).join('\n')
        await onProgress(recent)
      }
    }

    child.on('close', async (code) => {
      await updateProgress()
      if (code !== 0) {
        reject(new Error(`docker compose up falló\n${lines.slice(-5).join('\n')}`))
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
  return info.NetworkSettings.Networks?.caddy?.IPAddress ?? null
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

async function buildAndVerify(dir, name, description, onStatus, errorContext = null, model = 'claude-sonnet-4-6') {
  let modelTag = '🚀 Sonnet'
  if (model.includes('opus')) modelTag = '🧠 Opus'
  else if (model.includes('haiku')) modelTag = '⚡ Haiku'

  if (isOpenRouterModel(model)) {
    // Use OpenRouter - it writes files directly, we just need Dockerfile and docker-compose
    await onStatus(`${modelTag} Usando OpenRouter...`)
    await runOpenRouter(dir, name, description, errorContext, model.replace('openrouter/', ''))
  } else {
    // Ejecutar Claude con thinking
    await onStatus(`${modelTag} Analizando requisitos...\n_Pensando..._`)
    try {
      await runClaude(dir, name, description, onStatus, errorContext, model)
      await onStatus(`✅ Código generado exitosamente`)
    } catch (err) {
      throw new Error(`Error generando código: ${err.message}`)
    }
  }

  if (!existsSync(join(dir, 'Dockerfile'))) {
    // OpenRouter might not generate Dockerfile, create a default one
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
      throw new Error('Claude no generó el Dockerfile.')
    }
  }

  writeComposeFile(dir, name)
  await onStatus('🐳 Levantando Docker...')

  const onDockerProgress = async (logs) => {
    const truncated = logs.slice(-1500)
    await onStatus(`🐳 \`\`\`\n${truncated}\n\`\`\``)
  }

  await dockerComposeUp(dir, onDockerProgress)

  await onStatus('🔍 Verificando que arranca...')
  const ip = await getContainerIp(name)

  if (!ip) {
    const logs = await getContainerLogs(name)
    throw new Error(`Container no arrancó.\n${logs.slice(-800)}`)
  }

  await onStatus(`🐳 Container IP: \`${ip}:3000\`\n🔄 Esperando respuesta HTTP...`)

  const onHealthProgress = async (msg) => {
    await onStatus(`🔍 ${msg}`)
  }

  const healthy = await pollHealth(ip, 3000, 40_000, onHealthProgress)
  if (!healthy) {
    const logs = await getContainerLogs(name)
    throw new Error(`App no responde en 40s.\n${logs.slice(-800)}`)
  }

  // Información final
  const containers = await getDocker().listContainers({
    all: true,
    filters: JSON.stringify({ name: [`${name}-app`] }),
  }).catch(() => [])

  const containerInfo = containers[0]
  if (containerInfo) {
    const port = containerInfo.Ports?.[0]?.PublicPort || 'N/A'
    const status = containerInfo.State
    await onStatus(`✅ App en ejecución\n\n📊 Detalles:\n• IP: \`${ip}\`\n• Puerto: \`${port}\`\n• Estado: \`${status}\`\n• Imagen: \`${containerInfo.Image}\``)
  } else {
    await onStatus(`✅ App verificada y ejecutándose\n🔗 \`${ip}:3000\``)
  }
}

async function deployWithRetry(ctx, dir, name, description, action, model = 'claude-sonnet-4-6') {
  let lastError = null
  let lastMsgId = null
  let lastUpdateTime = 0
  const UPDATE_INTERVAL = 2000 // Edita cada 2s, crea msg nuevo cada cambio de etapa

  const modelTag = model.includes('opus') ? '🧠 Opus' : '🚀 Sonnet'

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const onStatus = async (text) => {
      const prefix = attempt > 1 ? `🔄 Reintento ${attempt}/${MAX_RETRIES}\n` : ''
      const fullText = prefix + text

      // Siempre crear nuevo mensaje - esto mantiene el historial visible
      const msg = await ctx.reply(fullText, { parse_mode: 'Markdown' })
      lastMsgId = msg.message_id
    }

    try {
      if (attempt > 1) {
        await onStatus(`🔄 *Reintento ${attempt}/${MAX_RETRIES}*\nClaude está corrigiendo los errores.`)
      }

      await buildAndVerify(dir, name, description, onStatus,
        attempt > 1 ? lastError?.message : null, model)

      return true
    } catch (err) {
      lastError = err
      if (attempt < MAX_RETRIES) {
        await ctx.reply(`⚠️ Intento ${attempt} fallido, reintentando...\n\`${err.message.slice(0, 200)}\``, { parse_mode: 'Markdown' })
        lastMsgId = null // Reset para nuevo ciclo
        await new Promise(r => setTimeout(r, 2000))
      }
    }
  }

  await ctx.reply(`❌ Falló tras ${MAX_RETRIES} intentos:\n\`${lastError?.message?.slice(0, 400)}\``, { parse_mode: 'Markdown' })
  return false
}

export async function deployNew(ctx, name, description, model = 'claude-sonnet-4-6') {
  mkdirSync(projectDir(name), { recursive: true })
  try { execSync(`chown -R vpsbot:vpsbot ${JSON.stringify(projectDir(name))}`) } catch {}
  const ok = await deployWithRetry(ctx, projectDir(name), name, description, 'new', model)
  if (ok) {
    store.set(name, { description, url: projectUrl(name), dir: projectDir(name), model })

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

  const ok = await deployWithRetry(ctx, dir, name, description, 'rebuild', model)
  if (ok) {
    store.set(name, { description, url: projectUrl(name), dir: dir, model })

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