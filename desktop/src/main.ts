import { app, BrowserWindow, shell } from 'electron'
import * as path from 'path'
import { PythonManager } from './python-manager'

const isDev = !app.isPackaged
const pythonManager = new PythonManager()

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Labora',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../dist-frontend/index.html'))
  }

  // 外部链接在系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  return win
}

app.whenReady().then(async () => {
  pythonManager.start()

  try {
    await pythonManager.waitUntilReady()
  } catch (err) {
    console.error('Backend failed to start:', err)
    // 在开发模式下继续，允许手动启动后端
    if (!isDev) {
      app.quit()
      return
    }
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  pythonManager.stop()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  pythonManager.stop()
})
