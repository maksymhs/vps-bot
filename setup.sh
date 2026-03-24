#!/bin/bash

set -e

echo "🚀 VPS Bot Setup"
echo "================"
echo ""

# Check dependencies
echo "📋 Verificando dependencias..."
echo ""

if ! command -v docker &> /dev/null; then
    echo "❌ Docker no encontrado. Por favor instálalo primero:"
    echo "   https://docs.docker.com/engine/install/"
    exit 1
fi
echo "✅ Docker encontrado: $(docker --version)"

if ! command -v node &> /dev/null; then
    echo "❌ Node.js no encontrado. Por favor instálalo primero:"
    echo "   https://nodejs.org/"
    exit 1
fi
echo "✅ Node.js encontrado: $(node --version)"

if ! curl -sf http://localhost:2019/config/ > /dev/null 2>&1; then
    echo "⚠️  Caddy Admin API no responde en http://localhost:2019"
    echo "   Asegúrate de tener Caddy corriendo con admin API habilitado"
    echo ""
fi

# Check Claude Code
if ! command -v node &> /dev/null; then
    echo "❌ Claude Code CLI no encontrado"
    echo "   Instala Claude Code desde https://claude.com/download"
    exit 1
fi
echo "✅ Claude Code disponible"
echo ""

# Install dependencies
echo "📦 Instalando dependencias del proyecto..."
cd "$(dirname "$0")"
npm install

echo ""
echo "✅ Instalación completada"
echo ""
echo "Próximo paso: Ejecutar el configurador"
echo ""
echo "npm run setup"
