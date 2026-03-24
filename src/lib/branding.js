export const PROJECT = {
  name: 'vps-code-bot',
  tagline: 'VPS Management Platform',
  version: '1.0.0',
  description: 'Intelligent VPS management with automatic application generation powered by Claude',
}

export function getBanner() {
  return `
  ┌─────────────────────────────────────────────────────┐
  │                                                     │
  │              VPS-CODE-BOT                           │
  │         VPS Management Platform v1.0                │
  │                                                     │
  └─────────────────────────────────────────────────────┘
`
}

export function getSmallBanner() {
  return `VPS-CODE-BOT v${PROJECT.version}`
}
