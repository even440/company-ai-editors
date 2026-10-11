# 幻灯片：接宿主的代码

PPTist 本身不动（对上游文件的改动见 `../../CHANGES.md`），和 Company AI 宿主有关的都在这里：

| 文件 | 作用 |
|---|---|
| `boot.ts` | 启动：`openSession()`、装内容或导入 pptx、装上自动保存和宿主消息。`App.vue` 挂载时调一次 |
| `session.ts` | 会话、只读、错误、打印请求这几个全局状态 |
| `content.ts` | 内容格式和 store 之间的转换、纯文本 |
| `host.ts` | 宿主消息：`title`、`readonly`、`export`（pptx / pdf）、`command`（play / stop）、`insert`、`focus` |
| `upload.ts` | 图片先传给宿主，内容里存地址 |
| `CaiPrint.vue` | 导出 PDF：屏幕外画所有页，交给 PPTist 的打印工具 |

## 内容格式

```ts
{
  title: string            // 标题，和宿主的标题同步（以宿主为准）
  theme: SlideTheme        // 主题：backgroundColor、themeColors、fontColor、fontName、outline、shadow
  slides: Slide[]          // 页面：id、elements（text / image / shape / line / chart / table / latex / video / audio）、background、animations、remark……
  viewportSize: number     // 画布宽度基数，默认 1000
  viewportRatio: number    // 画布比例，默认 0.5625（16:9）
}
```

类型都在 `src/types/slides.ts`。空内容 `{}` 打开时建一页空白封面。`plain` 是每页的文字元素（文本框、带文字的形状、表格、公式、备注）去掉 HTML 后按页拼起来。

## 和 PPTist 的衔接

- 保存：监听 `slidesStore` 的 `slides / theme / viewportSize / viewportRatio`（不含 `slideIndex`，翻页不算改动），变了就 `s.markDirty()`。
- 只读：`App.vue` 在 `caiReadonly` 为真时直接显示放映视图，不进编辑器。
- 图片：`src/utils/image.ts` 的 `getImageDataURL` 先调 `uploadToHost`，传不了再退回 base64。
- 导入：`s.doc.importFile` 有值时下载源文件，用 PPTist 的 `importPPTXFile`（pptxtojson）装进 store，保存后 `s.client.imported()`。
