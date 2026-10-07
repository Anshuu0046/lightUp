import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { vitePlugin as typegpu } from 'unplugin-typegpu'
export default defineConfig({ plugins: [react(), typegpu()] })
