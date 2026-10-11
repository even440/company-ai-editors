# 文件预览（kind = file）

上传的文件只看不改：`content` 一直是 `{}`，文件本身在 `s.doc.file`（`id`、`name`、`size`、`mime`、`url`）。`plain` 由宿主按文件类型提取，编辑器不管。

## 文件

- `FileViewer.tsx`：页面。顶部一行是图标、文件名、类型 · 大小 · MIME 和「下载」；下面按类型预览。
- `PdfView.tsx`：pdfjs 把每页连续画到 canvas，缩放（50% - 300%）和跳页；worker 用 Vite 的 `?url` 引入 `pdfjs-dist/build/pdf.worker.min.mjs`。
- `file.css`：外壳里需要补的样式；原型的 `.fv-main`、`.fv-img`、`.fv-pages`、`.fv-sheet` 在 `base.css` 里。

## 按类型预览

| 类型（按扩展名，其次 MIME） | 做法 |
|---|---|
| pdf | `PdfView`：先 `fetch` 成 ArrayBuffer 再交给 pdfjs（不用 pdfjs 自己的跨域请求） |
| png / jpg / gif / webp / bmp / svg / avif | `<img>`，点一下在「缩到预览区」和「原始大小」之间切换 |
| mp4 / webm / mov … | `<video controls>` |
| mp3 / m4a / wav / ogg … | `<audio controls>` |
| txt / log / json / xml / 代码文件 | `<pre>` 原样显示 |
| md | marked → HTML（去掉脚本和事件属性）→ `.doc-body` |
| csv | 自己解析（支持引号里的逗号和换行）→ 只读格子表（行列号和在线表格一样） |
| xlsx / xls | `xlsx` 解析，每个工作表一个标签页，一张只读格子表；最多显示 500 行 |
| docx | mammoth → HTML（复用 `../doc/import.ts` 的 `docxToHtml`）→ `.doc-body` |
| pptx 和其他 | 「这种格式不支持在线预览」+ 下载按钮 |

## 下载

`s.doc.file.url` 加 `download=1`（宿主按附件返回），`<a download>` 触发，然后发 `exported` 消息。宿主的 `export`（format `download`）和 `command`（name `download`）都触发同一个下载。

## 遗留

- PDF 没有配置 cMap 和标准字体目录：没有内嵌字体的中文 PDF 可能显示成方块；要支持的话把 `pdfjs-dist/cmaps` 和 `standard_fonts` 复制到静态目录并在 `getDocument` 里传 `cMapUrl` / `standardFontDataUrl`。
- 大 PDF 是从第一页顺序渲染到最后一页，没有按可见区域懒渲染。
