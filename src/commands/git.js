import { execFile } from 'child_process'
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { config } from '../lib/config.js'

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
  const dir = join(config.projectsDir, name)

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

      // Configurar rama a main
      await run('git', ['config', 'init.defaultBranch', 'main'], { cwd: dir })

      // Crear un archivo .gitkeep para garantizar que hay algo que commitear
      writeFileSync(join(dir, '.gitkeep'), '')

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
  const dir = join(config.projectsDir, name)

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
  const dir = join(config.projectsDir, name)

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

    // Verificar si hay remote configurado
    let hasRemote = false
    try {
      const remotes = await run('git', ['remote'], { cwd: dir })
      hasRemote = remotes.trim().length > 0
    } catch {
      hasRemote = false
    }

    if (!hasRemote) {
      return `ℹ️ No hay remote configurado\n\nEste es un repositorio Git local. Para subir a GitHub:\n1. Crea un repo vacío en GitHub\n2. Usa: \`git remote add origin <url>\`\n3. Luego: \`git push -u origin main\``
    }

    // Hacer commit de cambios (automático)
    await run('git', ['add', '.'], { cwd: dir })

    try {
      await run('git', ['commit', '-m', `Cambios en ${new Date().toLocaleString('es-ES')}`], { cwd: dir })
    } catch {
      // No hay cambios para commitear, está bien
    }

    // Obtener la rama actual
    let currentBranch = 'main'
    try {
      currentBranch = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })).trim()
    } catch {
      // Si falla, usar 'main' como default
    }

    let pushCmd = ['push', '-u', 'origin', currentBranch]

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
  const dir = join(config.projectsDir, name)

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

    // Verificar si hay remote configurado
    let hasRemote = false
    try {
      const remotes = await run('git', ['remote'], { cwd: dir })
      hasRemote = remotes.trim().length > 0
    } catch {
      hasRemote = false
    }

    if (!hasRemote) {
      return `ℹ️ No hay remote configurado\n\nEste es un repositorio Git local. Para sincronizar con GitHub:\n1. Crea un repo vacío en GitHub\n2. Usa: \`git remote add origin <url>\`\n3. Luego: \`git pull origin main\``
    }

    // Obtener la rama actual
    let currentBranch = 'main'
    try {
      currentBranch = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })).trim()
    } catch {
      // Si falla, usar 'main' como default
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

    const output = await run('git', ['pull', 'origin', currentBranch], { cwd: dir })
    return `✅ Pull completado\n\`${output.slice(0, 200)}\``
  } catch (err) {
    if (err.message === 'INIT_REPO_NEEDED') {
      throw new Error('INIT_REPO_NEEDED')
    }
    throw new Error(`Error en pull: ${err.message}`)
  }
}

export async function gitStatus(name) {
  const dir = join(config.projectsDir, name)

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
  const dir = join(config.projectsDir, name)

  try {
    const remote = await run('git', ['remote', 'get-url', 'origin'], { cwd: dir })
    return remote.trim()
  } catch {
    return null
  }
}
