import 'dotenv/config'
import { Telegraf } from 'telegraf'
import { execFile } from 'child_process'
import { statusCommand } from './commands/status.js'
import { psCommand, logsCommand, restartCommand, stopCommand, startCommand } from './commands/docker.js'
import { newCommand, rebuildCommand, listCommand, urlCommand, deleteProjectCommand, deployNew, deployRebuild } from './commands/projects.js'
import { showMain, showList, showProject, showDeleteConfirm, startNewFlow, pendingNew, startRebuildFlow, startRebuildPatch, startRebuildFull, pendingRebuild, showModelSelect, showGitMenu } from './commands/menu.js'
import { store } from './lib/store.js'
import { getUsageText } from './lib/usage.js'
import { gitPush, gitPull, gitStatus } from './commands/git.js'
import Docker from 'dockerode'
import { existsSync, rmSync } from 'fs'

const bot = new Telegraf(process.env.BOT_TOKEN)
const ALLOWED_CHAT_ID = parseInt(process.env.CHAT_ID)
const PROJECTS_DIR = process.env.PROJECTS_DIR ?? '/home/maksym/projects'
const docker = new Docker()

const building = new Set()

// Sends a project menu as a new message (not edit)
async function sendProjectMenu(ctx, name) {
  const { Markup } = await import('telegraf')
  const project = store.get(name)
  if (!project) return
  const containers = await docker.listContainers({ all: true, filters: JSON.stringify({ name: [`${name}-app`] }) }).catch(() => [])
  const status = containers[0]?.State ?? 'unknown'
  const icon = status === 'running' ? '🟢' : '🔴'
  const desc = (project.description ?? '').slice(0, 120)
  const toggleBtn = status === 'running'
    ? Markup.button.callback('🛑 Stop', `st:${name}`)
    : Markup.button.callback('▶️ Start', `go:${name}`)
  return ctx.reply(`📦 *${name}*  ${icon}\n\n🔗 ${project.url}\n_${desc}_`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('♻️ Rebuild', `rb:${name}`), Markup.button.callback('📋 Logs', `lg:${name}`)],
      [toggleBtn, Markup.button.callback('🔗 Copiar URL', `url:${name}`)],
      [Markup.button.callback('🗑️ Eliminar', `del:${name}`), Markup.button.callback('⬅️ Lista', 'list')],
    ]),
  })
}

// ── Auth middleware ────────────────────────────────────────────────────────

bot.use((ctx, next) => {
  if (ctx.chat?.id !== ALLOWED_CHAT_ID) return ctx.reply('⛔ No autorizado')
  return next()
})

// ── Text commands ──────────────────────────────────────────────────────────

bot.start((ctx) => showMain(ctx))

bot.command('menu', (ctx) => showMain(ctx))
bot.command('status', statusCommand)
bot.command('ps', psCommand)
bot.command('logs', logsCommand)
bot.command('restart', restartCommand)
bot.command('stop', stopCommand)
bot.command('start', startCommand)
bot.command('new', newCommand)
bot.command('rebuild', rebuildCommand)
bot.command('list', (ctx) => listCommand(ctx))
bot.command('url', urlCommand)
bot.command('delete', deleteProjectCommand)

// ── Conversational flow (new project via buttons) ──────────────────────────

bot.on('text', async (ctx, next) => {
  // Rebuild flow
  const rebuildState = pendingRebuild.get(ctx.chat.id)
  if (rebuildState) {
    const { name, mode } = rebuildState
    const project = store.get(name)
    if (!project) { pendingRebuild.delete(ctx.chat.id); return ctx.reply(`Proyecto "${name}" no encontrado.`) }

    const input = ctx.message.text.trim()
    const description = mode === 'patch'
      ? `${project.description}\n\nCambios solicitados: ${input}`
      : input

    pendingRebuild.set(ctx.chat.id, { name, mode, description, step: 'model' })
    return showModelSelect(ctx, 'rbm', name)
  }

  const state = pendingNew.get(ctx.chat.id)
  if (!state) return next()

  if (state.step === 'name') {
    const name = ctx.message.text.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
    if (!name) return ctx.reply('Nombre inválido. Solo letras, números y guiones.')
    if (store.get(name)) {
      return ctx.reply(`Ya existe "${name}". Escribe otro nombre o /menu para cancelar.`)
    }
    pendingNew.set(ctx.chat.id, { step: 'desc', name })
    return ctx.reply(`✅ Nombre: *${name}*\n\n¿Descripción del proyecto?`, { parse_mode: 'Markdown' })
  }

  if (state.step === 'desc') {
    const { name } = state
    const description = ctx.message.text.trim()
    pendingNew.set(ctx.chat.id, { step: 'model', name, description })
    return showModelSelect(ctx, 'nbm', name)
  }

})

// ── Inline button actions ──────────────────────────────────────────────────

function answer(ctx) {
  return ctx.answerCbQuery().catch(() => {})
}

// Navigation
bot.action('main', async (ctx) => { await answer(ctx); await showMain(ctx, true) })
bot.action('list', async (ctx) => { await answer(ctx); await showList(ctx) })
bot.action('usage', async (ctx) => {
  await answer(ctx)
  const { Markup } = await import('telegraf')
  const text = getUsageText()
  await ctx.editMessageText(text + '\n\n⬅️ _Vuelve al menú_', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Menú', 'main')]]),
  })
})

// Git operations
bot.action(/^gp:(.+)$/, async (ctx) => {
  await answer(ctx)
  const name = ctx.match[1]
  await ctx.editMessageText(`📤 *Push en progreso...*`, { parse_mode: 'Markdown' })
  try {
    const result = await gitPush(name)
    await ctx.editMessageText(`${result}\n\n⬅️ _Vuelve al proyecto_`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver', `p:${name}`)]])
    })
  } catch (err) {
    await ctx.editMessageText(`❌ Error: ${err.message.slice(0, 200)}`, { parse_mode: 'Markdown' })
  }
})

bot.action(/^gpl:(.+)$/, async (ctx) => {
  await answer(ctx)
  const name = ctx.match[1]
  await ctx.editMessageText(`📥 *Pull en progreso...*`, { parse_mode: 'Markdown' })
  try {
    const result = await gitPull(name)
    await ctx.editMessageText(`${result}\n\n⬅️ _Vuelve al proyecto_`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver', `p:${name}`)]])
    })
  } catch (err) {
    await ctx.editMessageText(`❌ Error: ${err.message.slice(0, 200)}`, { parse_mode: 'Markdown' })
  }
})

bot.action(/^gs:(.+)$/, async (ctx) => {
  await answer(ctx)
  const name = ctx.match[1]
  try {
    const result = await gitStatus(name)
    await ctx.editMessageText(`${result}\n\n⬅️ _Vuelve al proyecto_`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver', `p:${name}`)]])
    })
  } catch (err) {
    await ctx.editMessageText(`❌ Error: ${err.message.slice(0, 200)}`, { parse_mode: 'Markdown' })
  }
})

// Git menu
bot.action(/^git_menu:(.+)$/, async (ctx) => {
  await answer(ctx)
  await showGitMenu(ctx, ctx.match[1])
})

// Inicializar repositorio
bot.action(/^git_init:(.+)$/, async (ctx) => {
  await answer(ctx)
  const name = ctx.match[1]
  const { Markup } = await import('telegraf')
  await ctx.editMessageText(`🔧 *Inicializar Git Repo*\n\n¿Público o Privado?`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🌍 Público', `git_pub:${name}`), Markup.button.callback('🔒 Privado', `git_priv:${name}`)],
      [Markup.button.callback('⬅️ Volver', `git_menu:${name}`)],
    ]),
  })
})

bot.action(/^git_pub:(.+)$/, async (ctx) => {
  await answer(ctx)
  const name = ctx.match[1]
  await ctx.editMessageText(`📝 *Escribe URL del repo público*\n\n_O escribe "skip" para omitir_\n\nEjemplo: https://github.com/usuario/repo.git`, {
    parse_mode: 'Markdown'
  })
  const pendingGitInit = new Map()
  pendingGitInit.set(ctx.chat.id, { name, private: false })
})

bot.action(/^git_priv:(.+)$/, async (ctx) => {
  await answer(ctx)
  const name = ctx.match[1]
  await ctx.editMessageText(`📝 *Escribe URL del repo privado*\n\n_O escribe "skip" para omitir_\n\nEjemplo: https://github.com/usuario/repo.git`, {
    parse_mode: 'Markdown'
  })
  const pendingGitInit = new Map()
  pendingGitInit.set(ctx.chat.id, { name, private: true })
})

// Commit personalizado
bot.action(/^git_commit:(.+)$/, async (ctx) => {
  await answer(ctx)
  const name = ctx.match[1]
  await ctx.editMessageText(`💬 *Escribe el mensaje de commit*\n\nEjemplo: "Agregar validación al formulario"`, {
    parse_mode: 'Markdown'
  })
  const pendingGitCommit = new Map()
  pendingGitCommit.set(ctx.chat.id, { name })
})

bot.action('status', async (ctx) => {
  await answer(ctx)
  // Run status and show result + back button inline
  const { Markup } = await import('telegraf')
  const si = await import('systeminformation')
  const [cpu, mem, disk] = await Promise.all([si.default.currentLoad(), si.default.mem(), si.default.fsSize()])
  const gb = b => (b / 1024 ** 3).toFixed(1)
  const pct = n => Math.round(n)
  const d = disk.find(d => d.mount === '/') || disk[0]
  const text =
    `🖥 *Estado del servidor*\n\n` +
    `*CPU:* ${pct(cpu.currentLoad)}%\n` +
    `*RAM:* ${gb(mem.used)}GB / ${gb(mem.total)}GB (${pct(mem.used / mem.total * 100)}%)\n` +
    `*Disco:* ${gb(d.used)}GB / ${gb(d.size)}GB (${pct(d.use)}%)`
  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Menú', 'main')]]),
  })
})
bot.action('ps', async (ctx) => {
  await answer(ctx)
  const { Markup } = await import('telegraf')
  const containers = await docker.listContainers({ all: true })
  const lines = containers.length
    ? containers.map(c => {
        const n = c.Names[0].replace('/', '')
        const icon = c.State === 'running' ? '🟢' : '🔴'
        return `${icon} \`${n}\` — ${c.Status}`
      }).join('\n')
    : 'No hay containers.'
  await ctx.editMessageText(lines, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Menú', 'main')]]),
  })
})

// New project
bot.action('new', async (ctx) => { await answer(ctx); await startNewFlow(ctx) })

// Project menu
bot.action(/^p:(.+)$/, async (ctx) => {
  await answer(ctx)
  await showProject(ctx, ctx.match[1])
})

// Rebuild — ask for changes first
bot.action(/^rb:(.+)$/, async (ctx) => {
  await answer(ctx)
  const name = ctx.match[1]
  if (!store.get(name)) return ctx.editMessageText(`Proyecto "${name}" no encontrado.`)
  if (building.has(name)) return ctx.answerCbQuery('Ya se está construyendo...', { show_alert: true })
  await startRebuildFlow(ctx, name)
})

// Rebuild — pick mode
bot.action(/^rb_patch:(.+)$/, async (ctx) => {
  await answer(ctx)
  await startRebuildPatch(ctx, ctx.match[1])
})

bot.action(/^rb_full:(.+)$/, async (ctx) => {
  await answer(ctx)
  await startRebuildFull(ctx, ctx.match[1])
})

// Logs
bot.action(/^lg:(.+)$/, async (ctx) => {
  await answer(ctx)
  const { Markup } = await import('telegraf')
  const name = ctx.match[1]
  try {
    const containers = await docker.listContainers({
      all: true,
      filters: JSON.stringify({ name: [`${name}-app`] }),
    })
    if (!containers.length) return ctx.editMessageText(`Container "${name}" no encontrado.`)
    const stream = await docker.getContainer(containers[0].Id).logs({ stdout: true, stderr: true, tail: 40 })
    const text = (Buffer.isBuffer(stream) ? stream.toString() : String(stream)).slice(-3500).trim() || '(sin logs)'
    await ctx.editMessageText(`\`\`\`\n${text}\n\`\`\``, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Actualizar', `lg:${name}`), Markup.button.callback('⬅️ Proyecto', `p:${name}`)],
      ]),
    })
  } catch (err) {
    await ctx.editMessageText(`Error: ${err.message}`)
  }
})

// Stop
bot.action(/^st:(.+)$/, async (ctx) => {
  await answer(ctx)
  const name = ctx.match[1]
  try {
    const containers = await docker.listContainers({ filters: JSON.stringify({ name: [`${name}-app`] }) })
    if (containers.length) await docker.getContainer(containers[0].Id).stop()
    await showProject(ctx, name)
  } catch (err) {
    await ctx.answerCbQuery(`Error: ${err.message}`, { show_alert: true })
    await showProject(ctx, name)
  }
})

// Start
bot.action(/^go:(.+)$/, async (ctx) => {
  await answer(ctx)
  const name = ctx.match[1]
  try {
    const containers = await docker.listContainers({ all: true, filters: JSON.stringify({ name: [`${name}-app`] }) })
    if (containers.length) await docker.getContainer(containers[0].Id).start()
    await showProject(ctx, name)
  } catch (err) {
    await ctx.answerCbQuery(`Error: ${err.message}`, { show_alert: true })
    await showProject(ctx, name)
  }
})

// URL
bot.action(/^url:(.+)$/, async (ctx) => {
  const name = ctx.match[1]
  const project = store.get(name)
  await ctx.answerCbQuery(project ? project.url : 'No encontrado', { show_alert: true }).catch(() => {})
})

// Delete confirm
bot.action(/^del:(.+)$/, async (ctx) => {
  await answer(ctx)
  await showDeleteConfirm(ctx, ctx.match[1])
})

// Delete confirmed
bot.action(/^del_ok:(.+)$/, async (ctx) => {
  await answer(ctx)
  const { Markup } = await import('telegraf')
  const name = ctx.match[1]
  const project = store.get(name)
  if (!project) return ctx.editMessageText('Proyecto no encontrado.')

  await ctx.editMessageText(`🗑️ Eliminando *${name}*...`, { parse_mode: 'Markdown' })

  try {
    const dir = `${PROJECTS_DIR}/${name}`
    await new Promise((res) => {
      execFile('docker', ['compose', 'down', '--rmi', 'local'], { cwd: dir }, () => res())
    })

    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    store.delete(name)
    await showList(ctx)
  } catch (err) {
    await ctx.editMessageText(`❌ Error: ${err.message.slice(0, 300)}`)
  }
})

// Model selection — new project
bot.action(/^nbm:(sonnet|opus|haiku):(.+)$/, async (ctx) => {
  await answer(ctx)
  const modelMap = {
    sonnet: 'claude-sonnet-4-6',
    opus: 'claude-opus-4-6',
    haiku: 'claude-haiku-4-5-20251001',
  }
  const model = modelMap[ctx.match[1]] || 'claude-sonnet-4-6'
  const name = ctx.match[2]
  const state = pendingNew.get(ctx.chat.id)
  if (!state || state.step !== 'model' || state.name !== name) return ctx.editMessageText('Sesión expirada. Usa /menu.')
  pendingNew.delete(ctx.chat.id)

  if (building.has(name)) return ctx.answerCbQuery('Ya se está construyendo...', { show_alert: true })
  building.add(name)

  // Start deploy in background to avoid timeout
  deployNew(ctx, name, state.description, model)
    .then(ok => {
      if (ok) {
        const url = `https://${name}.${process.env.DOMAIN ?? 'maksym.site'}`
        ctx.reply(`✅ *${name}* listo!\n\n🔗 ${url}`, { parse_mode: 'Markdown' }).catch(() => {})
        sendProjectMenu(ctx, name).catch(() => {})
      }
    })
    .catch(err => console.error('Error en deploy:', err))
    .finally(() => building.delete(name))
})

// Model selection — rebuild
bot.action(/^rbm:(sonnet|opus|haiku):(.+)$/, async (ctx) => {
  await answer(ctx)
  const modelMap = {
    sonnet: 'claude-sonnet-4-6',
    opus: 'claude-opus-4-6',
    haiku: 'claude-haiku-4-5-20251001',
  }
  const model = modelMap[ctx.match[1]] || 'claude-sonnet-4-6'
  const name = ctx.match[2]
  const state = pendingRebuild.get(ctx.chat.id)
  if (!state || state.step !== 'model' || state.name !== name) return ctx.editMessageText('Sesión expirada. Usa /menu.')
  pendingRebuild.delete(ctx.chat.id)

  const project = store.get(name)
  if (!project) return ctx.editMessageText(`Proyecto "${name}" no encontrado.`)
  if (building.has(name)) return ctx.answerCbQuery('Ya se está construyendo...', { show_alert: true })

  building.add(name)

  // Start deploy in background to avoid timeout
  deployRebuild(ctx, name, state.description, model)
    .then(ok => {
      if (ok) showProject(ctx, name).catch(() => {})
    })
    .catch(err => console.error('Error en rebuild:', err))
    .finally(() => building.delete(name))
})

// ── Launch ─────────────────────────────────────────────────────────────────

bot.catch((err, ctx) => {
  console.error(`Error en update ${ctx?.updateType}:`, err.message)
  if (err.message.includes('path')) {
    console.error('Full error:', err)
  }
})

bot.launch()
console.log('Bot arrancado')

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))