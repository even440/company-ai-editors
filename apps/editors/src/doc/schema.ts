/**
 * 文档的结构（节点和样式）。从平台 src/features/docs/schema.ts 复制而来，要和平台服务端的协同服务保持一致：
 * 服务端把 Tiptap JSON 转成 Yjs 文档时用的是平台那一份，这里多出来的节点（图片）和属性（书签 anchor，见 anchors.ts）服务端也要认识才能保存。
 * 这里只放决定文档结构的扩展；撤销重做、占位符、协同这些只影响交互的，在编辑器里另外加。
 */
import { getSchema, type Extensions } from '@tiptap/core';
import { TableKit } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import { Anchors } from './anchors';
import { Image } from './image';
import { ListStyle } from './liststyle';
import { textStyleExtensions } from './textstyle';

/** Collaboration 扩展默认用的 Y.XmlFragment 名称；标题放在 Y.Text 'title' 里 */
export const Y_FIELD = 'default';
export const Y_TITLE = 'title';

/** 决定文档结构的扩展。撤销重做关掉：协同模式由 Collaboration 提供，非协同模式在编辑器里再打开 */
export const schemaExtensions = (): Extensions => [
  StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] }, link: { openOnClick: 'whenNotEditable', autolink: true }, undoRedo: false }),
  // 拖表格的竖线调列宽（2026-10-27 同事反馈拖不动）：宽度存在单元格的 colwidth 上，结构没变；平台那一份只用结构，不用跟着开
  TableKit.configure({ table: { resizable: true } }),
  Image,
  // 书签属性 anchor（标题、段落、列表项），平台那一份也有；顺带点文档内链接时在文档里跳转
  Anchors,
  // 字体、字号、颜色、底纹、对齐（textstyle.ts）和列表、编号的样式（liststyle.ts），2026-10-27；平台那一份也有
  ...textStyleExtensions(),
  ListStyle,
];

/** ProseMirror 的 schema，做结构转换时用 */
export const editorSchema = () => getSchema(schemaExtensions());
