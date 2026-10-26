# Company AI 编辑器

Company AI 协作平台的在线编辑器，覆盖九种格式：文档、表格、幻灯片、多维表格、问卷、思维笔记、画板、流程图和上传文件的预览。它是一组独立部署的静态页面，宿主（平台）用 iframe 打开某一种编辑器，内容的读写走宿主提供的接口。平台本体不在这个仓库里。

许可证：AGPL-3.0（见 LICENSE）。幻灯片编辑器基于 [PPTist](https://github.com/pipipi-pikachu/PPTist)（AGPL-3.0），其余格式基于 MIT / Apache-2.0 的库，见 NOTICE.md。

## 目录

| 目录 | 内容 |
|---|---|
| `packages/bridge` | 编辑器和宿主之间的约定：地址参数、接口、postMessage 消息、自动保存。宿主侧可以照着 `src/protocol.ts` 自己实现，不需要引用它 |
| `apps/editors` | React 多页面应用：`doc` 文档（Tiptap + Yjs 协同）、`sheet` 表格（Univer）、`base` 多维表格、`survey` 问卷、`mind` 思维笔记（simple-mind-map）、`board` 画板（Excalidraw）、`flow` 流程图（AntV X6）、`file` 文件预览 |
| `apps/slides` | 幻灯片：PPTist 的 fork，改动集中在 `src/cai/`（读写内容、主题、和宿主通信） |
| `dist/` | 构建产物：`dist/<格式>/index.html`，宿主把它当静态文件发布在 `/editors/` 下 |

## 开发

```bash
npm install
npm run dev          # apps/editors，http://localhost:5174/editors/<格式>/
npm run dev:slides   # apps/slides，http://localhost:5175/editors/slides/
npm run build        # 全部构建到 dist/
npm run typecheck
```

页面要带参数才能打开内容：`?doc=<内容编号>&token=<编辑令牌>&api=<宿主地址>`，可选 `theme=light|dark`、`mode=edit|read|fill`。编辑令牌由宿主签发，只对一份内容、一个人、一段时间有效。

## 和宿主的约定

见 `packages/bridge/src/protocol.ts`：

- 接口：`GET/PUT/PATCH {api}/api/v1/editor/doc`、`POST …/presence`、`POST …/asset`、`GET …/asset/:id`、`GET …/directory`、`GET/POST …/responses`、`POST …/collecting`，都用 `Authorization: Bearer <token>`。
- 消息：编辑器 → 宿主 `ready / title / saving / saved / dirty / conflict / collab / present / error / navigate / request / exported / imported / selection / comment-new / comment-open / comment-orphans / comment-moved`；宿主 → 编辑器 `theme / title / insert / export / readonly / command / focus / flush / comments / comment-focus / comment-pending`。
- 评论（文档、表格）：`ready` 里带 `comments: true`。编辑器只管选范围、生成锚点（`CommentAnchor`，宿主原样保存的不透明 JSON）、画高亮、报点击和找不到的锚点；评论串、回复、@ 提到、通知都在宿主。加评论不改内容，只读的人也能评论。
- 文档格式的实时协同连到宿主的 `ws(s)://…/ws/collab/<编号>?token=…`，协议和 y-websocket 相同。

## 内容格式

每种格式的 JSON 由对应编辑器定义，宿主只保存和转发，另外保存编辑器给出的纯文本（搜索和 AI 用）。各格式的说明在 `apps/editors/src/<格式>/README.md`。
