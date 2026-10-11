/**
 * 假宿主：不用平台也能开发编辑器。实现 packages/bridge/src/protocol.ts 里的接口（内存里），并提供一个带消息日志的宿主页面。
 * 用法：node tools/mock-host.mjs [端口，默认 5180] [编辑器地址，默认 http://localhost:5174/editors]
 * 打开 http://localhost:5180/host.html?kind=sheet（可加 &doc=<编号>&mode=read&theme=dark）。
 * 令牌格式：<内容编号>:<权限>，权限 owner | edit | read | respond。
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLES, USERS } from './samples.mjs';

const PORT = Number(process.argv[2] || 5180), EDITORS = (process.argv[3] || 'http://localhost:5174/editors').replace(/\/+$/, '');
const here = path.dirname(fileURLToPath(import.meta.url));
const docs = new Map(Object.entries(structuredClone(SAMPLES)).map(([id, d]) => [id, { id, version: 1, plain: '', updatedAt: new Date().toISOString(), collecting: d.kind === 'survey', importFile: null, ...d }]));
const assets = new Map(), responses = new Map();
const me = USERS[0];
let seq = 0;

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'access-control-max-age': '600' };
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', ...CORS }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))); });
const claims = (req, url) => { const h = req.headers.authorization, t = h?.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token'); if (!t) return null; const [docId, perm = 'edit'] = t.split(':'); return { docId, perm }; };
const fileFor = (doc) => (doc.fileAsset ? { id: doc.fileAsset, name: assets.get(doc.fileAsset)?.name, size: assets.get(doc.fileAsset)?.buf.length, mime: assets.get(doc.fileAsset)?.mime, url: `http://localhost:${PORT}/api/v1/editor/asset/${doc.fileAsset}?token=${doc.id}:read` } : null);

// 示例文件：tools/samples/ 目录里的文件登记成资源，file 格式的示例和导入示例用
const samplesDir = path.join(here, 'samples');
if (fs.existsSync(samplesDir)) for (const name of fs.readdirSync(samplesDir)) {
  const buf = fs.readFileSync(path.join(samplesDir, name)), ext = name.split('.').pop().toLowerCase();
  const mime = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain', md: 'text/markdown', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', csv: 'text/csv', xmind: 'application/octet-stream', opml: 'text/xml' }[ext] ?? 'application/octet-stream';
  assets.set('sample-' + name, { name, mime, buf });
}
for (const d of docs.values()) { if (d.sampleFile && assets.has('sample-' + d.sampleFile)) d.fileAsset = 'sample-' + d.sampleFile; if (d.sampleImport && assets.has('sample-' + d.sampleImport)) d.importFile = { id: 'sample-' + d.sampleImport, name: d.sampleImport, size: assets.get('sample-' + d.sampleImport).buf.length, mime: assets.get('sample-' + d.sampleImport).mime, url: `http://localhost:${PORT}/api/v1/editor/asset/sample-${d.sampleImport}?token=${d.id}:read` }; }

const hostPage = (url) => {
  const kind = url.searchParams.get('kind') || 'doc', docId = url.searchParams.get('doc') || [...docs.values()].find((d) => d.kind === kind)?.id || 'demo-doc';
  const perm = url.searchParams.get('perm') || 'owner', mode = url.searchParams.get('mode') || 'edit', theme = url.searchParams.get('theme') || 'light';
  const src = `${EDITORS}/${kind}/?doc=${encodeURIComponent(docId)}&token=${encodeURIComponent(docId + ':' + perm)}&api=${encodeURIComponent(`http://localhost:${PORT}`)}&theme=${theme}&mode=${mode}${kind === 'doc' ? '&collab=0' : ''}`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>假宿主 · ${kind}</title>
<style>body{margin:0;font:13px/1.5 system-ui,sans-serif;display:grid;grid-template-rows:auto 1fr;height:100vh;background:${theme === 'dark' ? '#0f1218;color:#eef1f6' : '#f5f7fb;color:#1a2233'}}
header{display:flex;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid #d5dbe6;flex-wrap:wrap}header b{font-size:15px}
main{display:grid;grid-template-columns:1fr 300px;min-height:0}iframe{border:0;width:100%;height:100%;background:#fff}
aside{border-left:1px solid #d5dbe6;overflow:auto;font-family:ui-monospace,monospace;font-size:12px;padding:8px}aside div{border-bottom:1px solid #e8ecf3;padding:3px 0;word-break:break-all}
button,select,input{font:inherit}</style></head><body>
<header><b id="title">${kind}</b><span id="status" style="color:#6f7b8f">…</span><span style="flex:1"></span>
<button data-cmd="theme">切换主题</button><button data-cmd="readonly">只读开关</button><button data-cmd="insert">插入一段</button><button data-cmd="flush">立即保存</button>
<select id="exp"><option value="">导出为…</option></select><input id="cmd" placeholder="command 名称[:参数]" style="width:180px"><button data-cmd="command">发命令</button>
<a href="/host.html?kind=${kind}&doc=${docId}&perm=read&mode=read" style="margin-left:8px">只读打开</a></header>
<main><iframe id="f" src="${src}" allow="clipboard-read; clipboard-write; fullscreen"></iframe><aside id="log"></aside></main>
<script>
const f = document.getElementById('f'), log = document.getElementById('log'), status = document.getElementById('status'); let theme = '${theme}', ro = ${mode === 'read'};
const send = (m) => f.contentWindow.postMessage({ source: 'cai-host', ...m }, '*');
const EXPORTS = ${JSON.stringify({ doc: [['docx', 'Word'], ['md', 'Markdown'], ['pdf', 'PDF']], sheet: [['xlsx', 'Excel'], ['csv', 'CSV']], slides: [['pptx', 'PowerPoint'], ['pdf', 'PDF']], base: [['xlsx', 'Excel']], survey: [['xlsx', 'Excel（答卷）']], mind: [['png', '图片'], ['xmind', 'XMind'], ['md', 'Markdown 大纲']], board: [['png', '图片'], ['svg', 'SVG']], flow: [['png', '图片'], ['svg', 'SVG']], file: [['download', '下载原文件']] })};
for (const [v, l] of EXPORTS['${kind}'] || []) { const o = document.createElement('option'); o.value = v; o.textContent = l; document.getElementById('exp').appendChild(o); }
document.getElementById('exp').onchange = (e) => { if (e.target.value) { send({ type: 'export', format: e.target.value }); e.target.value = ''; } };
document.querySelectorAll('[data-cmd]').forEach((b) => b.onclick = () => { const c = b.dataset.cmd; if (c === 'theme') { theme = theme === 'dark' ? 'light' : 'dark'; send({ type: 'theme', theme }); } else if (c === 'readonly') { ro = !ro; send({ type: 'readonly', value: ro }); } else if (c === 'insert') send({ type: 'insert', text: '这是宿主插入的一段文字（' + new Date().toLocaleTimeString() + '）。' }); else if (c === 'flush') send({ type: 'flush' }); else if (c === 'command') { const [name, ...rest] = document.getElementById('cmd').value.split(':'); send({ type: 'command', name, args: rest.join(':') || undefined }); } });
window.addEventListener('message', (e) => { const m = e.data; if (!m || m.source !== 'cai-editor') return; const d = document.createElement('div'); d.textContent = new Date().toLocaleTimeString() + ' ' + JSON.stringify(m); log.prepend(d); window.__msgs = (window.__msgs || []).concat([m]);
  if (m.type === 'title') document.getElementById('title').textContent = m.title; if (m.type === 'ready') document.getElementById('title').textContent = m.title;
  if (m.type === 'saving') status.textContent = '保存中…'; if (m.type === 'saved') status.textContent = '已保存 v' + m.version; if (m.type === 'dirty' && m.dirty) status.textContent = '有改动'; if (m.type === 'error') status.textContent = '出错：' + m.message; });
</script></body></html>`;
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
    if (url.pathname === '/' || url.pathname === '/host.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(hostPage(url)); return; }
    if (url.pathname === '/docs') { json(res, 200, [...docs.values()].map((d) => ({ id: d.id, kind: d.kind, title: d.title, version: d.version }))); return; }
    if (!url.pathname.startsWith('/api/v1/editor/')) { json(res, 404, { error: 'not found' }); return; }
    const c = claims(req, url);
    if (!c) { json(res, 401, { error: '缺少令牌' }); return; }
    const p = url.pathname.slice('/api/v1/editor'.length);
    if (p.startsWith('/asset/')) {
      const a = assets.get(decodeURIComponent(p.slice(7)));
      if (!a) { json(res, 404, { error: '没有这个文件' }); return; }
      res.writeHead(200, { 'content-type': a.mime, 'content-length': a.buf.length, 'content-disposition': `${url.searchParams.get('download') ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(a.name)}`, ...CORS }); res.end(a.buf); return;
    }
    const doc = docs.get(c.docId);
    if (!doc) { json(res, 404, { error: '没有这份内容' }); return; }
    const readonly = c.perm === 'read' || c.perm === 'respond';
    if (p === '/doc' && req.method === 'GET') { json(res, 200, { id: doc.id, kind: doc.kind, title: doc.title, content: doc.content, version: doc.version, perm: c.perm, readonly, user: me, level: '内部', lang: '中文', updatedAt: doc.updatedAt, file: fileFor(doc), importFile: doc.importFile, collecting: doc.collecting, responded: (responses.get(doc.id) || []).filter((r) => r.userId === me.id).length }); return; }
    if (p === '/doc' && req.method === 'PUT') {
      if (readonly) { json(res, 403, { error: '只读' }); return; }
      const b = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      if (b.version !== doc.version) { json(res, 409, { error: 'version', version: doc.version, content: doc.content, title: doc.title }); return; }
      doc.content = b.content; doc.plain = String(b.plain ?? '').slice(0, 2000); if (b.title) doc.title = b.title; doc.version += 1; doc.updatedAt = new Date().toISOString();
      console.log(`[保存] ${doc.id} v${doc.version} plain=${doc.plain.slice(0, 60).replace(/\n/g, ' ')}`);
      json(res, 200, { version: doc.version, updatedAt: doc.updatedAt }); return;
    }
    if (p === '/doc' && req.method === 'PATCH') { const b = JSON.parse((await readBody(req)).toString('utf8') || '{}'); doc.title = String(b.title || doc.title).slice(0, 120); json(res, 200, { title: doc.title }); return; }
    if (p === '/doc/imported') { doc.importFile = null; json(res, 200, { ok: true }); return; }
    if (p === '/presence') { json(res, 200, { present: [{ id: USERS[1].id, name: USERS[1].name, editing: true }] }); return; }
    if (p === '/directory') { json(res, 200, { users: USERS }); return; }
    if (p === '/asset' && req.method === 'POST') {
      const body = await readBody(req);
      const fd = await new Response(body, { headers: { 'content-type': req.headers['content-type'] } }).formData();
      const f = fd.get('file');
      if (!f || typeof f === 'string') { json(res, 400, { error: '缺少文件' }); return; }
      const id = 'a' + (++seq), buf = Buffer.from(await f.arrayBuffer());
      assets.set(id, { name: f.name, mime: f.type || 'application/octet-stream', buf });
      json(res, 200, { id, name: f.name, size: buf.length, mime: f.type, url: `http://localhost:${PORT}/api/v1/editor/asset/${id}?token=${doc.id}:read` }); return;
    }
    if (p === '/responses' && req.method === 'GET') { json(res, 200, { responses: responses.get(doc.id) || [] }); return; }
    if (p === '/responses' && req.method === 'POST') { const b = JSON.parse((await readBody(req)).toString('utf8') || '{}'); const list = responses.get(doc.id) || []; list.push({ id: 'r' + (++seq), userId: me.id, userName: me.name, at: new Date().toISOString(), answers: b.answers || {} }); responses.set(doc.id, list); json(res, 200, { id: list[list.length - 1].id, count: list.length }); return; }
    if (p === '/collecting') { const b = JSON.parse((await readBody(req)).toString('utf8') || '{}'); doc.collecting = !!b.collecting; json(res, 200, { collecting: doc.collecting }); return; }
    json(res, 404, { error: '没有这个接口' });
  } catch (e) { console.error(e); json(res, 500, { error: e.message }); }
}).listen(PORT, () => console.log(`假宿主：http://localhost:${PORT}/host.html?kind=doc  （编辑器 ${EDITORS}）\n内容：${[...docs.keys()].join(', ')}`));
