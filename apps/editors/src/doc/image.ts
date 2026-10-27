/**
 * 最简单的图片节点：starter-kit 3 里没有图片，又不想多装一个包。
 * 块级、不可再分，只记地址、说明和宽高；地址是宿主上传接口返回的带令牌地址。
 * 宽高是图片的像素大小（导入 Word 时从文件头读的，images.ts）：浏览器在懒加载的图片出来之前就按比例留好位置，样式里 max-width: 100% 照样缩到正文宽度
 */
import { Node, mergeAttributes } from '@tiptap/core';

export interface ImageAttrs { src: string; alt?: string | null; title?: string | null; width?: number | null; height?: number | null }

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
      height: { default: null, parseHTML: (el) => { const h = Number((el as HTMLElement).getAttribute('height')); return h > 0 ? h : null; } },
    };
  },
  parseHTML() { return [{ tag: 'img[src]' }]; },
  renderHTML({ HTMLAttributes }) { return ['img', mergeAttributes({ loading: 'lazy' }, HTMLAttributes)]; },
  addCommands() {
    return { setImage: (attrs) => ({ commands }) => commands.insertContent({ type: this.name, attrs }) };
  },
});
