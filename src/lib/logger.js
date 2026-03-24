import { appendFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { config } from './config.js'

const LOG_FILE = join(config.projectsDir, 'vps-bot.log')

function timestamp() {
  return new Date().toISOString()
}

function write(level, msg, extra) {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true })
    let line = `[${timestamp()}] ${level} ${msg}`
    if (extra) line += `\n  ${String(extra).replace(/\n/g, '\n  ')}`
    appendFileSync(LOG_FILE, line + '\n')
  } catch { /* never fail */ }
}

export const log = {
  info: (msg, extra) => write('INFO', msg, extra),
  error: (msg, extra) => write('ERROR', msg, extra),
  file: LOG_FILE,
}
