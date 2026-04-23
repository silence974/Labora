// preload script — contextBridge 在后续任务中按需扩展
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('labora', {
  version: process.env.npm_package_version ?? '0.1.0',
})
