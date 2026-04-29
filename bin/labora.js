#!/usr/bin/env node

const { spawn } = require('node:child_process')
const { chmodSync, existsSync, readdirSync } = require('node:fs')
const path = require('node:path')

if (process.platform !== 'linux') {
  console.error('Labora desktop npm package currently supports Linux only.')
  process.exit(1)
}

const packageRoot = path.resolve(__dirname, '..')
const distDir = path.join(packageRoot, 'desktop', 'dist')

if (!existsSync(distDir)) {
  console.error(`Labora AppImage directory not found: ${distDir}`)
  process.exit(1)
}

const appImageName = readdirSync(distDir)
  .filter((entry) => entry.endsWith('.AppImage'))
  .sort()
  .at(-1)

if (!appImageName) {
  console.error(`No Labora AppImage found in: ${distDir}`)
  process.exit(1)
}

const appImagePath = path.join(distDir, appImageName)

try {
  chmodSync(appImagePath, 0o755)
} catch {
  // npm can preserve executable bits, but global installs vary by platform.
}

const child = spawn(appImagePath, process.argv.slice(2), {
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})

child.on('error', (error) => {
  console.error(`Failed to launch Labora: ${error.message}`)
  process.exit(1)
})
