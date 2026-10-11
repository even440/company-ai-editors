# 流程图（flow）

基于 [AntV X6](https://x6.antv.antgroup.com/) 2.19 和官方插件 stencil（形状面板）、selection（选中、框选）、keyboard（快捷键）、history（撤销重做）、snapline（对齐线）、export（导出）。

## 内容格式

就是 `graph.toJSON()` 的结果，打开时 `graph.fromJSON`：

```json
{ "cells": [
  { "id": "a1", "shape": "cai-start", "position": { "x": 490, "y": 28 }, "size": { "width": 120, "height": 44 }, "data": { "kind": "start", "color": "blue" }, "attrs": { "label": { "text": "线索进入" }, "body": { "stroke": "var(--t-blue)", "fill": "var(--t-blue-bg)" } } },
  { "id": "e1", "shape": "cai-edge", "source": { "cell": "a1", "port": "bottom" }, "target": { "cell": "a2", "port": "top" }, "labels": [{ "attrs": { "label": { "text": "是" } } }] }
] }
```

- 节点形状（`shape`）：`cai-start` 开始/结束（圆角胶囊）、`cai-step` 步骤（圆角矩形）、`cai-cond` 判断（菱形）、`cai-sub` 子流程（双边框矩形）、`cai-text` 文本（无边框）。定义在 `shapes.ts`，每个节点四个方向各一个连接桩 `top` / `right` / `bottom` / `left`。
- `data.kind`、`data.color` 是类型和预设色（blue / green / orange / red / purple / gray），属性面板靠它们显示当前值；具体颜色写在 `attrs.body`（和 `attrs.inner`）里，值是 base.css 的 CSS 变量（`var(--t-blue)`、`var(--surface)`…），所以深色主题自动换色，内容不用改。
- 连线形状是 `cai-edge`：orth 路由、rounded 连接器、终点箭头；标签在 `labels[0].attrs.label.text`，最多一个。手动拖出的拐点在 `vertices`。
- 保存时去掉 `tools`（行内编辑框这类运行时状态）。
- 空内容是 `{}`：没有 `cells` 字段就按空白打开。
- `plain`：节点文字和连线标签按行拼接。

## 操作

- 左侧形状面板拖到画布新建节点；画布空白处拖动平移，滚轮缩放，Shift+拖动框选。
- 双击节点或连线改文字（X6 自带的 `node-editor` / `edge-editor` 工具，2.x 里要事先挂在格子上由它自己监听双击，所以打开内容和新增格子时挂上、只读时摘掉）；选中后右侧属性面板可以改文字、类型、颜色、连线标签，或删除。
- 鼠标移到节点上出现四个连接桩，从桩上拖到另一个节点的桩上连线。
- Delete / Backspace 删除选中；Ctrl+Z 撤销、Ctrl+Y / Ctrl+Shift+Z 重做（焦点在输入框里时不生效）。
- 工具栏：形状面板开关、撤销、重做、缩放、适应画布、自动排列。自动排列（`layout.ts`）按连线从开始节点往下分层：最长路径定层号，同层按父节点位置排序，忽略形成环的回边，并清掉连线拐点。
- 换类型时 X6 不能原地换形状：记下连线、删掉节点、按新形状建一个同编号的节点再把连线接回去，整个过程是一步撤销。

## 保存

`cell:change:*`（忽略 `tools`）、`cell:added`、`cell:removed` 之后防抖 300 毫秒 `markDirty`，会话在停下 1.5 秒后保存。宿主发 `flush` 时立刻提交。属性面板里输入文字期间用 `startBatch` / `stopBatch` 合成一步撤销。

## 宿主消息

| 消息 | 处理 |
|---|---|
| `export` `png` / `svg` | export 插件的 `toPNG`（2 倍清晰度，背景取当前主题的 `--surface`）/ `toSVG`（内容范围外扩 24px）；`copyStyles` 会把计算后的样式写进 SVG，CSS 变量因此被换成具体颜色。拿到 dataURL / SVG 文本后转成 Blob 交给 `s.download` |
| `insert` | 加一个步骤节点，文字是给的文本，放在现有内容下方并选中 |
| `readonly` | 禁止交互（`interacting` 返回 false），隐藏形状面板、属性面板和编辑类按钮；平移缩放仍然可以 |
| `theme` | 节点颜色是 CSS 变量，自动跟着变；网格画在 canvas 上，主题变了重画一次 |
| `flush` | 把防抖中的改动立刻提交并保存 |

## 手机宽度

700px 以下形状面板默认收起，点工具栏「形状」以浮层方式打开；属性面板浮在画布底部；工具栏按钮只留图标。画布支持单指拖动平移、滚轮或双指缩放。
