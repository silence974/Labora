import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = resolve(__filename, '..')
const repoRoot = resolve(__dirname, '..')
const frontendDir = join(repoRoot, 'frontend')
const backendDir = join(repoRoot, 'backend')
const desktopDir = join(repoRoot, 'desktop')

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const uvBin = process.platform === 'win32' ? 'uv.exe' : 'uv'
const backendExecutableName = process.platform === 'win32' ? 'labora.exe' : 'labora'

function run(command, args, cwd) {
  console.log(`\n==> ${cwd}: ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function copyDirectory(sourceDir, targetDir) {
  rmSync(targetDir, { recursive: true, force: true })
  cpSync(sourceDir, targetDir, { recursive: true })
}

function copyFile(sourceFile, targetDir) {
  rmSync(targetDir, { recursive: true, force: true })
  mkdirSync(targetDir, { recursive: true })
  const targetFile = join(targetDir, basename(sourceFile))
  cpSync(sourceFile, targetFile)
  if (process.platform !== 'win32') {
    chmodSync(targetFile, 0o755)
  }
}

console.log('Packaging Labora desktop app...')

run(npmBin, ['ci'], frontendDir)
run(npmBin, ['run', 'build'], frontendDir)

const frontendDistDir = join(frontendDir, 'dist')
const desktopFrontendDistDir = join(desktopDir, 'dist-frontend')
if (!existsSync(frontendDistDir)) {
  console.error(`Frontend build output not found: ${frontendDistDir}`)
  process.exit(1)
}
copyDirectory(frontendDistDir, desktopFrontendDistDir)

run(uvBin, ['sync'], backendDir)
rmSync(join(backendDir, 'build'), { recursive: true, force: true })
rmSync(join(backendDir, 'dist'), { recursive: true, force: true })
rmSync(join(backendDir, 'labora.spec'), { force: true })
run(
  uvBin,
  [
    'run',
    'pyinstaller',
    '--onefile',
    '--name',
    'labora',
    '--specpath',
    'build/pyinstaller-spec',
    'main.py',
    '--clean',
    '--noconfirm',
  ],
  backendDir,
)

const packagedBackendBinary = join(backendDir, 'dist', backendExecutableName)
if (!existsSync(packagedBackendBinary)) {
  console.error(`Packaged backend binary not found: ${packagedBackendBinary}`)
  process.exit(1)
}
copyFile(packagedBackendBinary, join(desktopDir, 'resources', 'backend'))

run(npmBin, ['ci'], desktopDir)
run(npmBin, ['run', 'package'], desktopDir)

console.log('\nDesktop package created in desktop/dist/')
