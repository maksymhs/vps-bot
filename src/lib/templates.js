import { execSync } from 'child_process'
import { existsSync, readFileSync, cpSync, readdirSync } from 'fs'
import { join } from 'path'
import { config } from './config.js'
import { log } from './logger.js'

const TEMPLATES_DIR = config.templatesDir || '/root/vps-bot-templates'
const TEMPLATES_REPO = config.templatesRepo || 'https://github.com/maksymhs/vps-bot-templates.git'

/**
 * Clone or pull the templates repository.
 * Returns true if templates are available, false otherwise.
 */
export function syncTemplates() {
  try {
    if (existsSync(join(TEMPLATES_DIR, '.git'))) {
      // Already cloned — pull latest
      execSync('git pull --ff-only 2>/dev/null || true', {
        cwd: TEMPLATES_DIR,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30_000,
      })
      log.info('[templates] pulled latest')
    } else {
      // Clone fresh
      execSync(`git clone --depth 1 ${TEMPLATES_REPO} ${TEMPLATES_DIR}`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60_000,
      })
      log.info('[templates] cloned from', TEMPLATES_REPO)
    }
    return true
  } catch (err) {
    log.error('[templates] sync failed', err.message)
    return false
  }
}

/**
 * Load the template catalog (index.json).
 * Returns the array of template entries or [] on failure.
 */
export function loadCatalog() {
  const indexPath = join(TEMPLATES_DIR, 'index.json')
  if (!existsSync(indexPath)) {
    log.error('[templates] index.json not found at', indexPath)
    return []
  }
  try {
    const data = JSON.parse(readFileSync(indexPath, 'utf8'))
    return data.templates || []
  } catch (err) {
    log.error('[templates] failed to parse index.json', err.message)
    return []
  }
}

/**
 * Score how well a template matches a user description.
 * Uses tag matching + description keyword overlap.
 */
function scoreTemplate(template, description) {
  const desc = description.toLowerCase()
  const words = desc.split(/\s+/).filter(w => w.length > 2)

  let score = 0

  // Tag matches (high weight)
  for (const tag of template.tags || []) {
    if (desc.includes(tag.toLowerCase())) {
      score += 3
    }
  }

  // Stack matches
  for (const tech of template.stack || []) {
    if (desc.includes(tech.toLowerCase())) {
      score += 5
    }
  }

  // Description keyword overlap
  const templateDesc = (template.description || '').toLowerCase()
  for (const word of words) {
    if (templateDesc.includes(word)) {
      score += 1
    }
  }

  // Category hint matching
  const categoryHints = {
    api: ['api', 'rest', 'backend', 'endpoint', 'server', 'webhook', 'microservice', 'crud'],
    fullstack: ['dashboard', 'admin', 'panel', 'saas', 'platform', 'fullstack', 'full-stack', 'webapp'],
    frontend: ['react', 'spa', 'interactive', 'tool', 'calculator', 'game', 'widget', 'app'],
    static: ['landing', 'page', 'portfolio', 'blog', 'site', 'website', 'simple', 'html', 'static'],
  }

  const cat = template.category
  if (cat && categoryHints[cat]) {
    for (const hint of categoryHints[cat]) {
      if (desc.includes(hint)) {
        score += 2
      }
    }
  }

  return score
}

/**
 * Find the best matching template for a given description.
 * Returns { template, score } or null if no match above threshold.
 */
export function matchTemplate(description) {
  const catalog = loadCatalog()
  if (!catalog.length) return null

  let best = null
  let bestScore = 0

  for (const tpl of catalog) {
    const score = scoreTemplate(tpl, description)
    if (score > bestScore) {
      bestScore = score
      best = tpl
    }
  }

  // Minimum threshold — if description doesn't match any template well,
  // fall back to generic build (return null)
  if (bestScore < 2) return null

  log.info(`[templates] matched "${best.name}" (score=${bestScore}) for: ${description.slice(0, 80)}`)
  return { template: best, score: bestScore }
}

/**
 * Copy boilerplate files from a template into the project directory.
 * Does NOT overwrite existing files (safe for rebuilds).
 */
export function copyBoilerplate(templateName, projectDir) {
  const boilerplateDir = join(TEMPLATES_DIR, 'templates', templateName, 'boilerplate')
  if (!existsSync(boilerplateDir)) {
    log.error(`[templates] boilerplate not found for "${templateName}"`)
    return false
  }

  try {
    cpSync(boilerplateDir, projectDir, { recursive: true, force: false })
    log.info(`[templates] copied boilerplate "${templateName}" → ${projectDir}`)
    return true
  } catch (err) {
    log.error(`[templates] copy failed for "${templateName}"`, err.message)
    return false
  }
}

/**
 * Read the INSTRUCTIONS.md for a template.
 * Returns the markdown string or null.
 */
export function getInstructions(templateName) {
  const instrPath = join(TEMPLATES_DIR, 'templates', templateName, 'INSTRUCTIONS.md')
  if (!existsSync(instrPath)) return null
  try {
    return readFileSync(instrPath, 'utf8')
  } catch {
    return null
  }
}

/**
 * Get a list of boilerplate files for a template (for prompt context).
 */
export function getBoilerplateFiles(templateName) {
  const boilerplateDir = join(TEMPLATES_DIR, 'templates', templateName, 'boilerplate')
  if (!existsSync(boilerplateDir)) return []

  try {
    const files = []
    const entries = readdirSync(boilerplateDir, { recursive: true, withFileTypes: false })
    for (const entry of entries) {
      if (typeof entry === 'string' && !entry.includes('node_modules')) {
        files.push(entry)
      }
    }
    return files
  } catch {
    return []
  }
}

/**
 * Build the full catalog summary for Claude's prompt context.
 * Used when we want Claude to see all available templates.
 */
export function getCatalogSummary() {
  const catalog = loadCatalog()
  if (!catalog.length) return ''

  return catalog.map(t =>
    `- **${t.displayName}** (${t.name}): ${t.description} [${t.stack.join(', ')}]`
  ).join('\n')
}
