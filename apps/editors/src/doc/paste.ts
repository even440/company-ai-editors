/**
 * 粘贴、拖进来的图片（2026-11-11，用户写需求文档时反馈：「图片需要直接按 Ctrl+V 插入，不要点击选择图片插入，还得把图片保存本地」——
 * 以前截了图在正文里按 Ctrl+V 什么都不会发生，只能先把截图存成文件，再点工具栏的「图片」去选）。
 * 三种情况：
 * - 剪贴板里只有图片（截图、在别处「复制图片」、在文件夹里复制的图片文件）：传上去，插在光标处；
 * - 把图片文件拖进正文：一样，插在松手的地方；
 * - 带图的一段内容，图片的地址别人打不开——data: 内嵌的，或者 Word、WPS 复制出来的本机路径（file:///…/clip_image001.png，浏览器读不了，
 *   图片本身在同一次复制的 RTF 里）：先把图片传上去、把地址换掉，再按平常的粘贴贴进去（view.pasteHTML，表格、链接那些粘贴规则照常走）。
 *   正文里从头到尾不出现内嵌的大图和本机路径：协同时不会把几兆的 data: 地址发给每个人，撤销也是完整的一步。
 * 带文字的内容里地址是 http 的图片不动，和以前一样；复制单元格时表格软件顺带给的那张「单元格的截图」也不要（有文字就按内容贴）。
 */
import { Extension } from '@tiptap/core';
import type { Slice } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { dataImage, imageSize, rtfImages, type PendingImage } from './images';

/** 带图的一段内容：images 传上去以后，把地址按同样的顺序交给 finish，它把内容贴进 view */
export interface HtmlPaste {
  images: PendingImage[];
  /** 没法带过来的图片有几张（本机路径的图片在 RTF 里对不上） */
  lost: number;
  /** 贴进去了返回 true */
  finish: (view: EditorView, urls: string[]) => boolean;
}
export interface PasteHandlers {
  /** 图片文件：传上去，插在光标处（拖进来的，光标已经放到松手的地方） */
  files: (files: File[]) => void;
  html: (job: HtmlPaste) => void;
}

export const imagesIn = (list: ArrayLike<File> | null | undefined): File[] => Array.from(list ?? []).filter((f) => f.type.startsWith('image/'));

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
/** 这段 HTML 里有没有字（样式表、脚本里的不算） */
function hasText(html: string): boolean {
  if (!html) return false;
  const doc = parse(html);
  doc.querySelectorAll('style, script, title').forEach((el) => el.remove());
  return /\S/.test(doc.body.textContent ?? '');
}

const LOCAL = /^(data|file):/i;
/** 要贴的内容里有没有地址是 data:、本机路径的图片（按纯文本贴的时候没有图片节点，不会进来） */
function hasLocalImage(slice: Slice): boolean {
  let found = false;
  slice.content.descendants((n) => {
    if (n.type.name === 'image' && LOCAL.test(String(n.attrs.src ?? ''))) found = true;
    return !found;
  });
  return found;
}

/**
 * 把一段 HTML 里 data:、本机路径的图片收出来。本机路径的图片和 RTF 里的图片按顺序一一对应，张数对不上就不敢配（会张冠李戴），
 * 这些图片从内容里拿掉、算进 lost。没有要处理的图片返回 null（照平常的贴）。
 */
export function htmlPaste(html: string, rtf: string, replay: (view: EditorView, html: string) => boolean): HtmlPaste | null {
  const doc = parse(html), imgs = Array.from(doc.querySelectorAll('img'));
  const local = imgs.filter((el) => /^file:/i.test(el.getAttribute('src') ?? ''));
  const fromRtf = local.length ? rtfImages(rtf) : [], paired = fromRtf.length === local.length;
  const images: PendingImage[] = [], targets: HTMLImageElement[] = [];
  let lost = 0;
  for (const el of imgs) {
    const src = el.getAttribute('src') ?? '';
    const im = /^file:/i.test(src) ? (paired ? fromRtf[local.indexOf(el)] : null) : /^data:/i.test(src) ? dataImage(src) : undefined;
    if (im === undefined) continue;
    if (!im) { if (/^file:/i.test(src)) { el.remove(); lost++; } continue; }
    // 没写宽高的补上像素大小：图片加载出来之前就按比例留好位置（image.ts）
    const size = el.hasAttribute('width') ? null : imageSize(im.bytes);
    if (size) { el.setAttribute('width', String(size.w)); el.setAttribute('height', String(size.h)); }
    images.push(im); targets.push(el);
  }
  if (!images.length && !lost) return null;
  // 图片是单独一块：Word、网页把图片包在一个只有它的段落里，照原样贴会在每张图前面多出一个空段落
  for (const el of Array.from(doc.querySelectorAll('img'))) {
    const p = el.closest('p');
    if (p && !/\S/.test(p.textContent ?? '') && !p.querySelector('br')) p.replaceWith(...Array.from(p.querySelectorAll('img')));
  }
  return {
    images, lost,
    finish: (view, urls) => {
      targets.forEach((el, i) => { if (urls[i]) el.setAttribute('src', urls[i]); else el.remove(); });
      return replay(view, doc.body.innerHTML);
    },
  };
}

/**
 * 插完图片，选中的是那张图片：接着打字会把它顶掉，贴完截图想写两句说明的人就白贴了。
 * 把光标放到图片下面那一段的开头；下面不是正文段落（是标题、表格，或者已经到头了）就补一个空段落——连着贴几张图也不会攒出一串空行（空段落会被下一张图换掉）。
 * 动了返回 true
 */
export function caretAfterImage(tr: Transaction): boolean {
  const sel = tr.selection;
  if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'image') return false;
  const end = sel.to, $end = tr.doc.resolve(end);
  if ($end.nodeAfter?.type.name !== 'paragraph') {
    const para = tr.doc.type.schema.nodes.paragraph;
    if (!para || !$end.parent.canReplaceWith($end.index(), $end.index(), para)) return false;
    tr.insert(end, para.create());
  }
  tr.setSelection(TextSelection.create(tr.doc, end + 1));
  return true;
}

/** 只影响交互的扩展。on 每次现取，页面那边的处理函数可以跟着状态变 */
export const imagePaste = (on: () => PasteHandlers) => {
  // 换好地址再贴的那一次不再拦：传不上去时地址退成了 data:（images.ts），再拦就没完了
  let replaying = false;
  const replay = (view: EditorView, html: string): boolean => {
    if (view.isDestroyed || !view.editable) return false;
    replaying = true;
    try {
      view.focus();
      if (!view.pasteHTML(html)) return false;
      // 内容以图片结尾时一样把光标挪到图片下面
      const tr = view.state.tr;
      if (caretAfterImage(tr)) view.dispatch(tr.scrollIntoView());
      return true;
    } finally { replaying = false; }
  };
  return Extension.create({
    name: 'imagePaste',
    addProseMirrorPlugins() {
      return [new Plugin({
        key: new PluginKey('imagePaste'),
        props: {
          handlePaste(view, event, slice) {
            const cd = event.clipboardData;
            if (replaying || !cd || !view.editable) return false;
            const html = cd.getData('text/html'), files = imagesIn(cd.files);
            if (files.length && !hasText(html)) { on().files(files); return true; }
            if (!html || !hasLocalImage(slice)) return false;
            const job = htmlPaste(html, cd.getData('text/rtf'), replay);
            if (!job) return false;
            on().html(job);
            return true;
          },
          handleDrop(view, event, _slice, moved) {
            const dt = event.dataTransfer;
            if (moved || !dt || !view.editable) return false;
            const files = imagesIn(dt.files);
            if (!files.length || hasText(dt.getData('text/html'))) return false;
            event.preventDefault();
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (at) view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(at.pos))));
            view.focus();
            on().files(files);
            return true;
          },
        },
      })];
    },
  });
};
