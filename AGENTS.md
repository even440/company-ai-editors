# Company AI 编辑器：项目约定

这是 Company AI 协作平台的在线编辑器仓库（AGPL-3.0，独立于平台本体）。每种格式一个页面，宿主用 iframe 打开，内容读写走宿主接口。先读 `packages/bridge/src/protocol.ts`、`packages/bridge/src/session.ts` 和 `apps/editors/src/shell/`。

## 结构

- `packages/bridge`：地址参数、接口客户端、自动保存会话、postMessage 消息类型。不要在这里放某一种格式的逻辑。
- `apps/editors/<格式>/index.html` + `main.tsx`：入口（React 19 + Vite）。`main.tsx` 只做 `mount((s) => <XxxEditor session={s} />)`。
- `apps/editors/src/<格式>/`：这种格式的组件、内容格式说明 `README.md`、导入导出。
- `apps/editors/src/shell/`：会话（`session.tsx`：`mount`、`useSession`、`useHost`、`useTheme`）、组件（`ui.tsx`：`Icon`、`TT`、`Toolbar`、`Select`、`Toggle`、`Field`、`Modal`、`Confirm`、`toast`、`Toaster`）、图标（`icons.ts`，和平台共用的 16×16 描边图标）、样式（`base.css` 是平台的全套样式，`shell.css` 是编辑器外壳）。
- `apps/slides`：PPTist 的 fork（Vue 3）。改动尽量集中在 `src/cai/` 和少数几个接入点，每处改动在 `apps/slides/CHANGES.md` 里记一行，方便以后合并上游。
- `tools/mock-host.mjs`：假宿主，不用平台也能开发；`tools/shots.mjs`：无界面 Chrome 截图。

## 页面怎么写

1. `const s = await openSession()`（React 里用 `mount` / `useSession`）。`s.doc` 是内容和权限，`s.readonly` 为真时不能改。
2. 内容变了就 `s.markDirty(() => ({ content, plain }))`，会话停下来 1.5 秒后自动保存；`plain` 是给搜索和 AI 用的纯文本，按自己的结构生成，兜底用 `plainOfJson`。
3. 版本冲突（别处改过）默认提示并刷新；要更好的处理用 `s.onConflict`。
4. 宿主的消息用 `useHost((m) => …)` 收：`theme` 已由会话处理（`html[data-theme]`，样式里的变量会跟着变），`export`（格式见 `EXPORTS`）、`insert`、`readonly`、`command`、`flush` 由各编辑器处理。导出用 `s.download(blob, 文件名)`。
5. `s.doc.importFile` 有值时表示这份内容刚从文件导入、还没转换：下载它（`s.client.assetUrl(id)`）、转换成本格式、保存，再调 `s.client.imported()`，并 `s.send({ type: 'imported', title })`。
6. 图片等附件用 `s.client.upload(file)`，得到带令牌的地址。
7. 标题由宿主显示和修改，编辑器不画标题；宿主发 `title` 消息时同步到自己的状态（幻灯片等会把标题写进内容的格式需要）。
8. 界面文字用中文，类名沿用 `base.css`（`.btn`、`.tt`、`.dtool`、`.input`、`.select`、`.chip`、`.card`、`.tbl`、`.modal` 等；原型里各格式的样式 `.sh-*`、`.bs-*`、`.sv-*`、`.mn-*`、`.wb-*`、`.fl-*`、`.fv-*` 也都在）。深色主题靠变量，不写死颜色。手机宽度（390px）也要能用。
9. 注释用中文，说明「为什么」。不新增依赖；确实需要时在报告里说明，不要自己 `npm install`。

## 内容格式（content 的 JSON）

| 格式 | content | plain |
|---|---|---|
| doc | Tiptap JSON `{ type: 'doc', content: [...] }`，节点集合见 `src/doc/schema.ts` | 各节点文字按段落拼 |
| sheet | Univer 的 `IWorkbookData`（`univerAPI.getActiveWorkbook().save()` 的结果） | 每个工作表每行的格子值 |
| slides | PPTist 的 `{ title, theme, slides, viewportSize, viewportRatio }` | 每页的文字元素 |
| base | `{ fields: Field[], records: { id, v: Record<fieldId, value> }[], views: View[] }`；字段类型 text / select / multi / user / date / number / check / url | 每条记录的值按字段拼 |
| survey | `{ desc, qs: Question[], set: { anon, once, due } }`；答卷不在 content 里，走 `responses` 接口 | 题目和选项 |
| mind | `{ root: 节点, layout, theme, mode: 'map' \| 'outline' }`，节点是 simple-mind-map 的 `{ data: { text, … }, children }` | 所有节点的文字 |
| board | `{ elements, appState: { viewBackgroundColor, … }, files }`（Excalidraw 的序列化结果，appState 只留和内容有关的字段） | 文字元素 |
| flow | X6 的 `graph.toJSON()`：`{ cells }` | 节点文字和连线标签 |
| file | `{}`；文件本身在 `s.doc.file` | 由宿主按文件类型提取 |

空内容一律是 `{}`：每个编辑器打开时发现 `content` 没有自己要的字段，就按空内容初始化。

## 验证

- `npm run typecheck`
- `npm run build:one -- <格式>`（只构建一个入口到 `dist-check/`，验证完删掉）
- `node tools/mock-host.mjs` 起假宿主（5180 端口），再 `npm run dev`（5174），打开 http://localhost:5180/host.html?kind=<格式> 就能在假宿主里用编辑器；`node tools/shots.mjs <截图目录> <计划.json>` 截图检查。
