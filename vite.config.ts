import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { vitePlugin as typegpu } from 'unplugin-typegpu'

export default defineConfig({
  plugins: [react(), typegpu()],
  // build output and the packaged app hold locked files that crash the file watcher
  server: { watch: { ignored: ['**/release/**', '**/dist/**', '**/desktop/**'] } },
})
