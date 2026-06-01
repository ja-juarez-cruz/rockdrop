import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE')
  const apiTarget = env.VITE_API_URL

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: apiTarget
        ? {
            '/api': {
              target: apiTarget,
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/api/, ''),
              secure: true,
            },
          }
        : undefined,
    },
    base: './',
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  }
})
