# 文档编辑器（kind = doc）

从平台 `src/features/docs/DocEditor.tsx` 搬来的正文编辑器：Tiptap + Yjs 协同，只保留正文；标题、分享、AI 面板由宿主负责。

## 文件

- `DocEditor.tsx`：页面。协同连接、工具栏、链接弹窗、图片上传、导入、宿主消息。
- `schema.ts`：节点集合 `schemaExtensions()`、`Y_FIELD`（正文所在的 Y.XmlFragment 名 `default`）、`Y_TITLE`（标题所在的 Y.Text 名 `title`）。从平台复制，多加了 `image` 节点。**平台服务端的协同服务和 `cleanDoc` 白名单也要认识 `image`，否则协同转换或保存时图片会被丢掉。**
- `image.ts`：最简单的图片节点（块级、`src` / `alt` / `title` / `width` / `height`），starter-kit 3 没有图片节点，又不想多装包。宽高是图片的像素大小：浏览器在懒加载的图片出来之前按比例留好位置；同样的宽高写成 `contain-intrinsic-size` 给屏幕外不画的图占位（见「长文档」）。
- `images.ts`：导入 Word 时的图片：去重、同时传、读像素宽高（见「导入」）。
- `textstyle.ts`、`liststyle.ts`、`format.tsx`：格式（见「格式」）：文字的字体、字号、颜色、底纹和段落对齐；列表、编号的样式；工具栏上的这几个按钮。
- `outline.tsx`：目录（见「目录」）。
- `jump.ts`：跳到正文里的某一块（目录、书签和文档内链接共用，见「目录」）。
- `content.ts`：拼结构的小函数、`contentOf`（空内容 `{}` → 空白文档）、`plainOf`（纯文本）、`paragraphsOf`（文字按行成段落）。和平台 `content.ts` 里的同名函数一致。
- `export.ts`：`toDocx`（docx 库）、`toMarkdown`。
- `import.ts`：docx（mammoth）、md（marked）、txt、html → HTML，再由 `editor.commands.setContent(html)` 解析；`sanitizeHtml` 去掉脚本和事件属性。
- `doc.css`：正文、工具栏、别人的光标、评论高亮、打印样式。从平台 `docs.css` 复制需要的部分。
- `comments.ts`：评论（见下面「评论」）：锚点的生成和找回、高亮（ProseMirror decoration）、点击、找不到的评论。

## 内容格式

`content` 是 Tiptap JSON：`{ type: 'doc', content: [...] }`。节点：`paragraph`、`heading`（level 1-6）、`bulletList` / `orderedList` / `listItem`、`blockquote`、`codeBlock`、`horizontalRule`、`hardBreak`、`table` / `tableRow` / `tableHeader` / `tableCell`、`image`（`attrs.src` 是宿主上传接口返回的带令牌地址）、`text`。样式：`bold`、`italic`、`strike`、`code`、`underline`、`link`、`textStyle`（颜色、底纹、字体、字号）。属性：标题和段落的 `textAlign`，列表的 `listStyle`，单元格的 `colwidth`（拖过的列宽，像素），见「格式」。

`plain` 是 `plainOf(content)`：段落、标题、列表项每个一行，表格一行一行、单元格之间用竖线隔开。

## 两种模式

| | 协同（默认） | 普通（地址参数 `collab=0`） |
|---|---|---|
| 内容来源 | `ws(s)://宿主/ws/collab/<编号>?token=…` 上的 Y.Doc：正文 `Y.XmlFragment 'default'`，标题 `Y.Text 'title'` | `s.doc.content` |
| 保存 | 服务端自己落库，编辑器不调保存接口 | 改动后 `s.markDirty(() => ({ content, plain }))`，会话停下来 1.5 秒后保存 |
| 在线的人 | awareness 里的人 → `present` 消息（服务端会把 `user` 换成登录身份，页面冒充不了）；名单变了才发，光标动不算 | 会话的心跳（`/presence`） |
| 标题 | 宿主发 `title` 消息时写进 Y.Text；Y.Text 变了（别人改的）发 `title` 消息给宿主 | 宿主发 `title` 时只记下来 |
| 连接状态 | `collab` 消息：connecting / connected / reconnecting / offline / denied / failed | 不发 |

协同模式 6 秒没同步上（`failed`）或服务端拒绝（`denied`，关闭码 4400-4499）时，用打开时拿到的 `s.doc.content` 显示**只读**视图并提示，可以点「重试」。离线（断开 12 秒以上）时还能继续写，重连后自动合并。

y-websocket 的 `WebsocketProvider(serverUrl, roomname, doc, { params })`：`serverUrl` 是 `s.wsUrl()` 去掉 `/ws/collab/<编号>?token=…` 之后再接 `/ws/collab`，`roomname` 是文档编号，`params: { token, v }` 会拼到地址上。

`v` 是这个编辑器认得的文档结构版本（`DocEditor.tsx` 的 `COLLAB_V`，平台 `src/server/modules/docs/collab.ts` 的 `COLLAB_V` 跟着改）：现在用的 y-tiptap 3.0.9 遇到不认识的样式（mark）会把整段文字从协同文档里删掉，所以结构里加新的样式时两边一起加一，发布时还开着的旧页面连协同会被关闭码 4426 拒绝，显示「编辑器已更新，请刷新页面」。新加属性（attrs）旧页面只是不认、编辑那一块时会丢掉，也算在内一起加。2：格式（2026-10-27）。

## 宿主消息

- `insert`：`text` 按行成段落、或 `html`，插到文末。只读时提示。
- `export`：`docx`（标题、段落、列表、引用、代码块、表格、图片、加粗 / 斜体 / 删除线 / 代码 / 链接，以及「格式」里的对齐、字体字号颜色底纹、列表样式、列宽）、`md`、`pdf`（`window.print()`，打印样式只打印正文）。
- `readonly`：切换 `editable`，工具栏跟着显示或隐藏。
- `title`：见上表。
- `focus`：光标回到正文。
- `flush`：会话自己处理；协同模式没有要写回的东西。

- `comments` / `comment-focus` / `comment-pending`：见「评论」。

编辑器发给宿主：`collab`、`present`、`title`、`selection`（选区变化节流 300 毫秒，选中的文字；取消选中发空字符串）、`imported`、`exported`、`comment-new`、`comment-open`、`comment-orphans`。

## 导入

`s.doc.importFile` 有值时下载它，按扩展名转成 HTML → `setContent` → 保存（普通模式 `flush`；协同模式写进 Y.Doc 由服务端保存）→ `s.client.imported()` → `imported` 消息（标题去掉扩展名）。Word 里的图片交给 `s.client.upload` 存成附件，传不上去时内嵌成 data: 地址。协同模式会等连上以后再导入，内容才会进 Y.Doc。

图片（`images.ts`，2026-10-27：深圳同事导入一份 656 张图、64 MB 的操作手册，图片在 mammoth 转换时一张张排队经美国的服务器传，等了 4 分钟）：mammoth 转换时只收下图片、给占位地址 `cai-img:<序号>`，转完再一起交给宿主——内容一样的（SHA-256）只传一次、同时传 8 张，页面上显示「正在导入 xxx：处理图片 n / 总数」；从文件头读出像素宽高（PNG、JPEG、GIF、WebP）写进 `<img>`。mammoth 的 `readAsArrayBuffer()` 给的其实是 `Uint8Array`，`convertImage` 里抛错时 mammoth 会悄悄丢掉那张图，所以读宽高的地方出错只当没有宽高。`s.client.upload` 先试直传对象存储（`packages/bridge` 的 `EditorClient.upload`：宿主的 `POST /uploads` 给签名地址，浏览器直接 PUT 到桶里，再 `/uploads/<id>/complete` 登记；没配对象存储时交给 `/uploads/<id>/local`），宿主不认、文件不小于 32 MB、PUT 不上去、服务端出错时退回 `/asset`。

## 目录

`outline.tsx`（2026-10-27，深圳同事的操作手册很长，要能读出目录、点了跳过去，照 Word / WPS 左边的导航窗格）：按正文顶层的一到六级标题列出来（用户说文档会用到五级、六级；编辑器的标题从三级放开到六级，工具栏的段落样式有「标题 1」到「标题 6」，导入 Word 不再把四到六级换成段落），有下级的能收起、展开，头上有「全部收起」「全部展开」；滚动时当前读到的那一节亮着（二分查找标题离滚动容器顶上的距离），当前项不在视野里时只滚目录自己。
- 编辑器外壳宽到 880 像素（`TOC_WIDE`）时固定在正文左边，窄的时候（手机、AI 助手右边那块、文档页开着 AI 面板）是左下角的圆按钮，点了从左边滑出来、选了就收起。
- 开着还是关着按人记在本机（`localStorage` 的 `cai-doc-toc`），没设过时宽屏、有三个以上标题才默认打开；没有标题时不出按钮。
- 点了跳过去（`jump.ts` 的 `jumpToPos`，书签和文档内链接的 `jumpTo` 也用它）：离得远直接到（一路滑过去会把途中懒加载的图都拉下来），近的平滑滚；之后 4 秒内有图片加载出来、正文高度变了（没写宽高的老图会把正文往下挤，深圳同事点「第十四章，14.2 基础设置」落点不对就是这样：书签是对的）就重新对准，本人滚动、点击、按键以后不再管。
- 目录在 `.ed-row` 里和 `.ed-body` 并排，评论按钮（`.ed-body > .cmt-btn`）和高亮照旧按 `.ed-body` 定位。打印时不显示。

## 看大图

双击图片（只读时单击也行，触屏上双击；编辑时单击是选中图片，好拖动、删除）发 `image-view`：全文的图片按出现的顺序、点的是第几张，宿主全屏打开看图（平台用聊天里同一个看图组件：缩放、旋转、翻看；内容设了禁止下载、本人只能看时不给复制、下载）。2026-10-27 同事反馈知识库、文档里的图片不能双击放大。只读时鼠标在图片上是放大镜。

## 评论

评论串、回复、@ 提到都在宿主；编辑器只管选范围、画高亮、报点击和找不到的锚点。加评论**不改正文**（高亮全是 decoration，不写样式标记、不调保存），所以只读的人也能评论。宿主发过 `comments`（哪怕是空数组）以后才出评论入口。

- **怎么评论**：选中文字后，选区末尾下方浮出「评论」按钮（编辑、只读都有，手机宽度也在选区下方）；或者按 Ctrl+Alt+M（Mac 上 ⌘+⌥+M，快捷键挂在 window 上，只读时正文拿不到焦点也能用）。发 `comment-new`，锚点前后的空白会去掉；只选了图片、空段落时提示先选文字。
- **锚点**（`DocCommentAnchor`）：`rel` 是起止位置的 Yjs 相对位置（挂在 `Y.XmlFragment 'default'` 上；起点粘在后一个字上、终点粘在前一个字上，在评论两头打字不会被算进去），`quote` 选中的纯文字（段落之间换行，最多 500 字）、`len` 完整长度、`prefix` / `suffix` 前后各 32 字、`at` 创建时的位置。普通模式（`collab=0`）和协同没连上时创建的评论没有 `rel`。
- **找回来**：先按相对位置；相对位置还认识但两头落到一起（原文被删了）就算找不到，不再按文字找，撤销删除后会回来。相对位置不认识（普通模式，或协同服务按保存的内容重建了 Y.Doc、旧编号全没了）时按 `quote` 在全文里找，用前后文挑对的那处（只有一处直接用，好几处要前后文对得上）；原文也被改过、一处都找不到时，用前后文夹出中间那段。协同模式下按文字找到的会在当前 Y.Doc 上补一份相对位置（只在内存里），之后靠它跟。
- **重算**：本地改动按事务的 mapping 挪；远端改动、协同的撤销重做（y-prosemirror 每次整篇替换）按相对位置重算；改动停下来 1 秒后整体再算一遍并报 `comment-orphans`（收到 `comments` 后总报一次，之后有变化才报；协同模式没连上时不报）。已解决的评论也算位置、也会报找不到，只是不画高亮。
- **高亮**：未解决的评论黄色底加下划线（`.cmt-hl`，带 `data-cid`），当前评论（`comment-focus`，或刚点过的）和评论框开着时的范围（`comment-pending`）颜色更重；`comment-focus` 指向已解决的评论时也临时显示，并滚到它（不滚宿主页面）。打印时不显示。点高亮发 `comment-open`，几条重叠时取最短的那条；拖选文字松手不算点击。
- **限制**：按文字找回依赖原文还在，被大段改写又重建过 Y.Doc 的评论会报找不到；一段文字被剪切粘贴到别处，协同模式下算原文被删。

## 格式

2026-10-27 深圳同事反馈：没有常用的对齐方式，改不了字体、字号、字的颜色，不能给文字加底纹；列表只有圆点、编号只有 1. 2. 3.；表格的竖线拖不动。

- **文字**（`textstyle.ts`）：Tiptap 的 `TextStyle`（`<span style>`）加 `Color`、`BackgroundColor`、`FontFamily`、`FontSize` 四个属性，命令就是它们自带的 `setColor` / `unsetColor` 这些。工具栏里的字体（`FONTS`：微软雅黑、宋体、黑体、楷体、仿宋、Arial、Times New Roman、Courier New，值是 CSS 的 font-family，前面是 Windows 的字体、后面退到 Mac 上相近的）、字号（`SIZES`，磅，和 Word 一样，括号里是中文字号）、文字颜色和底纹各 7 种（`TEXT_COLORS` 选的是白底和深色底上都看得清的，`BG_COLORS` 偏浅）。
- **粘贴进来的样式**只留看得出是特意设的：彩色、不太深也不太浅的字（黑、白、灰多半是原网页的默认颜色，深色模式下会看不见；Word 的「深蓝」这种很深的也不留），偏浅的彩色底纹（白底、灰底、深色底不留；Word 的高亮写成 `background` 简写也认），`FONTS` 里认得的字体（Word 里常写中文名，换成 `FONTS` 的写法），pt / px 的字号（6～96 磅）。颜色统一存成 `#RRGGBB`。没有这几种样式的 `<span>`（Word 的 `mso-*`）不建空样式。
- **对齐**：`TextAlign`，标题和段落的 `textAlign`（center / right / justify；左对齐是默认，选它就是去掉）。快捷键 Ctrl+Shift+L / E / R / J（Mac 上 ⌘⇧）。
- **列表、编号的样式**（`liststyle.ts`）：列表节点的 `listStyle`，页面上是 `list-style-type`：项目符号 circle、square（默认实心圆），编号 lower-alpha、upper-alpha、lower-roman、upper-roman、cjk-ideographic（默认 1. 2. 3.）。`setListStyle(type, style)` 改光标所在的最里面那层；工具栏「列表」「编号」旁边的小三角选，还不是这种列表时先变过去。
- **表格列宽**：`TableKit` 开了 `resizable`，鼠标靠近竖线出现蓝线，拖动改的是这一列每个格子的 `colwidth`。行高跟着内容走，拖不了。
- **深色模式**（`doc.css`）：有底纹、没设文字颜色的字换成深色；设了颜色、没有底纹的字调亮一些。
- **导出 Word**（`export.ts`）：对齐写成段落的对齐，颜色、底纹（字符底纹）、字号（半磅）、字体（第一个名字）写到每段文字上；列表每种（样式、起始号）一份编号定义，每个编号列表一个实例，各自从 1（或起始号）编（以前所有编号列表接着编号）；拖过列宽的表格按那个宽度、固定列宽（太宽时按 A4 正文宽度缩），没拖过的铺满；合并的行也带上。Markdown 表示不了这些，照旧只有文字。
- 平台那一份（`src/features/docs/schema.ts`）有同样的样式和属性，服务端做协同转换时才不丢；`content.ts` 的 `cleanDoc` 再按格式清洗一遍（这些值会写进页面的 style 属性）。

## 工具栏

段落样式、字体、字号、加粗、斜体、文字颜色、底纹、对齐、列表、编号（旁边的小三角选样式）、表格（插入；在表格里时加行、加列、删行、删列、删除表格）、图片（选文件 → `s.client.upload` → 插入）、链接（有选中文字就加链接，没有就把地址插进去；已是链接时可以去掉）、撤销、重做。只读时不显示工具栏。按钮多，宽度不到 1120 像素时按钮上只留图标（鼠标停上去有说明），再窄就换行。

颜色、底纹、对齐和列表样式是按钮加弹出的面板（`format.tsx` 的 `Drop`）：面板挂在按钮下面（右边放不下时贴着按钮右边），点外面、按 Esc、切到别的窗口时收起；按下按钮和面板时不抢正文的焦点，选中的文字一直显示着。工具栏的层级压在正文里的浮动按钮（目录、评论）上面，面板才不被挡。

开发时（`import.meta.env.DEV`）`window.__editor` 是当前的 Tiptap 实例，截图脚本和调试用。

## 长文档

2026-10-30 同事反馈编辑迁移过来的操作手册很卡、整台电脑跟着卡（新建的空文档正常）。本机造了一份同样规模的 Word（14 章、854 个标题、15 万字、627 张 1440×820 的截图）走真实的导入，打开后在中间打字，用浏览器把 CPU 降到四分之一模拟普通笔记本量：

- 屏幕外的图片不排版、不画：`doc.css` 给正文里的 `img` 加 `content-visibility: auto`，`image.ts` 按图片的像素宽高写 `contain-intrinsic-size` 占位（加上 `width` / `height` 属性给的比例，缩到正文宽度时高度也对；没记宽高的老图片按 320×180），画过一次以后按真实大小记着。打印时全部画出来。只给图片加，不给每个段落加：每一块都加时浏览器要一直盯着几千个块在不在屏幕上，反而多花时间。
- 在线的人名单没变就不发 `present`：光标一动 awareness 就变，以前每按一个键发一次，宿主整个文档页跟着重画（平台那边也改成名单没变不重画）。
- 目录（`useToc`）标题没变时不换数组、不重画，只把各项的 `pos` 改成新的。

量的结果（1920 宽、目录开着，打 32 个字）：每个键从按下到画面更新 47 → 37 毫秒，50 毫秒以上的卡顿 14～17 次 → 1 次；不降速时 16 → 13 毫秒。滚动条总高度从头滚到尾不变，目录跳转还是准的。剩下的时间主要是 ProseMirror 视图和协同（y-tiptap）每个键对比整篇、浏览器在超长的可编辑区里同步光标，暂时不动。
