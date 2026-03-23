import { execFile } from 'child_process'
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'

const PROJECTS_DIR = process.env.PROJECTS_DIR ?? '/home/maksym/projects'

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'], ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message))
      else resolve(stdout)
    })
    if (child.stdin) child.stdin.end()
  })
}

export async function initGitRepo(name, gitUrl) {
  const dir = join(PROJECTS_DIR, name)

  try {
    // Verificar si ya es un repo
    await run('git', ['status'], { cwd: dir })
    return true // Ya es un repo
  } catch {
    // No es repo, inicializar
    try {
      await run('git', ['init'], { cwd: dir })
      await run('git', ['config', 'user.email', 'bot@vps.local'], { cwd: dir })
      await run('git', ['config', 'user.name', 'VPS Bot'], { cwd: dir })
      await run('git', ['add', '.'], { cwd: dir })
      await run('git', ['commit', '-m', 'Initial commit'], { cwd: dir })

      if (gitUrl) {
        await run('git', ['remote', 'add', 'origin', gitUrl], { cwd: dir })
      }

      return true
    } catch (err) {
      throw new Error(`Error inicializando repo: ${err.message}`)
    }
  }
}

export async function gitCommit(name, message = null, token = null) {
  const dir = join(PROJECTS_DIR, name)

  try {
    // Hacer commit de cambios
    await run('git', ['add', '.'], { cwd: dir })

    const commitMsg = message || `Cambios en ${new Date().toLocaleString('es-ES')}`
    try {
      await run('git', ['commit', '-m', commitMsg], { cwd: dir })
      return `✅ Commit: "${commitMsg}"`
    } catch (err) {
      if (err.message.includes('nothing to commit')) {
        return `ℹ️ No hay cambios para commitear`
      }
      throw err
    }
  } catch (err) {
    throw new Error(`Error en commit: ${err.message}`)
  }
}

export async function gitPush(name, token = null) {
  const dir = join(PROJECTS_DIR, name)

  try {
    // Verificar si es un repo git
    try {
      await run('git', ['status'], { cwd: dir })
    } catch (err) {
      if (err.message.includes('not a git repository')) {
        throw new Error('NO_GIT_REPO')
      }
      throw err
    }

    // Hacer commit de cambios (automático)
    await run('git', ['add', '.'], { cwd: dir })

    try {
      await run('git', ['commit', '-m', `Cambios en ${new Date().toLocaleString('es-ES')}`], { cwd: dir })
    } catch {
      // No hay cambios para commitear, está bien
    }

    // Push
    let pushCmd = ['push', '-u', 'origin', 'main']

    // Si hay token, usarlo para autenticación
    if (token) {
      try {
        const remoteWithAuth = await run('git', ['remote', 'get-url', 'origin'], { cwd: dir })
        const cleanRemote = remoteWithAuth.trim().replace(/https:\/\/.*@github/, 'https://github')

        if (cleanRemote.includes('github')) {
          const authRemote = cleanRemote.replace('https://', `https://${token}@`)
          await run('git', ['remote', 'set-url', 'origin', authRemote], { cwd: dir })
        }
      } catch {
        // Ignorar errores de remote
      }
    }

    const output = await run('git', pushCmd, { cwd: dir })
    return `✅ Push completado\n\`${output.slice(0, 200)}\``
  } catch (err) {
    if (err.message === 'NO_GIT_REPO') {
      throw new Error('INIT_REPO_NEEDED')
    }
    throw new Error(`Error en push: ${err.message}`)
  }
}

export async function gitPull(name, token = null) {
  const dir = join(PROJECTS_DIR, name)

  try {
    // Verificar si es un repo git
    try {
      await run('git', ['status'], { cwd: dir })
    } catch (err) {
      if (err.message.includes('not a git repository')) {
        throw new Error('INIT_REPO_NEEDED')
      }
      throw err
    }

    // Si hay token, usarlo
    if (token) {
      try {
        const remoteWithAuth = await run('git', ['remote', 'get-url', 'origin'], { cwd: dir })
        const cleanRemote = remoteWithAuth.trim().replace(/https:\/\/.*@github/, 'https://github')

        if (cleanRemote.includes('github')) {
          const authRemote = cleanRemote.replace('https://', `https://${token}@`)
          await run('git', ['remote', 'set-url', 'origin', authRemote], { cwd: dir })
        }
      } catch {
        // Ignorar errores de remote
      }
    }

    const output = await run('git', ['pull', 'origin', 'main'], { cwd: dir })
    return `✅ Pull completado\n\`${output.slice(0, 200)}\``
  } catch (err) {
    if (err.message === 'INIT_REPO_NEEDED') {
      throw new Error('INIT_REPO_NEEDED')
    }
    throw new Error(`Error en pull: ${err.message}`)
  }
}

export async function gitStatus(name) {
  const dir = join(PROJECTS_DIR, name)

  try {
    const status = await run('git', ['status', '--short'], { cwd: dir })
    const log = await run('git', ['log', '--oneline', '-5'], { cwd: dir })

    return `📊 *Status Git*

*Cambios:*
\`${status || 'Sin cambios'}\`

*Últimos commits:*
\`${log}\``
  } catch (err) {
    if (err.message.includes('not a git repository')) {
      throw new Error('INIT_REPO_NEEDED')
    }
    throw new Error(`Error en status: ${err.message}`)
  }
}

export async function getGitRemote(name) {
  const dir = join(PROJECTS_DIR, name)

  try {
    const remote = await run('git', ['remote', 'get-url', 'origin'], { cwd: dir })
    return remote.trim()
  } catch {
    return null
  }
}
