/**
 * 导入 Word 时里面的图片（2026-10-27：深圳同事导入一份 656 张图、64 MB 的操作手册，图片在 mammoth 转换时一张张排队经美国的服务器传，等了 4 分钟）：
 * 转换时先只收下图片、给占位地址，转完再一起交给宿主——内容一样的只传一次，同时传 PARALLEL 张，边传边报进度；传不上去的退成 data: 地址内嵌。
 * 顺手从文件头读出图片的像素宽高写进 <img>，浏览器在图片加载前就按比例留好位置：几百张懒加载的图陆续出来时，正文不会一直往下挤（目录跳过去的位置才准）
 */
import type { EditorClient } from '@cai/bridge';

/** 同时传几张 */
const PARALLEL = 8;

/** bytes：图片的字节（mammoth 的 readAsArrayBuffer 其实给的是 Uint8Array，统一按它处理） */
export interface PendingImage { bytes: Uint8Array; type: string }
/** 进度：已经传完几张（去重以后）、一共几张 */
export type ImageProgress = (done: number, total: number) => void;

/** 内容的指纹，用来认出一样的图；没有 crypto.subtle（不安全的 http 页面）时不去重 */
async function fingerprint(bytes: Uint8Array, i: number): Promise<string> {
  if (!globalThis.crypto?.subtle) return `#${i}`;
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

const dataUrl = (im: PendingImage) => `data:${im.type};base64,${btoa(Array.from(im.bytes, (b) => String.fromCharCode(b)).join(''))}`;
const fileName = (type: string) => 'image.' + (type.split('/')[1] ?? 'png').replace('jpeg', 'jpg');

/** 把图片交给宿主，返回每张图的地址（和传进来的顺序一样） */
export async function placeImages(images: PendingImage[], client: EditorClient | undefined, onProgress?: ImageProgress): Promise<string[]> {
  const keys = await Promise.all(images.map((im, i) => fingerprint(im.bytes, i)));
  const firstOf = new Map<string, number>();
  keys.forEach((k, i) => { if (!firstOf.has(k)) firstOf.set(k, i); });
  const unique = [...firstOf.values()], urlOf = new Map<number, string>();
  let done = 0, next = 0;
  onProgress?.(0, unique.length);
  const one = async (i: number) => {
    const im = images[i];
    let url = '';
    if (client) { try { url = (await client.upload(new Blob([im.bytes as Uint8Array<ArrayBuffer>], { type: im.type }), fileName(im.type))).url; } catch { /* 传不上去就内嵌 */ } }
    urlOf.set(i, url || dataUrl(im));
    onProgress?.(++done, unique.length);
  };
  // PARALLEL 个「搬运工」，每个传完一张就领下一张
  await Promise.all(Array.from({ length: Math.min(PARALLEL, unique.length) }, async () => { while (next < unique.length) await one(unique[next++]); }));
  return keys.map((k) => urlOf.get(firstOf.get(k)!) ?? '');
}

/** 图片的像素宽高：只读文件头（PNG、JPEG、GIF、WebP），认不出来、读不了返回 null（宽高可有可无，不能因为它丢了图片） */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  try { return sizeOf(b); } catch { return null; }
}
function sizeOf(b: Uint8Array): { w: number; h: number } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ok = (w: number, h: number) => (w > 0 && h > 0 && w < 100_000 && h < 100_000 ? { w, h } : null);
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return ok(v.getUint32(16), v.getUint32(20));
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return ok(v.getUint16(6, true), v.getUint16(8, true));
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === 'VP8 ') return ok(v.getUint16(26, true) & 0x3fff, v.getUint16(28, true) & 0x3fff);
    if (kind === 'VP8L') { const n = v.getUint32(21, true); return ok((n & 0x3fff) + 1, ((n >> 14) & 0x3fff) + 1); }
    if (kind === 'VP8X') return ok(1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16)));
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    // JPEG：跳过各段，找到帧头（SOF0–SOF15，除了 DHT C4、JPG C8、DAC CC）
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = v.getUint16(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return ok(v.getUint16(i + 7), v.getUint16(i + 5));
      i += 2 + len;
    }
  }
  return null;
}
