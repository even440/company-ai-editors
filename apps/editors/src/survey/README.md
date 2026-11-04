# 问卷（survey）

四个页签：编辑、预览填写、数据统计、设置。`mode=fill`（填写链接，令牌权限 respond）时只有填写页。

## 内容格式

```json
{
  "desc": "用 1 分钟告诉人事你的想法。",
  "qs": [
    { "id": "q1", "type": "single", "t": "你所在的部门", "opts": ["销售部", "研发部"], "req": true },
    { "id": "q2", "type": "rate", "t": "满意度", "req": false }
  ],
  "set": { "anon": false, "once": true, "due": "2026-10-15" }
}
```

- `qs[i]`：`id` 题目编号（答卷按它存）、`type` 题型、`t` 标题、`opts` 选项（只有 single 单选 / multi 多选 / select 下拉有）、`req` 必答。
- 题型：`single` 单选、`multi` 多选、`select` 下拉、`text` 填空、`rate` 评分（1 到 5）、`date` 日期。
- `set`：`anon` 匿名（统计和导出不显示填写人）、`once` 每人只能填一次、`due` 截止日期（`YYYY-MM-DD`，空表示不限；当天还能填）。
- 空内容 `{}` 打开时是一道单选题。
- `plain`：说明、每道题的标题和选项。

答卷不在 content 里：填写走 `s.client.respond(answers)`，`answers` 是 `{ [题目 id]: 值 }`，多选是数组、评分是 `'1'`…`'5'`、其余是字符串，没填的题不写。统计用 `s.client.responses()`。收集状态 `s.doc.collecting` 由 `s.client.collecting(on)` 改，`s.doc.responded` 是当前成员填过的次数（配合 `once` 提示已填过）。

## 文件

- `SurveyEditor.tsx`：页签、状态、宿主消息、提交 / 发布 / 导出。
- `EditTab.tsx`：题目编辑（题型、选项、必答、上下移动、复制、删除、添加各题型）。
- `FillTab.tsx`：填写表单，预览和 fill 模式共用；`blocked` 有值时不能提交（没发布、已填过、已截止）。
- `StatsTab.tsx`：答卷数等数字，每道题一张卡片（选择题横条分布、评分平均和分布、填空列表）。
- `SetTab.tsx`：收集状态（发布 / 停止、「复制填写链接」交给宿主）和填写规则。
- `Editable.tsx`：行内可编辑文字（空的时候的提示经 `data-ph` 给样式）。`model.ts`：类型、规范化、纯文本、常用题。`ai.ts`：AI 出的题。`i18n.ts`：界面文字，五种语言（见下面「界面语言」）。`export.ts`：答卷导出 Excel（xlsx 按需加载，表头、表名按界面语言）。

## 界面语言

宿主在地址上带 `ui=<语言>`（zh-CN / en / pt-BR / ja / ko，`shell/i18n.ts` 读；没带按浏览器语言，认不出用中文）。界面上的字都在 `i18n.ts` 的 `T`，带值的句子是函数；新建的题目、选项、常用题的默认文字也按界面语言写进内容（之后就是内容，不随界面语言变）。日期、时间按界面语言的写法。

## 宿主消息

- `export`：`xlsx`，答卷一行一份（序号、填写人（匿名时没有）、提交时间、每题一列），另有一张「题目」表。
- `command`：`gen`，追加三道常用题（满意度评分、改进方面多选、其他建议）。
- `insert`：平台 AI 面板的「加到问卷」，`text` 是 AI 的回答，按下面的格式认出题目（`ai.ts` 的 `parseQuestions`）；问卷还只有一道没改过的默认题（任何一种界面语言的默认题都算，`isBlank`）时替换它，否则加在后面；问卷还没有说明时用 `>` 那一行。认不出题目时提示请 AI 按问卷格式重出。格式和平台系统指令（platform 的 `modules/docs/file-text.ts` 的 `insertBrief('survey')`）是一份约定，改的时候两边一起改：

  ```
  > 问卷说明（可选）
  1. [single*] 题目
  - 选项
  - 选项
  2. [rate] 题目
  ```

  方括号里是题型（`single` `multi` `select` `text` `rate` `date`，五种语言的题型名也认），`*` 是必答；模型不照做的写法（加粗、`Q1.`、`1)`、`A.` 选项、题目末尾的「（必答）」、前后的客套话）也容忍，没写题型的有选项算单选（题目里写了「可多选」算多选）、没选项算填空。
- `request share`：「复制填写链接」由宿主处理（编辑器不知道平台的链接格式）。
- `readonly`：不能改题目和设置，仍能看统计和填写；`title`：填写表单顶上的标题；`flush`、`theme` 按约定处理。
