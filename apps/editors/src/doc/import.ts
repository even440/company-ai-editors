/**
 * 导入：把源文件转成 HTML，再由 Tiptap 的 setContent 解析成文档结构。
 * docx 用 mammoth，Markdown 用 marked，txt 按行成段落，html 直接用。
 */
import mammoth from 'mammoth';
import { marked } from 'marked';
import type { EditorClient, EditorFile } from '@cai/bridge';

const escapeHtml = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
export const extOf = (name: string) => (name.split('.').pop() ?? '').toLowerCase();

/** 去掉 HTML 里会执行的东西：脚本、内嵌框架和 on* 事件。Tiptap 解析时本来也不认识它们，这里多一层保险 */
export function sanitizeHtml(html: string): string {
  const d = new DOMParser().parseFromString(html, 'text/html');
  d.querySelectorAll('script, iframe, object, embed, style, link, meta').forEach((el) => el.remove());
  for (const el of d.body.querySelectorAll('*')) for (const a of [...el.attributes]) { if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name); }
  return d.body.innerHTML;
}

/** 纯文本：空行分段，单个换行也算一段（和宿主 insert 消息一致） */
export const textToHtml = (t: string) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => `<p>${escapeHtml(l)}</p>`).join('') || '<p></p>';

export const markdownToHtml = (md: string) => sanitizeHtml(marked.parse(md, { async: false, gfm: true, breaks: false }));

/**
 * Word：里面的图片交给宿主保存成附件（得到带令牌的地址），传不上去时退成 data: 地址内嵌。
 * mammoth 的样式映射保持默认：Heading 1-3 → h1-h3，列表、表格、加粗、斜体、链接都能对上。
 */
export async function docxToHtml(data: ArrayBuffer, client?: EditorClient): Promise<string> {
  const convertImage = mammoth.images.imgElement(async (image) => {
    const buf = await image.readAsArrayBuffer();
    const type = image.contentType || 'image/png', blob = new Blob([buf], { type });
    if (client) {
      try { const r = await client.upload(blob, 'image.' + (type.split('/')[1] ?? 'png').replace('jpeg', 'jpg')); return { src: r.url }; } catch { /* 上传不了就内嵌 */ }
    }
    const b64 = btoa(Array.from(new Uint8Array(buf), (b) => String.fromCharCode(b)).join(''));
    return { src: `data:${type};base64,${b64}` };
  });
  const r = await mammoth.convertToHtml({ arrayBuffer: data }, { convertImage });
  return sanitizeHtml(r.value);
}

/** 按扩展名把源文件转成 HTML；不认识的扩展名按纯文本处理 */
export async function importToHtml(file: EditorFile, data: ArrayBuffer, client?: EditorClient): Promise<string> {
  const ext = extOf(file.name);
  if (ext === 'docx') return docxToHtml(data, client);
  const text = new TextDecoder('utf-8').decode(data);
  if (ext === 'md' || ext === 'markdown') return markdownToHtml(text);
  if (ext === 'html' || ext === 'htm') return sanitizeHtml(text);
  return textToHtml(text);
}

/** 导入后的标题：宿主一般已经按文件名起好了，这里只把扩展名去掉 */
export const titleOf = (title: string, fileName: string) => title.replace(new RegExp(`\\.${extOf(fileName)}$`, 'i'), '').trim() || title;
