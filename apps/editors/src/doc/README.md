# 文档编辑器（kind = doc）

从平台 `src/features/docs/DocEditor.tsx` 搬来的正文编辑器：Tiptap + Yjs 协同，只保留正文；标题、分享、AI 面板由宿主负责。

## 文件

- `DocEditor.tsx`：页面。协同连接、工具栏、链接弹窗、图片上传、导入、宿主消息。
- `schema.ts`：节点集合 `schemaExtensions()`、`Y_FIELD`（正文所在的 Y.XmlFragment 名 `default`）、`Y_TITLE`（标题所在的 Y.Text 名 `title`）。从平台复制，多加了 `image` 节点。**平台服务端的协同服务和 `cleanDoc` 白名单也要认识 `image`，否则协同转换或保存时图片会被丢掉。**
- `image.ts`：最简单的图片节点（块级、`src` / `alt` / `title` / `width`），starter-kit 3 没有图片节点，又不想多装包。
- `content.ts`：拼结构的小函数、`contentOf`（空内容 `{}` → 空白文档）、`plainOf`（纯文本）、`paragraphsOf`（文字按行成段落）。和平台 `content.ts` 里的同名函数一致。
- `export.ts`：`toDocx`（docx 库）、`toMarkdown`。
- `import.ts`：docx（mammoth）、md（marked）、txt、html → HTML，再由 `editor.commands.setContent(html)` 解析；`sanitizeHtml` 去掉脚本和事件属性。
- `doc.css`：正文、工具栏、别人的光标、评论高亮、打印样式。从平台 `docs.css` 复制需要的部分。
- `comments.ts`：评论（见下面「评论」）：锚点的生成和找回、高亮（ProseMirror decoration）、点击、找不到的评论。

## 内容格式

`content` 是 Tiptap JSON：`{ type: 'doc', content: [...] }`。节点：`paragraph`、`heading`（level 1-3）、`bulletList` / `orderedList` / `listItem`、`blockquote`、`codeBlock`、`horizontalRule`、`hardBreak`、`table` / `tableRow` / `tableHeader` / `tableCell`、`image`（`attrs.src` 是宿主上传接口返回的带令牌地址）、`text`。样式：`bold`、`italic`、`strike`、`code`、`underline`、`link`。

`plain` 是 `plainOf(content)`：段落、标题、列表项每个一行，表格一行一行、单元格之间用竖线隔开。

## 两种模式

| | 协同（默认） | 普通（地址参数 `collab=0`） |
|---|---|---|
| 内容来源 | `ws(s)://宿主/ws/collab/<编号>?token=…` 上的 Y.Doc：正文 `Y.XmlFragment 'default'`，标题 `Y.Text 'title'` | `s.doc.content` |
| 保存 | 服务端自己落库，编辑器不调保存接口 | 改动后 `s.markDirty(() => ({ content, plain }))`，会话停下来 1.5 秒后保存 |
| 在线的人 | awareness 里的人 → `present` 消息（服务端会把 `user` 换成登录身份，页面冒充不了） | 会话的心跳（`/presence`） |
| 标题 | 宿主发 `title` 消息时写进 Y.Text；Y.Text 变了（别人改的）发 `title` 消息给宿主 | 宿主发 `title` 时只记下来 |
| 连接状态 | `collab` 消息：connecting / connected / reconnecting / offline / denied / failed | 不发 |

协同模式 6 秒没同步上（`failed`）或服务端拒绝（`denied`，关闭码 4400-4499）时，用打开时拿到的 `s.doc.content` 显示**只读**视图并提示，可以点「重试」。离线（断开 12 秒以上）时还能继续写，重连后自动合并。

y-websocket 的 `WebsocketProvider(serverUrl, roomname, doc, { params })`：`serverUrl` 是 `s.wsUrl()` 去掉 `/ws/collab/<编号>?token=…` 之后再接 `/ws/collab`，`roomname` 是文档编号，`params: { token }` 会拼到地址上。

## 宿主消息

- `insert`：`text` 按行成段落、或 `html`，插到文末。只读时提示。
- `export`：`docx`（标题、段落、列表、引用、代码块、表格、图片、加粗 / 斜体 / 删除线 / 代码 / 链接）、`md`、`pdf`（`window.print()`，打印样式只打印正文）。
- `readonly`：切换 `editable`，工具栏跟着显示或隐藏。
- `title`：见上表。
- `focus`：光标回到正文。
- `flush`：会话自己处理；协同模式没有要写回的东西。

- `comments` / `comment-focus` / `comment-pending`：见「评论」。

编辑器发给宿主：`collab`、`present`、`title`、`selection`（选区变化节流 300 毫秒，选中的文字；取消选中发空字符串）、`imported`、`exported`、`comment-new`、`comment-open`、`comment-orphans`。

## 导入

`s.doc.importFile` 有值时下载它，按扩展名转成 HTML → `setContent` → 保存（普通模式 `flush`；协同模式写进 Y.Doc 由服务端保存）→ `s.client.imported()` → `imported` 消息（标题去掉扩展名）。Word 里的图片交给 `s.client.upload` 存成附件，传不上去时内嵌成 data: 地址。协同模式会等连上以后再导入，内容才会进 Y.Doc。

## 评论

评论串、回复、@ 提到都在宿主；编辑器只管选范围、画高亮、报点击和找不到的锚点。加评论**不改正文**（高亮全是 decoration，不写样式标记、不调保存），所以只读的人也能评论。宿主发过 `comments`（哪怕是空数组）以后才出评论入口。

- **怎么评论**：选中文字后，选区末尾下方浮出「评论」按钮（编辑、只读都有，手机宽度也在选区下方）；或者按 Ctrl+Alt+M（Mac 上 ⌘+⌥+M，快捷键挂在 window 上，只读时正文拿不到焦点也能用）。发 `comment-new`，锚点前后的空白会去掉；只选了图片、空段落时提示先选文字。
- **锚点**（`DocCommentAnchor`）：`rel` 是起止位置的 Yjs 相对位置（挂在 `Y.XmlFragment 'default'` 上；起点粘在后一个字上、终点粘在前一个字上，在评论两头打字不会被算进去），`quote` 选中的纯文字（段落之间换行，最多 500 字）、`len` 完整长度、`prefix` / `suffix` 前后各 32 字、`at` 创建时的位置。普通模式（`collab=0`）和协同没连上时创建的评论没有 `rel`。
- **找回来**：先按相对位置；相对位置还认识但两头落到一起（原文被删了）就算找不到，不再按文字找，撤销删除后会回来。相对位置不认识（普通模式，或协同服务按保存的内容重建了 Y.Doc、旧编号全没了）时按 `quote` 在全文里找，用前后文挑对的那处（只有一处直接用，好几处要前后文对得上）；原文也被改过、一处都找不到时，用前后文夹出中间那段。协同模式下按文字找到的会在当前 Y.Doc 上补一份相对位置（只在内存里），之后靠它跟。
- **重算**：本地改动按事务的 mapping 挪；远端改动、协同的撤销重做（y-prosemirror 每次整篇替换）按相对位置重算；改动停下来 1 秒后整体再算一遍并报 `comment-orphans`（收到 `comments` 后总报一次，之后有变化才报；协同模式没连上时不报）。已解决的评论也算位置、也会报找不到，只是不画高亮。
- **高亮**：未解决的评论黄色底加下划线（`.cmt-hl`，带 `data-cid`），当前评论（`comment-focus`，或刚点过的）和评论框开着时的范围（`comment-pending`）颜色更重；`comment-focus` 指向已解决的评论时也临时显示，并滚到它（不滚宿主页面）。打印时不显示。点高亮发 `comment-open`，几条重叠时取最短的那条；拖选文字松手不算点击。
- **限制**：按文字找回依赖原文还在，被大段改写又重建过 Y.Doc 的评论会报找不到；一段文字被剪切粘贴到别处，协同模式下算原文被删。

## 工具栏

段落样式、加粗、斜体、列表、编号、表格（插入；在表格里时加行、加列、删行、删列、删除表格）、图片（选文件 → `s.client.upload` → 插入）、链接（有选中文字就加链接，没有就把地址插进去；已是链接时可以去掉）、撤销、重做。只读时不显示工具栏。

开发时（`import.meta.env.DEV`）`window.__editor` 是当前的 Tiptap 实例，截图脚本和调试用。
