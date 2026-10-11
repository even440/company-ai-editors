/**
 * 多入口：每种格式一个页面，构建到仓库根的 dist/<格式>/index.html，资源在 dist/assets/。
 * ENTRY=<格式> 只构建一个入口（开发某个编辑器时用）。
 * 幻灯片（apps/slides，PPTist 的 fork）是另一个 Vite 项目，构建到 dist/slides/；开发时这里把 /editors/slides 代理到它的开发服务器。
 */
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export const KINDS = ['doc', 'sheet', 'base', 'survey', 'mind', 'board', 'flow', 'file'] as const;
const only = process.env.ENTRY;
const base = process.env.EDITORS_BASE ?? '/editors/';

export default defineConfig({
  base,
  plugins: [react()],
  // dedupe：仓库根目录会被别的依赖（Excalidraw 的 radix-ui）提升一份 React 18，提升到根目录的 React 库会解析到它，页面里就有两份 React，hook 全部报错。统一指向 apps/editors 自己的 React 19
  resolve: { dedupe: ['react', 'react-dom'], alias: { '@cai/bridge': resolve(__dirname, '../../packages/bridge/src/index.ts'), '@shell': resolve(__dirname, 'src/shell') } },
  server: {
    port: 5174,
    strictPort: true,
    proxy: { [base + 'slides']: { target: 'http://localhost:5175', changeOrigin: true, ws: true } },
  },
  build: {
    outDir: resolve(__dirname, '../../dist'),
    emptyOutDir: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: { input: Object.fromEntries(KINDS.filter((k) => !only || k === only).map((k) => [k, resolve(__dirname, `${k}/index.html`)])) },
  },
  // Univer 的包（@univerjs/presets、preset-sheets-core）和别的依赖一样交给 Vite 预构建：
  // 不预构建的话 @univerjs/core 里 `import AsyncLock from 'async-lock'`（CommonJS）在开发服务器上会报没有 default 导出，
  // 而且 presets 和 preset-sheets-core 会各拿一份 @univerjs/core，依赖注入对不上。
});
