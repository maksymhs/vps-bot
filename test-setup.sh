#!/bin/bash

set -e

echo "🧪 VPS Bot - Testing Environment Setup"
echo "======================================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker no encontrado${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ Docker Compose no encontrado${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker y Docker Compose encontrados${NC}"
echo ""

# Build the image
echo "🔨 Construyendo imagen del bot..."
docker-compose -f docker-compose.test.yml build

echo ""
echo -e "${GREEN}✅ Imagen construida${NC}"
echo ""

# Start services
echo "🚀 Levantando servicios..."
docker-compose -f docker-compose.test.yml up -d

echo ""
echo -e "${GREEN}✅ Servicios levantados${NC}"
echo ""

# Wait for services to be ready
echo "⏳ Esperando que los servicios estén listos..."
sleep 5

# Check status
echo ""
echo "📊 Estado de los servicios:"
docker-compose -f docker-compose.test.yml ps

echo ""
echo "🧪 Testing VPS Bot Environment"
echo "============================="
echo ""
echo "✅ Caddy Admin API: http://localhost:2019"
echo "✅ Caddy HTTP:      http://localhost:80"
echo ""
echo "📝 Próximos pasos:"
echo ""
echo "1. Ver logs del bot:"
echo "   docker-compose -f docker-compose.test.yml logs vps-bot -f"
echo ""
echo "2. Acceder a la shell del bot:"
echo "   docker-compose -f docker-compose.test.yml exec vps-bot sh"
echo ""
echo "3. Probar Caddy Admin API:"
echo "   curl http://localhost:2019/config/"
echo ""
echo "4. Ver containers que crea el bot:"
echo "   docker ps -a"
echo ""
echo "5. Parar todo:"
echo "   docker-compose -f docker-compose.test.yml down"
echo ""
echo "6. Limpiar volúmenes (CUIDADO - borra proyectos):"
echo "   docker-compose -f docker-compose.test.yml down -v"
echo ""
