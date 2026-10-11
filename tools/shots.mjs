/**
 * 无界面 Chrome 截图：按计划打开页面、执行一段 JS、截图，并收集页面报错。开发时用来检查界面。
 * 用法：node tools/shots.mjs <截图目录> <计划.json>
 * 计划是一个数组：{ "name": "sheet", "url": "http://localhost:5180/host.html?kind=sheet", "w": 1440, "h": 900, "wait": 2500,
 *   "before": "要在页面里执行的 JS（包在 try/catch 里，返回一个字符串）", "after": 800, "frame": true, "dark": false, "scale": 1 }
 * frame 为 true 时 before 在第一个 iframe（编辑器）里执行，否则在宿主页里执行。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [outArg, planFile] = process.argv.slice(2);
if (!outArg || !planFile) { console.error('用法：node tools/shots.mjs <截图目录> <计划.json>'); process.exit(2); }
const outDir = path.resolve(outArg); fs.mkdirSync(outDir, { recursive: true });
const CHROME = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const PORT = 9500 + Math.floor(Math.random() * 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = path.join(outDir, '.chrome-' + PORT);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--allow-file-access-from-files', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let ws, seq = 0; const waiters = new Map(); const logs = [];
for (let i = 0; i < 80 && !ws; i++) { try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); const page = list.find((t) => t.type === 'page'); if (page) { const w = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { w.onopen = res; w.onerror = rej; }); ws = w; } } catch { /* 还没起来 */ } if (!ws) await sleep(250); }
if (!ws) { console.error('没有连上浏览器'); chrome.kill(); process.exit(1); }
const frames = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } else if (m.method === 'Runtime.executionContextCreated') { const c = m.params.context; frames.set(c.auxData?.frameId, { id: c.id, isDefault: c.auxData?.isDefault, origin: c.origin }); } else if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 500)); else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('console.error ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400)); };
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; waiters.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr, contextId) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) }); if (r.result?.exceptionDetails) logs.push('EVAL ' + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text).slice(0, 400)); return r.result?.result?.value; };
await send('Runtime.enable'); await send('Page.enable');
/** 第一个 iframe 的执行环境 */
async function frameContext() {
  const tree = (await send('Page.getFrameTree')).result.frameTree;
  const child = tree.childFrames?.[0]?.frame;
  if (!child) return null;
  const ctx = frames.get(child.id);
  return ctx?.id ?? null;
}
const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
for (const p of plan) {
  const { name, url, w = 1440, h = 900, wait = 2500, dark = false, before, after = 800, frame = false, scale = 1 } = p;
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile: w < 600 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  if (url) { frames.clear(); await send('Page.navigate', { url }); await sleep(wait); }
  let out;
  if (before) { const ctx = frame ? await frameContext() : undefined; if (frame && !ctx) logs.push('没有找到 iframe 的执行环境：' + name); out = await evaluate(`(function(){ try { ${before} } catch (e) { return '出错 ' + e.message; } })()`, ctx ?? undefined); await sleep(after); }
  const png = (await send('Page.captureScreenshot', { format: 'png' })).result.data;
  fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(png, 'base64'));
  console.log(`${name}: ${url ?? '(同一页)'}${out !== undefined ? '  → ' + JSON.stringify(out).slice(0, 300) : ''}`);
}
ws.close(); chrome.kill();
await sleep(500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ }
console.log(logs.length ? '页面报错：\n' + logs.join('\n') : '没有页面报错');
