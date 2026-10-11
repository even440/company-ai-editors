/**
 * Excalidraw 的字体（手写体 Excalifont、中文 Xiaolai 等）默认从公网 CDN 下载；要自己托管，官方做法是把
 * node_modules/@excalidraw/excalidraw/dist/prod/fonts 复制到某个地址并设置 window.EXCALIDRAW_ASSET_PATH。
 * 平台只在内网用，构建里又没有复制字体的步骤，所以这里让 Vite 把字体文件当普通资源打包（开发时直接从 node_modules 读），
 * 再在 Excalidraw 注册字体（new FontFace）时把 CDN 地址换成打包后的地址。字体按 unicode-range 拆成小块，只有用到的块才会下载。
 * 这个模块必须在 @excalidraw/excalidraw 之前引入。
 */
const FILES = import.meta.glob('../../../../node_modules/@excalidraw/excalidraw/dist/prod/fonts/*/*.woff2', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** 「字体目录/文件名.woff2」→ 打包后的地址 */
const local = new Map<string, string>();
for (const [p, url] of Object.entries(FILES)) local.set(p.slice(p.indexOf('/fonts/') + 7), url);

const Native = window.FontFace;
if (Native && local.size) {
  const Patched = function (this: FontFace, family: string, source: string | BufferSource, descriptors?: FontFaceDescriptors) {
    const src = typeof source === 'string'
      ? source.replace(/url\(([^)]*?\/fonts\/([^/)]+\/[^/)]+\.woff2))\)/g, (m, _full: string, name: string) => (local.has(name) ? `url(${local.get(name)})` : m))
      : source;
    return new Native(family, src, descriptors);
  } as unknown as typeof FontFace;
  Patched.prototype = Native.prototype;
  window.FontFace = Patched;
}
