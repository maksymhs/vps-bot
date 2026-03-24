import { spawn } from 'child_process'
import { join } from 'path'
import { config } from './config.js'

/**
 * Code-Server integration — single global instance
 * Serves all projects from PROJECTS_DIR
 * Each project opens via ?folder= query param
 */

let _instance = null

const CODE_SERVER_PORT = parseInt(process.env.CODE_SERVER_BASE_PORT || '8080')

/**
 * Get the base URL for code-server (without folder)
 */
function getBaseUrl() {
  if (config.getNetworkType() === 'domain') {
    return `https://code.${config.domain}`
  }
  return `http://${config.ipAddress || 'localhost'}:${CODE_SERVER_PORT}`
}

/**
 * Start the global code-server instance pointing to PROJECTS_DIR
 */
export async function ensureCodeServer() {
  if (_instance?.pid) {
    try {
      process.kill(_instance.pid, 0)
      return { success: true, url: getBaseUrl(), message: 'Code-Server already running' }
    } catch {
      _instance = null
    }
  }

  const password = process.env.CODE_SERVER_PASSWORD || 'changeme'

  return new Promise((resolve) => {
    try {
      const child = spawn('code-server', [
        '--bind-addr', `0.0.0.0:${CODE_SERVER_PORT}`,
        '--auth', 'password',
        '--disable-telemetry',
        config.projectsDir,
      ], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, PASSWORD: password },
      })

      child.unref()

      _instance = {
        pid: child.pid,
        port: CODE_SERVER_PORT,
        startTime: Date.now(),
      }

      setTimeout(() => {
        resolve({
          success: true,
          url: getBaseUrl(),
          port: CODE_SERVER_PORT,
          message: `Code-Server started on port ${CODE_SERVER_PORT}`,
        })
      }, 1500)
    } catch (err) {
      resolve({
        success: false,
        error: err.message,
        message: 'Failed to start Code-Server. Install with: curl -fsSL https://code-server.dev/install.sh | sh',
      })
    }
  })
}

/**
 * Stop the global code-server instance
 */
export function stopCodeServer() {
  if (!_instance?.pid) {
    return { success: false, message: 'Code-Server not running' }
  }

  try {
    process.kill(-_instance.pid)
    _instance = null
    return { success: true, message: 'Code-Server stopped' }
  } catch (err) {
    _instance = null
    return { success: false, error: err.message }
  }
}

/**
 * Get the code-server URL for a specific project (opens its folder)
 */
export function getCodeServerUrl(projectName) {
  const projectDir = join(config.projectsDir, projectName)
  const base = getBaseUrl()
  return `${base}/?folder=${encodeURIComponent(projectDir)}`
}

/**
 * Get the general code-server URL (no specific folder)
 */
export function getCodeServerBaseUrl() {
  return getBaseUrl()
}

/**
 * Get code-server status
 */
export function getCodeServerStatus() {
  const running = !!_instance?.pid
  let alive = false

  if (running) {
    try {
      process.kill(_instance.pid, 0)
      alive = true
    } catch {
      _instance = null
    }
  }

  return {
    running: alive,
    port: alive ? _instance.port : null,
    uptime: alive ? Date.now() - _instance.startTime : 0,
    url: alive ? getBaseUrl() : null,
  }
}
