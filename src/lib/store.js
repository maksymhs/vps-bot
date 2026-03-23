import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const FILE = process.env.PROJECTS_STATE ?? '/home/maksym/projects/projects.json'

function read() {
  if (!existsSync(FILE)) return {}
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return {}
  }
}

function write(data) {
  mkdirSync(dirname(FILE), { recursive: true })
  writeFileSync(FILE, JSON.stringify(data, null, 2))
}

export const store = {
  get: (name) => read()[name] ?? null,
  getAll: () => read(),
  set: (name, project) => {
    const data = read()
    data[name] = { ...data[name], ...project, name, updatedAt: new Date().toISOString() }
    if (!data[name].createdAt) data[name].createdAt = data[name].updatedAt
    write(data)
    return data[name]
  },
  delete: (name) => {
    const data = read()
    delete data[name]
    write(data)
  },
}
