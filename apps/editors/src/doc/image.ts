/**
 * 最简单的图片节点：starter-kit 3 里没有图片，又不想多装一个包。
 * 块级、不可再分，只记地址、说明和宽度；地址是宿主上传接口返回的带令牌地址。
 */
import { Node, mergeAttributes } from '@tiptap/core';

export interface ImageAttrs { src: string; alt?: string | null; title?: string | null; width?: number | null }

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    image: { /** 在光标处插一张图片 */ setImage: (attrs: ImageAttrs) => ReturnType };
  }
}

export const Image = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: { default: null, parseHTML: (el) => { const w = Number((el as HTMLElement).getAttribute('width')); return w > 0 ? w : null; } },
    };
  },
  parseHTML() { return [{ tag: 'img[src]' }]; },
  renderHTML({ HTMLAttributes }) { return ['img', mergeAttributes({ loading: 'lazy' }, HTMLAttributes)]; },
  addCommands() {
    return { setImage: (attrs) => ({ commands }) => commands.insertContent({ type: this.name, attrs }) };
  },
});
