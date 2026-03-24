#!/bin/bash

set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}"
echo "┌─────────────────────────────────────────────────────┐"
echo "│                                                     │"
echo "│         VPS-CODE-BOT  TEST ENVIRONMENT             │"
echo "│      Simulated Ubuntu VPS via Docker                │"
echo "│                                                     │"
echo "└─────────────────────────────────────────────────────┘"
echo -e "${NC}"

# Check Docker
if ! docker info &> /dev/null; then
    echo -e "${RED}Docker is not running. Start Docker Desktop first.${NC}"
    exit 1
fi

# Build
echo -e "${CYAN}Building simulated VPS image...${NC}"
docker compose -f docker-compose.test.yml build

echo ""
echo -e "${GREEN}✓ Image built${NC}"
echo ""

# Stop previous if exists
docker compose -f docker-compose.test.yml down 2>/dev/null || true

# Start
echo -e "${CYAN}Starting simulated VPS...${NC}"
docker compose -f docker-compose.test.yml up -d

echo ""
echo -e "${GREEN}✓ VPS container running${NC}"
echo ""
echo -e "${CYAN}━━━ What to test ━━━${NC}"
echo ""
echo -e "  You are now inside a fresh Ubuntu 22.04 with Node.js + Docker CLI."
echo -e "  The project is at ${GREEN}/opt/vps-bot${NC}"
echo ""
echo -e "  ${CYAN}Test install.sh:${NC}"
echo -e "    bash install.sh"
echo ""
echo -e "  ${CYAN}Test setup wizard:${NC}"
echo -e "    npm run setup"
echo ""
echo -e "  ${CYAN}Test CLI:${NC}"
echo -e "    npm start"
echo ""
echo -e "  ${CYAN}Ports exposed to your Mac:${NC}"
echo -e "    http://localhost:8888   Code-Server"
echo -e "    http://localhost:3080   Caddy HTTP"
echo -e "    http://localhost:2019   Caddy Admin API"
echo ""
echo -e "${CYAN}━━━ Entering VPS shell... ━━━${NC}"
echo ""

# Enter interactive shell
docker compose -f docker-compose.test.yml exec vps bash -l
