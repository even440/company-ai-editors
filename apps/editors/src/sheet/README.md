# 表格编辑器（kind = sheet）

基于 Univer 开源核心（`@univerjs/presets` + `@univerjs/preset-sheets-core`），导入导出用 SheetJS（`xlsx`）。入口 `apps/editors/sheet/main.tsx`，组件在这个目录。

## 内容格式

`content` 是 Univer 的 `IWorkbookData`，也就是 `univerAPI.getActiveWorkbook().save()` 的结果，原样存、原样加载：

```jsonc
{
  "id": "<内容编号>", "name": "<标题>", "appVersion": "1.0.3", "locale": "zhCN",
  "styles": { "hd": { "bl": 1, "bg": { "rgb": "#eaf1fe" } } },   // 样式表，格子用 s 按编号引用（也可以内联对象）
  "sheetOrder": ["sheet-01"],
  "sheets": {
    "sheet-01": {
      "id": "sheet-01", "name": "Sheet1", "rowCount": 50, "columnCount": 12,
      "cellData": { "0": { "0": { "v": "客户", "t": 1, "s": "hd" }, "3": { "v": 36, "t": 2 } }, "9": { "3": { "f": "=SUM(D2:D9)", "v": 196.1 } } },
      "mergeData": [{ "startRow": 0, "startColumn": 0, "endRow": 0, "endColumn": 6 }],
      "columnData": { "0": { "w": 120 } }, "rowData": { "0": { "h": 36 } }
    }
  }
}
```

- 格子 `{ v, t, f, s, p }`：`v` 值，`t` 类型（1 文字、2 数字、3 布尔，布尔的 `v` 是 0 / 1），`f` 公式字符串（带 `=`），`s` 样式，`p` 富文本（Univer 文档结构）。行号列号都从 0 起。
- 空内容 `{}`：打开时建一个空工作簿（一张 Sheet1，50 行 12 列）。
- `plain`：每个工作表每一行的非空格子按制表符拼、行间换行；多张表时每张表前加一行 `【表名】`。上限 5 万字。

## 改动检测与保存

监听 Univer 的 `CommandExecuted` 事件，只把类型为 MUTATION、编号以 `sheet.mutation.` 开头的命令当成改动（选区、滚动、激活工作表都是 operation，不算；单元格编辑器内部的 `doc.mutation.*` 和公式引擎的 `formula.mutation.*` 也不算）。另外排除几个不改内容的 mutation：`empty`、`set-worksheet-row-auto-height`、`mark-dirty-filter-change`、`set-worksheet-permission-points`、`data-validation-formula-mark-dirty`。工作簿刚建好的 0.8 秒内 Univer 自己跑的 mutation 也忽略。改动后 `s.markDirty(() => ({ content: save(), plain }))`，会话停下来 1.5 秒后保存；保存时把工作簿的 `name` 换成当前标题。

## 只读

`s.readonly` 为真（权限是 read / respond，或地址参数 `mode=read`）时 `workbook.setEditable(false)`，Univer 禁止编辑、工具栏按钮置灰，表格上方显示一条「只读」提示。宿主发 `readonly` 消息时同样切换，并写回 `s.doc.readonly`，这样会话的 `markDirty` 也会跟着停。

## 宿主消息

| 消息 | 处理 |
|---|---|
| `export` `xlsx` | 整个工作簿转成 SheetJS 工作簿写出：值、公式、合并、列宽行高、数字格式；字体颜色等样式不导出。文件名 `<标题>.xlsx` |
| `export` `csv` | 只导当前工作表，带 BOM（Excel 打开中文不乱码）。文件名 `<标题>.csv` |
| `insert` | `text`（或 `html` 转成文字）追加到当前工作表最后一个有内容的行之后：每行一行，制表符分列，纯数字串存成数字；行列不够时自动加 |
| `readonly` | 见上 |
| `title` | 记下新标题，下次保存写进工作簿的 `name` |
| `theme` | 会话处理；编辑器同时调 `univerAPI.toggleDarkMode()`，Univer 自己切深色 |
| `flush` | 会话处理 |
| `command` | 没有 |

导出后 `s.download(blob, 文件名)`，宿主收到 `exported`。

## 导入

`s.doc.importFile` 有值时：用 `s.client.assetUrl(id)` 下载，SheetJS 解析（xlsx / xls / csv），转成 `IWorkbookData`：

- 格子的值和类型、公式（SheetJS 的 `f` 加 `=`）、数字格式（`z` 变成样式的 `n.pattern`，日期靠它显示）、合并单元格、列宽行高、隐藏的行列和工作表都保留；
- 单元格样式（字体、填充、边框）不保留；共享公式只保留每个格子自己的公式字符串；
- 行数在数据基础上多留 20 行、列多留 4 列（至少 50 × 12）。

转换后立刻保存，再 `await s.client.imported()`，并发 `imported` 消息。解析失败就按空内容打开，提示并发 `error`。

## 文件

- `SheetEditor.tsx`：组件，Univer 实例、改动检测、宿主消息、导入流程。
- `convert.ts`：空工作簿、纯文本、SheetJS 和 `IWorkbookData` 互转、xlsx / csv 导出。
- `sheet.css`：外围样式（只读提示、导入遮罩、深色和手机宽度）。Univer 自己的样式从 `@univerjs/preset-sheets-core/lib/index.css` 引入。

## 已知限制

- 没有协同编辑，多人同时改走版本冲突（会话默认提示并刷新）。
- 公式在主线程算（没有配 worker），几万个公式以上会卡。
- 导出不含字体、填充、边框、条件格式等样式；导入同样。
