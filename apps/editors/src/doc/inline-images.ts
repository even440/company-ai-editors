/**
 * 正文里已经有的内嵌图片（data: 地址）传到宿主、换成文件地址（2026-11-14，Evan 发来知识库「TF Work操作手册」里一张破图的截图「无法查看图片」）。
 * 查下来那篇 337 张图里 75 张还是 data: 地址、143 张只剩一个空框：平台存正文时不认 data: 地址（平台 src/features/docs/content.ts 的 cleanDoc），
 * 这些图只活在协同状态里，凡是从正文重建协同状态的操作（恢复历史版本、通过接口整篇保存、创建副本）一走就没了。
 * 新粘贴进来的不会再是 data: 地址（paste.ts 先传再贴），这里管以前就在正文里的、导入 Word 时传不上去退成内嵌的、宿主插进来的：
 * 能改的人打开文档后扫一遍，内容一样的只传一次，传好了把用它的图片都换成文件地址（不进撤销记录）；传不上去的这次不再试，下次打开再试。
 * 两个人同时打开都会扫：每张传之前、换之前再看一眼还在不在，别人已经换掉了就不动。
 */
import type { Editor } from '@tiptap/react';
import type { EditorClient } from '@cai/bridge';
import { dataImage, imageSize } from './images';

/** 同时传几张 */
const PARALLEL = 4;
const isInline = (src: unknown): src is string => typeof src === 'string' && /^data:image\//i.test(src);
const fileName = (type: string) => 'image.' + (type.split('/')[1] ?? 'png').toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg');

/** 正文里还有没有用这个地址的图片 */
function has(e: Editor, src: string): boolean {
  let found = false;
  e.state.doc.descendants((n) => { if (found) return false; if (n.type.name === 'image') { if (n.attrs.src === src) found = true; return false; } return true; });
  return found;
}

/** editor 取当前的编辑器（连接变了会重建）；onFail 报这一轮有几张没传上去 */
export class InlineImages {
  private running = false;
  private again = false;
  private failed = new Set<string>();
  constructor(private editor: () => Editor | null, private client: EditorClient, private onFail: (n: number) => void) {}

  /** 扫一遍正文、传上去。正在传的时候又叫了，传完再扫一遍 */
  async run(): Promise<void> {
    if (this.running) { this.again = true; return; }
    this.running = true;
    try { do { this.again = false; await this.pass(); } while (this.again); } finally { this.running = false; }
  }

  private usable(): Editor | null {
    const e = this.editor();
    return e && !e.isDestroyed && e.isEditable ? e : null;
  }

  private async pass() {
    const e = this.usable();
    if (!e) return;
    const srcs = new Set<string>();
    e.state.doc.descendants((n) => {
      if (n.type.name !== 'image') return true;
      if (isInline(n.attrs.src) && !this.failed.has(n.attrs.src)) srcs.add(n.attrs.src);
      return false;
    });
    const list = [...srcs];
    let next = 0, bad = 0;
    const one = async (src: string) => {
      const now = this.usable();
      if (!now || !has(now, src)) return;
      const im = dataImage(src);
      let url = '';
      if (im) { try { url = (await this.client.upload(new Blob([im.bytes as Uint8Array<ArrayBuffer>], { type: im.type }), fileName(im.type))).url; } catch { /* 下面记成没传上去 */ } }
      if (!url) { this.failed.add(src); bad++; return; }
      this.replace(src, url, im ? imageSize(im.bytes) : null);
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, list.length) }, async () => { while (next < list.length) await one(list[next++]); }));
    if (bad) this.onFail(bad);
  }

  /** 用这个地址的图片都换成文件地址；没有宽高的顺手按图片补上（加载前按比例留位置） */
  private replace(src: string, url: string, size: { w: number; h: number } | null) {
    const e = this.usable();
    if (!e) return;
    const { tr } = e.state;
    let hit = false;
    e.state.doc.descendants((n, pos) => {
      if (n.type.name !== 'image') return true;
      if (n.attrs.src === src) {
        hit = true;
        const sized = Number(n.attrs.width) > 0 && Number(n.attrs.height) > 0;
        tr.setNodeMarkup(pos, undefined, { ...n.attrs, src: url, ...(size && !sized ? { width: size.w, height: size.h } : {}) });
      }
      return false;
    });
    // 换地址不算一次修改：撤销时不该退回 data: 地址
    if (hit) e.view.dispatch(tr.setMeta('addToHistory', false));
  }
}
