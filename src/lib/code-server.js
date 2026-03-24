import { spawn } from 'child_process'
import { config } from './config.js'
import { store } from './store.js'

/**
 * Code-Server integration for each project
 * Provides VS Code in the browser for project editing
 */

const codeServerProcesses = new Map()

/**
 * Get next available port for code-server
 * Starting from CODE_SERVER_BASE_PORT
 */
function getNextPort() {
  const basePort = parseInt(process.env.CODE_SERVER_BASE_PORT || '8000')
  let port = basePort

  // Check for used ports
  for (const [, info] of codeServerProcesses) {
    if (info.port >= port) {
      port = info.port + 1
    }
  }

  return port
}

/**
 * Start code-server for a project
 */
export async function startCodeServer(projectName, projectDir) {
  // Check if already running
  if (codeServerProcesses.has(projectName)) {
    const info = codeServerProcesses.get(projectName)
    return {
      success: true,
      port: info.port,
      url: generateCodeServerUrl(projectName, info.port),
      message: 'Code-Server already running',
    }
  }

  const port = getNextPort()
  const password = process.env.CODE_SERVER_PASSWORD

  return new Promise((resolve) => {
    try {
      // Try to start code-server
      const child = spawn('code-server', [
        '--bind', `127.0.0.1:${port}`,
        '--password', password,
        '--disable-telemetry',
        '--no-auth',
        projectDir,
      ], {
        detached: true,
        stdio: 'ignore',
      })

      child.unref()

      // Store process info
      codeServerProcesses.set(projectName, {
        port,
        pid: child.pid,
        startTime: Date.now(),
      })

      // Update project with code-server info
      const project = store.get(projectName)
      if (project) {
        store.set(projectName, {
          ...project,
          codeServerPort: port,
        })
      }

      // Give it a moment to start
      setTimeout(() => {
        resolve({
          success: true,
          port,
          url: generateCodeServerUrl(projectName, port),
          message: `Code-Server started on port ${port}`,
        })
      }, 1000)
    } catch (err) {
      resolve({
        success: false,
        error: err.message,
        message: 'Failed to start Code-Server. Make sure it\'s installed: npm install -g code-server',
      })
    }
  })
}

/**
 * Stop code-server for a project
 */
export function stopCodeServer(projectName) {
  if (!codeServerProcesses.has(projectName)) {
    return { success: false, message: 'Code-Server not running' }
  }

  try {
    const info = codeServerProcesses.get(projectName)
    process.kill(-info.pid) // Kill process group
    codeServerProcesses.delete(projectName)

    // Update project
    const project = store.get(projectName)
    if (project) {
      const { codeServerPort, ...rest } = project
      store.set(projectName, rest)
    }

    return { success: true, message: 'Code-Server stopped' }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * Get code-server URL for a project
 */
export function getCodeServerUrl(projectName) {
  const info = codeServerProcesses.get(projectName)
  if (!info) return null

  return generateCodeServerUrl(projectName, info.port)
}

/**
 * Generate full code-server URL
 */
function generateCodeServerUrl(projectName, port) {
  const password = process.env.CODE_SERVER_PASSWORD
  if (config.getNetworkType() === 'domain') {
    // For domain mode, use subdomain
    return `https://${projectName}-code.${config.domain}/?password=${password}`
  } else {
    // For IP mode, use direct port
    return `http://${config.ipAddress}:${port}/?password=${password}`
  }
}

/**
 * Get status of code-server for a project
 */
export function getCodeServerStatus(projectName) {
  const info = codeServerProcesses.get(projectName)
  return {
    running: !!info,
    port: info?.port,
    uptime: info ? Date.now() - info.startTime : 0,
    url: info ? generateCodeServerUrl(projectName, info.port) : null,
  }
}

/**
 * List all running code-servers
 */
export function listCodeServers() {
  const list = []
  for (const [name, info] of codeServerProcesses) {
    list.push({
      project: name,
      port: info.port,
      uptime: Date.now() - info.startTime,
      url: generateCodeServerUrl(name, info.port),
    })
  }
  return list
}
