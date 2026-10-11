# 思维笔记（mind）

大纲 / 导图两种模式共用一份节点树。导图用 [simple-mind-map](https://github.com/wanglin2/mind-map) 0.14 画，大纲是自己用 React 写的缩进列表。

## 内容格式

```json
{
  "root": { "data": { "text": "中心主题", "uid": "n…", "expand": true }, "children": [ { "data": { "text": "分支", "uid": "n…", "expand": true }, "children": [] } ] },
  "layout": "logicalStructure",
  "theme": "default",
  "mode": "map"
}
```

- `root`：simple-mind-map 的节点 `{ data, children }`。`data.text` 是文字，`data.uid` 是节点编号（选中、聚焦都靠它），`data.expand` 为 false 表示收起（simple-mind-map 把没写 expand 的节点当作收起，所以每个节点都显式写）。simple-mind-map 支持的其他字段（note、hyperlink、tag、样式）原样保留，导入 .xmind 时会带进来。
- `layout`：`logicalStructure` 逻辑结构图 | `mindMap` 思维导图 | `organizationStructure` 组织结构图 | `catalogOrganization` 目录组织图。
- `theme`：`default` 经典绿 | `blue` 商务蓝 | `fresh` 清新绿 | `warm` 暖橙 | `mono` 素雅灰（`themes.ts`；simple-mind-map 只内置 default，其余自己定义，每个都有深色版 `名字-dark`，跟平台主题切换，content 里只存基础名字）。
- `mode`：上次用的模式 `map` | `outline`。
- 空内容 `{}` 打开时是「中心主题」加两个分支。
- `plain`：所有节点的文字，按深度缩进，一行一个。

## 文件

- `MindEditor.tsx`：工具栏、模式切换、宿主消息、导入导出；树的权威副本在 `rootRef`，导图模式下由 simple-mind-map 的 `data_change` 回写。
- `MapView.tsx`：simple-mind-map 容器，注册插件（Export、ExportXMind、Drag、Select、KeyboardNavigation、TouchEvent）。
- `Outline.tsx`：大纲。Enter 新建同级（根节点上是新建子节点）、Tab 变子节点、Shift+Tab 升一级、Backspace 删空节点、上下方向键移动、点三角折叠。
- `model.ts`：类型、空内容、规范化、纯文本、Markdown、OPML 解析、大纲的结构操作。
- `themes.ts`：主题定义。
- `simple-mind-map.d.ts`：simple-mind-map 没有类型声明，这里声明用到的部分。

## 宿主消息

- `export`：`png`（导图图片；大纲模式下在屏幕外临时画一张）、`xmind`（simple-mind-map 的 XMind 导出）、`md`（Markdown 大纲：根是一级标题，其余是嵌套列表）。
- `insert`：text（或 html 转成的文字）按行拆开，每行加成选中节点（没有就是根）的子节点。
- `command`：`mode`（args `map` | `outline`）；`expand`：给选中节点加「目标、关键步骤、风险与对策」三个子节点（AI 用）。
- `readonly`、`flush`、`theme` 按约定处理。

## 导入

`s.doc.importFile` 是 `.xmind`（simple-mind-map 的解析器，新旧两种 XMind 格式都行）或 `.opml`（body 下只有一个 outline 时它就是根，否则用 head 的标题当根）。解析后保存、`imported()`、发 `imported` 消息。示例文件 `tools/samples/sample.xmind`（假宿主的 `demo-mind-import`）。
