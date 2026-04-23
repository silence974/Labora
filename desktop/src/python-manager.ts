import { ChildProcess, spawn } from 'child_process'
import { app } from 'electron'
import * as path from 'path'
import * as http from 'http'

const BACKEND_PORT = 8765
const HEALTH_URL = `http://127.0.0.1:${BACKEND_PORT}/health`
const MAX_RETRIES = 30
const RETRY_INTERVAL_MS = 500

export class PythonManager {
  private process: ChildProcess | null = null

  start(): void {
    const isDev = !app.isPackaged

    if (isDev) {
      // 开发模式：假设后端已手动启动，不自动拉起
      console.log('[Python] Dev mode — expecting backend on port', BACKEND_PORT)
      return
    }

    // 生产模式：启动打包的 Python 可执行文件
    const backendExe = path.join(
      process.resourcesPath,
      'backend',
      process.platform === 'win32' ? 'labora.exe' : 'labora'
    )

    console.log('[Python] Starting backend:', backendExe)

    this.process = spawn(backendExe, ['--port', String(BACKEND_PORT)], {
      stdio: 'pipe',
    })

    this.process.stdout?.on('data', (d) =>
      console.log('[Python]', d.toString().trim())
    )
    this.process.stderr?.on('data', (d) =>
      console.error('[Python]', d.toString().trim())
    )
    this.process.on('exit', (code) =>
      console.log('[Python] Process exited with code', code)
    )
  }

  stop(): void {
    if (this.process) {
      console.log('[Python] Stopping backend process')
      this.process.kill()
      this.process = null
    }
  }

  waitUntilReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      let attempts = 0

      const check = () => {
        http
          .get(HEALTH_URL, (res) => {
            if (res.statusCode === 200) {
              console.log('[Python] Backend is ready')
              resolve()
            } else {
              retry()
            }
          })
          .on('error', retry)
      }

      const retry = () => {
        attempts++
        if (attempts >= MAX_RETRIES) {
          reject(new Error('Backend failed to start after max retries'))
          return
        }
        setTimeout(check, RETRY_INTERVAL_MS)
      }

      check()
    })
  }
}
