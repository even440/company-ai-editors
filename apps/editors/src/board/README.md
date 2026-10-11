# 画板（board）

基于 [Excalidraw](https://github.com/excalidraw/excalidraw) 0.18 的白板：手绘风格的形状、箭头、文字、便签、图片，自带工具栏、撤销重做、框选、对齐和手机布局。

## 内容格式

```json
{
  "elements": [ … ],
  "appState": { "viewBackgroundColor": "#ffffff", "gridSize": 20, "gridStep": 5, "gridModeEnabled": false },
  "files": { "<fileId>": { "mimeType": "image/png", "id": "…", "dataURL": "data:image/png;base64,…", "created": 0 } }
}
```

- `elements`：Excalidraw 的元素数组（`ExcalidrawElement[]`），保存时已去掉 `isDeleted` 的元素。
- `appState`：只保存和内容有关的字段：`viewBackgroundColor`、`gridSize`、`gridStep`、`gridModeEnabled`。视口位置、缩放、选中状态、当前工具都不保存。
- `files`：图片元素引用的附件（Excalidraw 的 `BinaryFiles`，内容是 dataURL），只保留还被图片元素引用的。
- 空内容是 `{}`：没有 `elements` 字段就按空白画板打开。
- `plain`：所有文字元素的文字按行拼接（`getTextFromElements`）。

## 保存

Excalidraw 每次指针移动都会回调 `onChange`，编辑器按内容签名（元素版本号之和 + 保存的 appState 字段 + 附件数）判断是否真的改了，停下来 300 毫秒后 `markDirty`，再由会话在 1.5 秒后保存。宿主发 `flush` 时立刻提交。

## 宿主消息

| 消息 | 处理 |
|---|---|
| `export` `png` / `svg` | `exportToBlob` / `exportToSvg` 导出整幅内容（含背景，深色主题按深色导出），`s.download` 下载，文件名是标题加扩展名。SVG 不内嵌字体 |
| `insert` | 在现有内容下方加一个文字元素（画板为空时放在原点附近），并滚动到它 |
| `readonly` | 切换 Excalidraw 的 `viewModeEnabled`，右上角显示「只读」 |
| `theme` | 由会话处理，这里把 `theme` 传给 Excalidraw |
| `flush` | 把防抖中的改动立刻提交并保存 |

## 字体

Excalidraw 默认从公网 CDN 下载字体。`fonts.ts` 让 Vite 把 `node_modules/@excalidraw/excalidraw/dist/prod/fonts` 下的字体当资源打包（按 unicode-range 拆块，用到才下载），并在注册字体时把地址换成打包后的地址，因此不需要公网，也不需要复制字体的构建步骤。如果以后改成官方做法（复制字体目录并设置 `window.EXCALIDRAW_ASSET_PATH`），删掉 `fonts.ts` 即可。

## 界面

中文界面（`langCode="zh-CN"`，语言包按需加载）。主菜单只保留「导出图片」「查找」「清空画布」「帮助」「画布背景」，去掉了打开文件、保存到本地和 excalidraw.com 的入口。
