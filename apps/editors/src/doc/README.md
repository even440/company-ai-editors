# 文档编辑器（kind = doc）

从平台 `src/features/docs/DocEditor.tsx` 搬来的正文编辑器：Tiptap + Yjs 协同，只保留正文；标题、分享、AI 面板由宿主负责。

## 文件

- `DocEditor.tsx`：页面。协同连接、工具栏、链接弹窗、图片上传、导入、宿主消息。
- `schema.ts`：节点集合 `schemaExtensions()`、`Y_FIELD`（正文所在的 Y.XmlFragment 名 `default`）、`Y_TITLE`（标题所在的 Y.Text 名 `title`）。从平台复制，多加了 `image` 节点。**平台服务端的协同服务和 `cleanDoc` 白名单也要认识 `image`，否则协同转换或保存时图片会被丢掉。**
- `image.ts`：最简单的图片节点（块级、`src` / `alt` / `title` / `width`），starter-kit 3 没有图片节点，又不想多装包。
- `content.ts`：拼结构的小函数、`contentOf`（空内容 `{}` → 空白文档）、`plainOf`（纯文本）、`paragraphsOf`（文字按行成段落）。和平台 `content.ts` 里的同名函数一致。
- `export.ts`：`toDocx`（docx 库）、`toMarkdown`。
- `import.ts`：docx（mammoth）、md（marked）、txt、html → HTML，再由 `editor.commands.setContent(html)` 解析；`sanitizeHtml` 去掉脚本和事件属性。
- `doc.css`：正文、工具栏、别人的光标、打印样式。从平台 `docs.css` 复制需要的部分。

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

编辑器发给宿主：`collab`、`present`、`title`、`selection`（选区变化节流 300 毫秒，选中的文字；取消选中发空字符串）、`imported`、`exported`。

## 导入

`s.doc.importFile` 有值时下载它，按扩展名转成 HTML → `setContent` → 保存（普通模式 `flush`；协同模式写进 Y.Doc 由服务端保存）→ `s.client.imported()` → `imported` 消息（标题去掉扩展名）。Word 里的图片交给 `s.client.upload` 存成附件，传不上去时内嵌成 data: 地址。协同模式会等连上以后再导入，内容才会进 Y.Doc。

## 工具栏

段落样式、加粗、斜体、列表、编号、表格（插入；在表格里时加行、加列、删行、删列、删除表格）、图片（选文件 → `s.client.upload` → 插入）、链接（有选中文字就加链接，没有就把地址插进去；已是链接时可以去掉）、撤销、重做。只读时不显示工具栏。

开发时（`import.meta.env.DEV`）`window.__editor` 是当前的 Tiptap 实例，截图脚本和调试用。
