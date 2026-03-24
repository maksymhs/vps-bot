# 🧪 VPS Bot - Testing Guide

Cómo probar el VPS Bot en un ambiente aislado con Docker.

## Quick Start

```bash
# 1. Hacer el script ejecutable
chmod +x test-setup.sh

# 2. Ejecutar el setup (construye y levanta servicios)
./test-setup.sh
```

Eso es todo. El bot estará corriendo en Docker con Caddy.

## Architecture

```
┌─────────────────────────────────────────┐
│         Docker Network (aislado)        │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────────┐   ┌──────────────┐   │
│  │    Caddy     │   │   VPS Bot    │   │
│  │   Port 80    │   │  (Node.js)   │   │
│  │   Port 443   │   │              │   │
│  │ Admin 2019   │   │ /projects →  │   │
│  └──────────────┘   │   Docker     │   │
│       ↑             │   Container  │   │
│       │             └──────────────┘   │
│    (proxy)                 │            │
│                            ↓            │
│                    ┌──────────────┐    │
│                    │ Docker Host  │    │
│                    │   (socket)   │    │
│                    └──────────────┘    │
│                                         │
└─────────────────────────────────────────┘
        ↓
   Host Machine
   (Your laptop)
```

## Comandos útiles

### Ver logs del bot
```bash
docker-compose -f docker-compose.test.yml logs vps-bot -f
```

### Acceder a la shell del bot
```bash
docker-compose -f docker-compose.test.yml exec vps-bot sh
```

### Probar Caddy Admin API
```bash
# Ver configuración actual
curl http://localhost:2019/config/

# Listar aplicaciones
curl http://localhost:2019/config/apps/

# Ver servicios HTTP
curl http://localhost:2019/config/apps/http/servers/
```

### Ver containers creados por el bot
```bash
docker ps -a
```

### Ver volúmenes del bot
```bash
docker volume ls | grep vps
```

### Ver proyecto creado
```bash
docker volume inspect vps-bot_vps_projects
# O acceder directamente (si es local)
```

### Parar servicios
```bash
# Parar sin eliminar volúmenes
docker-compose -f docker-compose.test.yml down

# Parar y limpiar TODO (cuidado!)
docker-compose -f docker-compose.test.yml down -v
```

## Workflow de testing

### 1. Inicializar el ambiente
```bash
./test-setup.sh
```

### 2. Verificar que Caddy está running
```bash
curl http://localhost:2019/config/
# Debería devolver JSON con configuración
```

### 3. Verificar que el bot está running
```bash
docker-compose -f docker-compose.test.yml logs vps-bot
# Debería mostrar: "Bot arrancado"
```

### 4. Entrar al bot (simulando que llega mensaje Telegram)
```bash
docker-compose -f docker-compose.test.yml exec vps-bot node -e "
const { Telegraf } = require('telegraf');
console.log('Bot está corriendo correctamente');
"
```

## Notas importantes

### Sobre Docker-in-Docker
El bot necesita acceso al Docker daemon del **host**. Por eso montamos:
```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock:ro
```

Esto permite que el bot **vea y cree containers en el host**, no en sí mismo.

### Proyectos creados
Los proyectos se guardan en un volumen Docker: `vps_projects`

Para acceder:
```bash
# Ver dónde está en el host
docker volume inspect vps-bot_vps_projects

# O ver contenido desde dentro del bot
docker-compose -f docker-compose.test.yml exec vps-bot ls -la /projects
```

### Red aislada
El bot y Caddy están en una red Docker isolada (`vps-network`), por lo que:
- ✅ Se comunican entre sí sin problemas
- ✅ El host puede acceder a sus puertos
- ✅ No interfieren con otros contenedores del host
- ✅ Es fácil destruir todo sin dejar rastro

## Troubleshooting

### El bot no arranca
```bash
docker-compose -f docker-compose.test.yml logs vps-bot
```

### Caddy no responde en :2019
```bash
# Verificar que el puerto no está en uso
lsof -i :2019

# Ver logs de Caddy
docker-compose -f docker-compose.test.yml logs caddy
```

### El bot no puede crear containers
```bash
# Verificar permisos del socket
ls -la /var/run/docker.sock

# Podría necesitar: sudo chmod 666 /var/run/docker.sock
# (Temporal, se resetea al reiniciar)
```

### Limpiar completamente
```bash
docker-compose -f docker-compose.test.yml down -v
docker volume prune
docker image prune
```

## Próximos pasos

- [ ] Crear test suite para validar funcionamiento
- [ ] Simular Telegram webhook (para testing sin bot real)
- [ ] Agregar healthchecks a docker-compose
- [ ] Crear CI/CD pipeline
