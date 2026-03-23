import { Markup } from 'telegraf'
import Docker from 'dockerode'
import { store } from '../lib/store.js'
import { getUsageText } from '../lib/usage.js'

const docker = new Docker()

// Conversation state for /new project flow
// Map<chatId, { step: 'name'|'desc', msgId: number, name?: string }>
export const pendingNew = new Map()

// Conversation state for rebuild flow
// Map<chatId, { name: string }>
export const pendingRebuild = new Map()

async function containerStatus(projectName) {
  try {
    const list = await docker.listContainers({
      all: true,
      filters: JSON.stringify({ name: [`${projectName}-app`] }),
    })
    return list[0]?.State ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

// ── Main menu ──────────────────────────────────────────────────────────────

export async function showMain(ctx, edit = false) {
  const text = '👾 *VPS Bot*\n\n¿Qué quieres hacer?'
  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback('📊 Estado', 'status'),
      Markup.button.callback('📦 Containers', 'ps'),
    ],
    [Markup.button.callback('🚀 Mis proyectos', 'list')],
    [Markup.button.callback('➕ Nuevo proyecto', 'new')],
    [Markup.button.callback('⚡ Claude Usage', 'usage')],
  ])
  return edit
    ? ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb })
    : ctx.reply(text, { parse_mode: 'Markdown', ...kb })
}

// ── Project list ───────────────────────────────────────────────────────────

export async function showList(ctx) {
  const projects = store.getAll()
  const names = Object.keys(projects)
  const back = Markup.button.callback('⬅️ Menú', 'main')

  if (!names.length) {
    return ctx.editMessageText('📁 *Proyectos*\n\nNo hay proyectos aún.', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('➕ Crear proyecto', 'new')],
        [back],
      ]),
    })
  }

  const rows = names.map(n => [Markup.button.callback(`📦 ${n}`, `p:${n}`)])
  rows.push([Markup.button.callback('➕ Nuevo', 'new'), back])

  return ctx.editMessageText('📁 *Proyectos*\n\nSelecciona uno:', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(rows),
  })
}

// ── Project detail menu ────────────────────────────────────────────────────

export async function showProject(ctx, name) {
  const project = store.get(name)
  if (!project) {
    return ctx.editMessageText(`Proyecto *${name}* no encontrado.`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Lista', 'list')]]),
    })
  }

  const status = await containerStatus(name)
  const icon = status === 'running' ? '🟢' : '🔴'
  const desc = (project.description ?? '').slice(0, 120)

  const toggleBtn = status === 'running'
    ? Markup.button.callback('🛑 Stop', `st:${name}`)
    : Markup.button.callback('▶️ Start', `go:${name}`)

  return ctx.editMessageText(
    `📦 *${name}*  ${icon}\n\n🔗 ${project.url}\n_${desc}_`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('♻️ Rebuild', `rb:${name}`), Markup.button.callback('📋 Logs', `lg:${name}`)],
        [toggleBtn, Markup.button.callback('🔗 Copiar URL', `url:${name}`)],
        [Markup.button.callback('📤 Push', `gp:${name}`), Markup.button.callback('📥 Pull', `gpl:${name}`)],
        [Markup.button.callback('📊 Git Status', `gs:${name}`), Markup.button.callback('⬅️ Lista', 'list')],
        [Markup.button.callback('🗑️ Eliminar', `del:${name}`)],
      ]),
    }
  )
}

// ── Delete confirmation ────────────────────────────────────────────────────

export async function showDeleteConfirm(ctx, name) {
  return ctx.editMessageText(
    `⚠️ ¿Eliminar *${name}*?\n\nSe borrará el container, imagen y todos los archivos.`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[
        Markup.button.callback('✅ Sí, eliminar', `del_ok:${name}`),
        Markup.button.callback('❌ Cancelar', `p:${name}`),
      ]]),
    }
  )
}

// ── Rebuild conversation ───────────────────────────────────────────────────

export async function startRebuildFlow(ctx, name) {
  const project = store.get(name)
  const desc = (project?.description ?? '').slice(0, 200)
  return ctx.editMessageText(
    `♻️ *Rebuild: ${name}*\n\n📝 Descripción actual:\n_${desc}_\n\n¿Cómo quieres proceder?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✏️ Añadir cambios', `rb_patch:${name}`)],
        [Markup.button.callback('🔁 Rehacer todo', `rb_full:${name}`)],
        [Markup.button.callback('❌ Cancelar', `p:${name}`)],
      ]),
    }
  )
}

export async function startRebuildPatch(ctx, name) {
  pendingRebuild.set(ctx.chat.id, { name, mode: 'patch', step: 'text' })
  return ctx.editMessageText(
    `✏️ *Cambios para ${name}*\n\nEscribe qué quieres cambiar (color, layout, funcionalidad...):`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', `p:${name}`)]]),
    }
  )
}

export async function startRebuildFull(ctx, name) {
  pendingRebuild.set(ctx.chat.id, { name, mode: 'full', step: 'text' })
  return ctx.editMessageText(
    `🔁 *Rehacer ${name}*\n\nEscribe la nueva descripción completa del proyecto:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', `p:${name}`)]]),
    }
  )
}

export function showModelSelect(ctx, prefix, name, edit = false) {
  const text = `🤖 *Elige el modelo*\n\n🚀 *Sonnet* — rápido y eficiente _(recomendado)_\n🧠 *Opus* — más potente, más lento\n⚡ *Haiku* — ultrarrápido, perfecta para tareas simples`

  const kb = [
    [
      Markup.button.callback('🚀 Sonnet', `${prefix}:sonnet:${name}`),
      Markup.button.callback('🧠 Opus', `${prefix}:opus:${name}`),
    ],
    [
      Markup.button.callback('⚡ Haiku', `${prefix}:haiku:${name}`),
    ],
    [Markup.button.callback('❌ Cancelar', `p:${name}`)],
  ]

  return edit
    ? ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(kb) })
    : ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(kb) })
}

// ── New project conversation ───────────────────────────────────────────────

export async function startNewFlow(ctx) {
  pendingNew.set(ctx.chat.id, { step: 'name' })
  return ctx.editMessageText(
    '➕ *Nuevo proyecto*\n\n¿Cómo se llamará? (solo letras, números y guiones)',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'list')]]),
    }
  )
}