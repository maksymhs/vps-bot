export const PROJECT = {
  name: 'vps-bot',
  tagline: 'Describe it. Deploy it.',
  version: '1.0.0',
  author: 'maksymhs',
  repo: 'https://github.com/maksymhs/vps-bot',
  description: 'AI-powered VPS platform — describe an app, get it running with Docker + SSL in minutes',
}

export function getBanner() {
  return `
                  __          __  
   _   ___ ___   / /_  ____  / /_ 
  | | / / __ \\ / __ \\/ __ \\/ __/ 
  | |/ / /_/ // /_/ / /_/ / /_   
  |___/ .___//_____/\\____/\\__/   
     /_/                          
`
}

export function getSmallBanner() {
  return `vps-bot v${PROJECT.version}`
}
