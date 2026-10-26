/**
 * 一次编辑会话：解析地址参数、取内容、自动保存、在线状态、和宿主的消息往来。
 * 各编辑器只需要：const s = await openSession(); 然后 s.doc 取内容，改动后 s.markDirty(() => ({ content, plain }))，
 * 标题变了 s.setTitle(t)，收到宿主的消息用 s.onHost(cb)。
 *
 * 地址参数：doc 内容编号（必填）、token 编辑令牌（必填）、api 宿主地址（默认当前来源）、ws 协同地址（默认由 api 推出来）、
 * theme light|dark|auto、mode edit|read|fill。
 */
import { ApiError, EditorClient, isConflict } from './client';
import { EDITOR_SOURCE, HOST_SOURCE, type EditorDoc, type EditorToHost, type HostToEditor, type PresenceUser, type SaveConflict } from './protocol';

export interface SessionOptions {
  /** 停下来多久以后保存，毫秒 */
  saveDelay?: number;
  /** 在线心跳间隔，毫秒；0 表示不报在线（文档用协同连接自己报） */
  presenceEvery?: number;
  /** 这种编辑器支持锚在内容上的评论：在 ready 消息里告诉宿主 */
  comments?: boolean;
}

/** 表示「当前状态」的宿主消息：编辑器组件挂上之前就可能到了，会话记下最新的一条，组件挂上后用 s.lastHost(type) 补上 */
const STATE_MESSAGES = new Set<HostToEditor['type']>(['comments', 'comment-focus', 'comment-pending']);

export interface Snapshot { content: unknown; plain: string; title?: string }
export type Theme = 'light' | 'dark';

const param = (k: string) => new URLSearchParams(location.search).get(k) ?? '';

export class Session {
  readonly docId = param('doc');
  readonly token = param('token');
  readonly api = (param('api') || location.origin).replace(/\/+$/, '');
  readonly mode = (param('mode') || 'edit') as 'edit' | 'read' | 'fill';
  readonly client = new EditorClient(this.api, this.token);
  doc!: EditorDoc;
  /** 当前版本号：保存成功后更新 */
  version = 0;
  theme: Theme = 'light';
  private dirty = false;
  private getter: (() => Snapshot) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private hostHandlers: ((m: HostToEditor) => void)[] = [];
  private latest = new Map<HostToEditor['type'], HostToEditor>();
  private conflictHandler: ((c: SaveConflict) => void) | null = null;
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private editing = false;
  present: PresenceUser[] = [];
  onPresent: ((users: PresenceUser[]) => void) | null = null;

  constructor(private opts: SessionOptions = {}) {}

  /** 协同连接的地址：ws(s)://宿主/ws/collab/<编号>?token=… */
  wsUrl(): string {
    const base = (param('ws') || this.api).replace(/^http/, 'ws').replace(/\/+$/, '');
    return `${base}/ws/collab/${encodeURIComponent(this.docId)}?token=${encodeURIComponent(this.token)}`;
  }

  get readonly() { return this.doc.readonly || this.mode === 'read'; }

  async open(): Promise<EditorDoc> {
    if (!this.docId || !this.token) throw new ApiError(400, '缺少内容编号或编辑令牌');
    this.doc = await this.client.doc();
    this.version = this.doc.version;
    this.applyTheme(param('theme') === 'dark' ? 'dark' : param('theme') === 'light' ? 'light' : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    window.addEventListener('message', (e) => {
      const m = e.data as { source?: string } & HostToEditor;
      if (!m || m.source !== HOST_SOURCE) return;
      if (m.type === 'theme') this.applyTheme(m.theme);
      if (m.type === 'flush') void this.flush();
      if (STATE_MESSAGES.has(m.type)) this.latest.set(m.type, m);
      for (const h of this.hostHandlers) h(m);
    });
    window.addEventListener('beforeunload', () => { void this.flush(true); if (this.presenceTimer) void this.client.presence(false, true); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void this.flush(true); });
    if ((this.opts.presenceEvery ?? 20_000) > 0 && !this.readonly) {
      const beat = () => void this.client.presence(this.editing).then((r) => { this.present = r.present; this.onPresent?.(r.present); this.send({ type: 'present', users: r.present }); }).catch(() => { /* 心跳失败不打扰 */ });
      beat();
      this.presenceTimer = setInterval(beat, this.opts.presenceEvery ?? 20_000);
    }
    document.title = this.doc.title;
    this.send({ type: 'ready', kind: this.doc.kind, title: this.doc.title, readonly: this.readonly, ...(this.opts.comments ? { comments: true } : {}) });
    return this.doc;
  }

  applyTheme(t: Theme) { this.theme = t; document.documentElement.dataset.theme = t; }

  /** 发消息给宿主 */
  send(m: EditorToHost) { if (window.parent !== window) window.parent.postMessage({ ...m, source: EDITOR_SOURCE, docId: this.docId }, '*'); }
  onHost(h: (m: HostToEditor) => void) { this.hostHandlers.push(h); return () => { this.hostHandlers = this.hostHandlers.filter((x) => x !== h); }; }
  /** 宿主最近发来的某种状态消息（comments、comment-focus、comment-pending），没收到过是 undefined */
  lastHost<T extends HostToEditor['type']>(type: T): Extract<HostToEditor, { type: T }> | undefined { return this.latest.get(type) as Extract<HostToEditor, { type: T }> | undefined; }
  /** 版本冲突时怎么办；不设就提示并刷新页面 */
  onConflict(h: (c: SaveConflict) => void) { this.conflictHandler = h; }

  /** 内容变了：记下取当前内容的办法，停下来以后保存 */
  markDirty(getter: () => Snapshot) {
    if (this.readonly) return;
    this.getter = getter;
    if (!this.dirty) { this.dirty = true; this.send({ type: 'dirty', dirty: true }); }
    this.editing = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.opts.saveDelay ?? 1500);
  }

  /** 立刻保存（如果有改动）。keepalive 用于页面关闭前 */
  async flush(keepalive = false): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.dirty || !this.getter) return;
    if (this.saving) { await this.saving; if (!this.dirty) return; }
    const snap = this.getter();
    this.dirty = false;
    this.send({ type: 'saving' });
    this.saving = (async () => {
      try {
        const r = await this.client.save({ version: this.version, content: snap.content, plain: snap.plain.slice(0, 200_000), title: snap.title }, keepalive);
        this.version = r.version;
        if (snap.title !== undefined) { this.doc.title = snap.title; document.title = snap.title; }
        this.send({ type: 'saved', version: r.version, at: r.updatedAt });
        if (!this.dirty) this.send({ type: 'dirty', dirty: false });
      } catch (e) {
        if (isConflict(e)) {
          this.send({ type: 'conflict', version: e.data.version });
          if (this.conflictHandler) this.conflictHandler(e.data);
          else { alert('这份内容在别处被改过了，页面会重新加载到最新版本；你刚才的改动没有保存。'); location.reload(); }
        } else {
          this.dirty = true; // 下次再试
          this.send({ type: 'error', message: e instanceof Error ? e.message : '保存失败' });
          this.timer = setTimeout(() => void this.flush(), 5000);
        }
      } finally { this.saving = null; }
    })();
    await this.saving;
  }

  /** 改标题：不占版本号 */
  async setTitle(title: string) {
    const t = title.trim().slice(0, 120) || this.doc.title;
    if (t === this.doc.title) return;
    this.doc.title = t; document.title = t;
    this.send({ type: 'title', title: t });
    try { await this.client.rename(t); } catch (e) { this.send({ type: 'error', message: e instanceof Error ? e.message : '改名失败' }); }
  }

  /** 让浏览器下载一个文件，并告诉宿主 */
  download(blob: Blob, name: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    this.send({ type: 'exported', name });
  }
}

export async function openSession(opts?: SessionOptions): Promise<Session> {
  const s = new Session(opts);
  await s.open();
  return s;
}
