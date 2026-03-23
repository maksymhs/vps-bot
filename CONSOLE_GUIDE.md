# Guía: Consola Dinámica en Telegram

Tu bot ahora muestra output en **vivo** como si fuera una consola. Aquí está cómo funciona.

## ✨ Características

- 📋 **Logs en vivo**: Muestra logs mientras se actualizan (`/logs <nombre>`)
- 🐳 **Docker build en vivo**: Ve el progreso del build en tiempo real
- ⚡ **Actualizaciones automáticas**: El mensaje se actualiza cada 1-2 segundos
- 📏 **Respeta límites de Telegram**: Trunca inteligentemente si es muy largo

## 🔧 Uso en Comandos

### 1. Docker Logs (YA IMPLEMENTADO)
```javascript
// En commands/docker.js - logsCommand
// Muestra logs con --follow, actualizándose en vivo
await runLiveLogsStream(ctx, msg.message_id, containerName, 30)
```

**Resultado en Telegram:**
```
📋 ```
2026-03-23T21:15:45 Server running
2026-03-23T21:15:46 Connected to DB
⏸️
```

### 2. Docker Compose Build (YA IMPLEMENTADO)
```javascript
// En commands/projects.js - buildAndVerify
const onDockerProgress = async (logs) => {
  const truncated = logs.slice(-1500)
  await onStatus(`🐳 \`\`\`\n${truncated}\n\`\`\``)
}
await dockerComposeUp(dir, onDockerProgress)
```

**Resultado en Telegram:**
```
🐳 ```
[+] Building 12.3s (5/15)
 => [base 2/4] RUN npm install
 => [app builder 3/3] COPY . .
```

### 3. Crear tu propio comando con streaming

```javascript
import { runWithStreaming } from '../lib/console.js'

export async function miComandoCommand(ctx) {
  const msg = await ctx.reply('⏳ Ejecutando...')
  const lines = []

  try {
    await runWithStreaming('npm', ['install'], {
      cwd: '/path/to/project',
      onData: (chunk) => {
        lines.push(chunk)
        // Actualizar cada 2 segundos
        if (lines.length % 50 === 0) {
          ctx.telegram.editMessageText(
            ctx.chat.id,
            msg.message_id,
            undefined,
            `📦 \`\`\`\n${lines.slice(-20).join('')}\n\`\`\``
          )
        }
      }
    })

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      msg.message_id,
      undefined,
      '✅ ¡Completo!'
    )
  } catch (err) {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      msg.message_id,
      undefined,
      `❌ Error: ${err.message}`
    )
  }
}
```

## 📊 Flujo Completo: Crear App Nueva

Cuando ejecutas `/new myapp "una api rest"`, ves en **tiempo real**:

**Etapa 1: Generando Código (2-5 min)**
```
🚀 Sonnet Generando código...
```
package.json
src/index.js
Dockerfile
.dockerignore
```
```

**Etapa 2: Levantando Docker (1-2 min)**
```
🐳 ```
[+] Building 45.2s (5/15)
 => [base 2/4] RUN npm install
 => [app builder 3/3] COPY . .
 => [final] FROM node:20-alpine
```
```

**Etapa 3: Verificando (20-30 seg)**
```
🔍 Intento 1: conectando a http://172.18.0.2:3000...
🔍 Intento 2: conectando a http://172.18.0.2:3000...
🔍 Intento 3: ✅ Respuesta OK
```

**Etapa 4: Completo**
```
✅ App verificada y ejecutándose
🔗 https://myapp.maksym.site
```

---

## 📋 Funciones disponibles

### `runLiveLogsStream(ctx, msgId, containerName, timeout)`
Obtiene logs en vivo de un contenedor Docker.
- `ctx`: Context de Telegraf
- `msgId`: ID del mensaje a editar
- `containerName`: Nombre del contenedor
- `timeout`: Segundos a ejecutar (default 30)

### `dockerComposeUp(dir, onProgress)`
Levanta compose con salida en vivo.
- `dir`: Directorio del proyecto
- `onProgress(logs)`: Callback con últimas líneas (opcional)

### `runWithStreaming(cmd, args, opts)`
Ejecuta comando con streaming.
- `cmd`: Comando
- `args`: Argumentos
- `opts.cwd`: Directorio de trabajo
- `opts.onData(chunk)`: Callback con cada chunk

## 🎨 Formateo de Salida

Usa bloques de código para mejor presentación:
```javascript
// ❌ Malo
await ctx.reply(`Output: ${logs}`)

// ✅ Bueno
await ctx.reply(`\`\`\`\n${logs}\n\`\`\``)

// ✅ Aún mejor con emoji
await ctx.reply(`🐳 \`\`\`\n${logs}\n\`\`\` ✅`)
```

## ⚙️ Límites y Consideraciones

- Máximo 4000 caracteres por mensaje en Telegram
- Se muestran últimas 50 líneas / se trunca lo antiguo
- Actualizaciones cada 1-2 segundos (evita rate limit)
- Timeout recomendado: 300s para builds, 30s para logs

## 🔄 Ejemplo Completo: Deploy con Consola

```javascript
export async function deployCommand(ctx, name) {
  // Mensaje inicial
  const msg = await ctx.reply(`⏳ Iniciando deploy de ${name}...`)

  const updateConsole = (status, logs) => {
    return ctx.telegram.editMessageText(
      ctx.chat.id,
      msg.message_id,
      undefined,
      `${status}\n\`\`\`\n${logs}\n\`\`\``,
      { parse_mode: 'Markdown' }
    )
  }

  try {
    // 1. Building
    await updateConsole('🏗️ Construyendo...', 'Iniciando build...')
    await dockerComposeUp(projectDir(name), (logs) => {
      return updateConsole('🏗️ Construyendo...', logs.slice(-1500))
    })

    // 2. Verificando
    await updateConsole('🔍 Verificando...', 'Esperando respuesta...')
    const healthy = await checkHealth(name)

    // 3. Completo
    await updateConsole('✅ Deploy completo', 'El proyecto está activo')

  } catch (err) {
    await updateConsole('❌ Error', err.message)
  }
}
```

---

**Tip**: Siempre usa `parse_mode: 'Markdown'` para que los bloques `` ``` `` funcionen correctamente.
