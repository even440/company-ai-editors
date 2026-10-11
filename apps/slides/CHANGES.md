# 对上游 PPTist 的改动

这是 [PPTist](https://github.com/pipipi-pikachu/PPTist) 2.0 的 fork，接成 Company AI 的「幻灯片」编辑器（kind = slides）。接宿主的新代码都在 `src/cai/`（会话、内容格式、宿主消息、上传、PDF 打印，说明见 `src/cai/README.md`）。下面是对上游文件的改动，合并上游时照着看。

| 文件 | 改了什么 | 为什么 |
|---|---|---|
| `package.json` | 包名改为 `@cai/slides`（复制进仓库时改的）；依赖和 scripts（`dev` / `build` / `build-only` / `type-check`）没动 | 根目录 npm workspaces 用，`npm run build:slides` 调 `build-only`。`build` 里的 `type-check` 目前会在 `vite.config.ts` 报两处类型错误：根目录的 Vite 8 和这里的 Vite 5 两套类型打架（unplugin 的类型解析到根目录），和接入无关 |
| `vite.config.ts` | `base` 改为 `/editors/slides/`（环境变量 `EDITORS_BASE` 可换前缀）；`build.outDir` 指到 `../../dist/slides` 并 `emptyOutDir`；dev 端口 5175、host 127.0.0.1、strictPort；去掉 `/api` → server.pptist.cn 的代理；加 alias `@cai/bridge` → `../../packages/bridge/src/index.ts` | 作为平台的一个编辑器发布在宿主的 /editors/slides/ 下；不再连 PPTist 的服务器 |
| `tsconfig.app.json` | `paths` 加 `@cai/bridge`，`include` 加 `../../packages/bridge/src/**/*` | 类型检查能找到 bridge |
| `index.html` | 标题改「幻灯片」；去掉 description / keywords 的 SEO meta；其余（首屏加载动画、禁右键脚本）不动 | 嵌在平台里，不需要 PPTist 的 SEO |
| `src/App.vue` | 启动改为 `bootCai()`，不再 `api.getMockData('slides')`，快照库在 `bootCai` 里初始化；`caiReadonly` 为真时直接显示放映视图；去掉生产环境的 `onbeforeunload` 离开提示；挂上 `CaiPrint`；会话打开失败时显示原因 | 内容来自宿主；只读不能改；离开前的保存由会话做 |
| `src/utils/image.ts` | `getImageDataURL` 改为 async：先 `uploadToHost(file)` 拿地址，传不了再退回 dataURL | 图片不存 base64 在内容里；所有插图片、换图片、背景图、形状填充图都走这一个函数 |
| `src/services/index.ts` | `SERVER_URL` 置空 | 不往 server.pptist.cn 发请求（AI 生成、在线图库、AI 写作的入口都已去掉，这是兜底） |
| `src/views/Editor/EditorHeader/index.vue` | 去掉菜单里和右上角的「AI 生成 PPT」入口，去掉「本站仅作测试」声明；`openAIPPTDialog` 一并删掉 | AI 生成依赖 PPTist 的外部服务 |
| `src/views/Editor/CanvasTool/index.vue` | 去掉插入图片菜单里的「在线图库」和 `openImageLibPanel` | 依赖外部图片搜索服务 |
| `src/views/Editor/Toolbar/common/RichTextBase.vue` | 去掉文字工具栏的「AI 辅助」（美化 / 扩写 / 精简）和 `execAI` 及相关导入、状态 | 依赖外部服务 |
| `src/views/Mobile/MobilePreview.vue` | 去掉 AIPPT 入口和对话框及相关导入、状态 | 同上 |

没动的：`src/views/Editor/AIPPTDialog.vue`、`ImageLibPanel.vue`、`src/hooks/useAIPPT.ts` 这些文件还在，只是没有入口；`public/mocks/` 里的模板 JSON 仍由「幻灯片模板」面板按相对路径读取（本地文件，不走外部服务）。
