# VPS Bot 🚀

Telegram bot para gestionar proyectos Node.js en VPS con **Claude Code** como generador de código.

## ✨ Características

- 🤖 **Generación de código con Claude** — Crea proyectos completos describiendo qué quieres
- 🔄 **Reconstrucción inteligente** — Modifica proyectos existentes con cambios incrementales
- 🐳 **Docker automático** — Build, deploy y health checks automáticos
- 📊 **Menú interactivo** — Navega fácilmente por tus proyectos
- ⚡ **Tracking de uso** — Monitorea consumo de Claude API
- 🎛️ **Múltiples modelos** — Elige entre Sonnet, Opus o Haiku
- 📋 **Logs en vivo** — Ver consola de Docker en tiempo real
- 🎯 **Control total** — Start/Stop, rebuild, delete projects

## 📋 Requisitos

- Node.js 18+
- Docker & Docker Compose
- Telegraf (bot framework)
- Claude Code CLI instalado
- Token de Telegram Bot

## 🚀 Instalación

```bash
# Clonar repositorio
git clone https://github.com/maksymhs/vps-bot.git
cd vps-bot

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Edita .env con tus datos:
# - BOT_TOKEN: token de tu bot de Telegram
# - CHAT_ID: tu ID de chat en Telegram
# - DOMAIN: tu dominio (ej: maksym.site)
# - PROJECTS_DIR: ruta donde crear proyectos
```

## 📖 Uso

### Menú Principal
```
/menu  → Abre el menú interactivo
```

### Crear Proyecto
```
/new nombreapp "Descripción de lo que quiero"
```

Ejemplo:
```
/new calculator "Una calculadora web que suma, resta, multiplica y divide"
```

**Flujo:**
1. Elige modelo (Sonnet, Opus, Haiku)
2. Claude genera código automáticamente
3. Docker construye la imagen
4. App se despliega en `https://nombreapp.tudominio.com`

### Reconstruir Proyecto
```
/rebuild nombreapp
```

**Opciones:**
- **Patch** — Cambios incrementales (más rápido)
- **Full** — Regenerar todo desde cero

Ejemplo:
```
Cambios: "Quiero agregar un botón para limpiar"
```

### Gestionar Proyectos
- `/list` — Ver todos tus proyectos
- `/logs nombreapp` — Ver logs de Docker
- `/url nombreapp` — Copiar URL del proyecto
- `/delete nombreapp` — Eliminar proyecto

### Monitorear Uso
- `/menu` → `⚡ Claude Usage`
  - Ver límites de Claude API
  - Cuándo se resetean

## 🏗️ Estructura del Proyecto

```
vps-bot/
├── src/
│   ├── bot.js                 # Bot principal
│   ├── commands/
│   │   ├── projects.js        # Crear/reconstruir proyectos
│   │   ├── menu.js            # Menú interactivo
│   │   ├── docker.js          # Comandos Docker
│   │   └── status.js          # Estado del servidor
│   └── lib/
│       ├── store.js           # Base de datos (JSON)
│       ├── usage.js           # Tracking de uso de Claude
│       └── console.js         # Streaming de logs
├── package.json
├── .env                       # Configuración (no subir!)
└── README.md
```

## 🔧 Cómo Funciona Internamente

### `/new nombreapp "descripción"`
1. Crea carpeta `/proyectos/nombreapp/`
2. Genera prompt para Claude con la descripción
3. Claude Code crea:
   - `src/index.js` — Servidor Express
   - `package.json` — Dependencias
   - `Dockerfile` — Imagen Docker
   - `docker-compose.yml` — Orquestación
4. Docker construye y deploya
5. Bot verifica que la app responde HTTP

### `/rebuild nombreapp`
1. Lee código existente
2. Claude recibe: descripción original + cambios nuevos
3. **Modifica** archivos existentes (no crea desde cero)
4. Docker rebuild (más rápido que nuevo build)
5. Verifica nuevamente

### Botones Interactivos
Después de cada operación:
- `♻️ Rebuild` — Hacer cambios
- `📋 Logs` — Ver consola
- `🛑 Stop / ▶️ Start` — Control
- `🔗 Copiar URL` — Link del proyecto
- `🗑️ Eliminar` — Borrar todo

## 📊 Tracking de Uso

El bot monitorea:
- **Por minuto** — 100 llamadas máximo (Claude API)
- **Por día** — 1,000 llamadas máximo
- **Reseteo** — Cada 24 horas

Ver en `/menu` → `⚡ Claude Usage`

## 🔒 Seguridad

- Solo responde a tu CHAT_ID
- Token de bot en `.env` (no en git)
- `.claude-usage.json` ignorado en git
- Proyectos aislados en Docker

## 📝 Variables de Entorno

```env
BOT_TOKEN=tu_token_de_telegram
CHAT_ID=tu_id_de_chat
DOMAIN=tu.dominio.com
PROJECTS_DIR=/home/usuario/proyectos
NODE_BIN=/ruta/a/node
CLAUDE_CLI=/ruta/a/claude-code/cli.js
```

## 🛠️ Desarrollo

```bash
# Iniciar bot
npm start

# Ver logs
tail -f /tmp/bot.log
```

## 📚 Stack Tecnológico

- **Bot Framework** — Telegraf
- **Generación de código** — Claude Code CLI
- **Servidor** — Express.js
- **Contenedores** — Docker & Docker Compose
- **Base de datos** — JSON (store.js)
- **Node.js** — v18+

## 🐛 Troubleshooting

### "Claude Code no encontrado"
Verifica `CLAUDE_CLI` en `.env` apunta a la ruta correcta

### "Container no arranca"
- Ver logs: `/logs nombreapp`
- Revisar `Dockerfile` generado
- Puede ser falta de puerto o error en código

### "Rate limit de Claude"
- Espera 1 minuto (limite por minuto)
- O espera 24 horas (limite por día)
- Ver `/menu` → `⚡ Claude Usage`

## 📄 Licencia

MIT

## 👤 Autor

Maksym — [@maksymhs](https://github.com/maksymhs)

---

**¿Preguntas?** Abre un [issue](https://github.com/maksymhs/vps-bot/issues) en GitHub 🎯
