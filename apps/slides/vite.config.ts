import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Icons from 'unplugin-icons/vite'
import { FileSystemIconLoader } from 'unplugin-icons/loaders'
import IconsResolver from 'unplugin-icons/resolver'
import Components from 'unplugin-vue-components/vite'

// Company AI：发布在宿主的 /editors/slides/ 下（EDITORS_BASE 可换前缀），构建到仓库根的 dist/slides/；不再连 PPTist 的服务器
const base = (process.env.EDITORS_BASE ?? '/editors/').replace(/\/?$/, '/') + 'slides/'

// https://vitejs.dev/config/
export default defineConfig({
  base,
  plugins: [
    vue(),
    Components({
      dirs: [],
      resolvers: [
        IconsResolver({
          prefix: 'i',
          customCollections: ['custom'],
        }),
      ],
    }),
    Icons({
      compiler: 'vue3',
      autoInstall: false,
      customCollections: {
        custom: FileSystemIconLoader('src/assets/icons'),
      },
      scale: 1,
      defaultClass: 'i-icon',
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
  },
  build: {
    outDir: fileURLToPath(new URL('../../dist/slides', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `
          @import '@/assets/styles/variable.scss';
          @import '@/assets/styles/mixin.scss';
        `
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@cai/bridge': fileURLToPath(new URL('../../packages/bridge/src/index.ts', import.meta.url)),
    }
  }
})
