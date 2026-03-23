import { spawn } from 'child_process'

const MAX_MESSAGE_LENGTH = 4000
const UPDATE_INTERVAL = 1000 // ms entre actualizaciones
const MAX_LINES_BUFFER = 50 // últimas N líneas

/**
 * Ejecuta un comando y muestra output dinámico en Telegram
 * @param {string} cmd - Comando a ejecutar
 * @param {string[]} args - Argumentos
 * @param {Object} options - { cwd, ctx, msgId, prefix, timeout }
 */
export async function runLiveConsole(cmd, args, options = {}) {
  const { cwd, ctx, msgId, prefix = '⏳', timeout = 300000 } = options

  return new Promise((resolve, reject) => {
    const lines = []
    let lastUpdate = Date.now()
    let timer = null
    let hasError = false

    const child = spawn(cmd, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    })

    // Procesar stdout
    if (child.stdout) {
      child.stdout.on('data', (data) => {
        const text = data.toString()
        lines.push(...text.split('\n').filter(l => l.trim()))
        scheduleUpdate()
      })
    }

    // Procesar stderr
    if (child.stderr) {
      child.stderr.on('data', (data) => {
        const text = data.toString()
        lines.push(`❌ ${text}`)
        hasError = true
        scheduleUpdate()
      })
    }

    // Actualizar mensaje en Telegram
    const scheduleUpdate = () => {
      const now = Date.now()
      if (now - lastUpdate > UPDATE_INTERVAL) {
        updateMessage()
      } else if (!timer) {
        timer = setTimeout(() => {
          updateMessage()
          timer = null
        }, UPDATE_INTERVAL)
      }
    }

    const updateMessage = async () => {
      lastUpdate = Date.now()
      const content = formatConsole(lines, prefix)
      try {
        await ctx.telegram.editMessageText(ctx.chat.id, msgId, undefined, content, {
          parse_mode: 'Markdown',
        })
      } catch (err) {
        // Ignorar errores de rate limit
        if (!err.message?.includes('Too Many Requests')) {
          console.error('Error updating message:', err.message)
        }
      }
    }

    // Timeout
    const timeoutHandle = setTimeout(() => {
      child.kill()
      reject(new Error(`Comando excedió timeout (${timeout / 1000}s)`))
    }, timeout)

    child.on('error', (err) => {
      clearTimeout(timeoutHandle)
      if (timer) clearTimeout(timer)
      reject(new Error(`Error ejecutando comando: ${err.message}`))
    })

    child.on('close', async (code) => {
      clearTimeout(timeoutHandle)
      if (timer) clearTimeout(timer)

      // Actualización final
      await updateMessage()

      if (code !== 0) {
        reject(new Error(`Comando falló con código ${code}\n${lines.slice(-5).join('\n')}`))
      } else {
        resolve(lines.join('\n'))
      }
    })

    // Cerrar stdin
    if (child.stdin) child.stdin.end()
  })
}

/**
 * Formatea líneas de consola para Telegram
 */
function formatConsole(lines, prefix = '⏳') {
  if (lines.length === 0) return `${prefix} Ejecutando...`

  // Mantener últimas N líneas
  const recent = lines.slice(-MAX_LINES_BUFFER)
  let content = recent.join('\n')

  // Truncar si es muy largo
  if (content.length > MAX_MESSAGE_LENGTH) {
    content = `...\n${content.slice(-MAX_MESSAGE_LENGTH + 10)}`
  }

  return `\`\`\`\n${content}\n\`\`\`\n${prefix}`
}

/**
 * Ejecuta comando simple y retorna output (para compatibilidad)
 */
export function runLiveConsoleSimple(cmd, args, options = {}) {
  return runLiveConsole(cmd, args, options)
}
