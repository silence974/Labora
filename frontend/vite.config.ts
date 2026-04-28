import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// https://vite.dev/config/
export default defineConfig({
  // Optimization: switch the runtime to Preact for a smaller virtual-DOM layer.
  plugins: [preact()],
})
