/**
 * 一次编辑会话：解析地址参数、取内容、自动保存、在线状态、和宿主的消息往来。
 * 各编辑器只需要：const s = await openSession(); 然后 s.doc 取内容，改动后 s.markDirty(() => ({ content, plain }))，
 * 标题变了 s.setTitle(t)，收到宿主的消息用 s.onHost(cb)。
 *
 * 几个人同时编辑（用户 2026-11-27：「两人同时在编辑的时候看不到对方编辑的结果」）：编辑器装好内容后调 s.live({ snapshot, apply, busy })。
 * 别人保存以后宿主发 remote（带服务器上的新版本号），会话取最新内容，和自己还没保存的改动三方合并（merge.ts），交给 apply 换上；
 * 自己保存时碰上版本冲突也这样合并后重存，不再提示刷新、丢掉改动。按着鼠标、输入法正在拼字、编辑器说正忙（busy）时先等一等。
 * 没调 live 的编辑器（文档走 Yjs 实时协同）照旧。
 *
 * 地址参数：doc 内容编号（必填）、token 编辑令牌（必填）、api 宿主地址（默认当前来源）、ws 协同地址（默认由 api 推出来）、
 * theme light|dark|auto、mode edit|read|fill、ui 界面语言 zh-CN|en|pt-BR|ja|ko（apps/editors 的 shell/i18n.ts 读，不在会话里）。
 */
import { ApiError, EditorClient, isConflict } from './client';
import { jsonClone, merge3, same } from './merge';
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

/** 编辑器接上「别人的改动几秒内合并进来」要给的三样 */
export interface Live {
  /** 自己现在的内容（和保存时给的一样） */
  snapshot(): Snapshot;
  /**
   * 换成这份内容（已经合并好了）：尽量保留选中、滚动位置、正在看的页；这一步引起的改动事件不用管（会话不会把它当成自己的改动去存）。
   * 返回 Promise 时只能等微任务（Vue 的 nextTick 这类）：等的这段时间里的 markDirty 都不算，要是等了 IndexedDB、网络，用户这时的改动就记不上了
   */
  apply(content: unknown): void | Promise<void>;
  /** 正忙（格子里正在打字、正在拖东西）：先不换，过一会儿再试 */
  busy?(): boolean;
}
/** 别人的改动等多久再试一次（正忙的时候）；最多等多久（再久就照样换上：合并时自己正在改的地方以自己的为准） */
const BUSY_RETRY = 400, BUSY_MAX = 15_000;
/** 按下鼠标超过这么久还没松开（松开在框外面没收到）就不算按着了 */
const POINTER_STALE = 10_000;
/** 取最新内容失败（网络）隔多久再试；编辑器换内容出错隔多久再试、连续几次就退回提示刷新 */
const FETCH_RETRY = 10_000, APPLY_RETRY = 5000, APPLY_GIVE_UP = 3;
/** 编辑器这边出的错：取自己的内容、换内容（和取最新内容的网络错误分开算） */
class ApplyError extends Error {}
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
  private liveH: Live | null = null;
  /** 上次和服务器一致时自己这边的内容（合并时的 base）；没接 live 时是 undefined */
  private synced: unknown = undefined;
  /** 宿主说服务器上已经有的最新版本 */
  private wantVersion = 0;
  private pulling: Promise<void> | null = null;
  private pullAgain = false;
  /** 合并好了、在等编辑器不忙：这时保存往后推（不卡住），宿主要求立刻保存时不再等 */
  private waitingBusy = false;
  private forceApply = false;
  /** 正在换上别人的改动：这时候的 markDirty 不算 */
  private applying = false;
  private pointerAt = 0;
  private composing = false;
  private applyFails = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
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
      if (m.type === 'flush') void this.flush(false, true);
      if (m.type === 'remote' && typeof m.version === 'number') { this.wantVersion = Math.max(this.wantVersion, m.version); if (m.version > this.version) void this.pull(); }
      if (STATE_MESSAGES.has(m.type)) this.latest.set(m.type, m);
      for (const h of this.hostHandlers) h(m);
    });
    window.addEventListener('beforeunload', () => { void this.flush(true); if (this.presenceTimer) void this.client.presence(false, true); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void this.flush(true); });
    // 按着鼠标（拖动、框选）、输入法拼字的时候不换内容
    window.addEventListener('pointerdown', () => { this.pointerAt = Date.now(); }, true);
    for (const t of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(t, () => { this.pointerAt = 0; }, true);
    window.addEventListener('compositionstart', () => { this.composing = true; }, true);
    window.addEventListener('compositionend', () => { this.composing = false; }, true);
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

  /**
   * 接上「别人的改动几秒内合并进来」：编辑器把内容装好以后调一次。
   * 这时的内容就是和服务器一致的样子（编辑器自己整理过的，比如表格补的空行），以后算「自己改了什么」以它为准。
   */
  live(h: Live) {
    this.liveH = h;
    this.synced = jsonClone(this.dirty ? this.doc.content : h.snapshot().content);
    if (this.wantVersion > this.version) void this.pull();
  }

  private busy() {
    if (this.pointerAt && Date.now() - this.pointerAt > POINTER_STALE) this.pointerAt = 0;
    return !!this.pointerAt || this.composing || !!this.liveH?.busy?.();
  }

  /** 取服务器上的最新内容合并进来；同一时间只跑一个，跑的时候又来了新版本就再跑一遍 */
  private pull(conflict?: SaveConflict): Promise<void> {
    if (this.pulling) { this.pullAgain = true; return this.pulling; }
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.pulling = (async () => {
      try {
        let c = conflict;
        do { this.pullAgain = false; await this.pullOnce(c); c = undefined; } while (this.pullAgain);
        this.applyFails = 0;
      } catch (e) {
        // 换内容出错：过一会儿再试，连续几次都不行就退回原来的做法（提示后刷新，刷新后是服务器上的最新内容）；
        // 取内容失败（多半是网络）：过一会儿再试，不刷新。版本号没变，再试时会重新取
        const applyErr = e instanceof ApplyError;
        if (applyErr && ++this.applyFails >= APPLY_GIVE_UP) {
          alert(this.dirty ? '这份内容在别处被改过了，没能合并进来，页面会重新加载到最新版本；你刚才的改动没有保存。' : '这份内容在别处被改过了，页面会重新加载到最新版本。');
          location.reload();
          return;
        }
        this.send({ type: 'error', message: e instanceof Error ? e.message : '取最新内容失败' });
        this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.pull(); }, applyErr ? APPLY_RETRY : FETCH_RETRY);
      } finally { this.pulling = null; }
    })();
    return this.pulling;
  }

  private async pullOnce(conflict?: SaveConflict) {
    const h = this.liveH;
    if (!h) return;
    if (this.saving) await this.saving.catch(() => { /* 保存自己会处理 */ }); // 自己正在存：存完再看，宿主说的新版本可能就是这次
    if (!conflict && this.wantVersion <= this.version) return;
    const latest: { version: number; content: unknown } = conflict ?? await this.client.doc();
    if (latest.version <= this.version) return;
    if (this.busy()) {
      const t0 = Date.now();
      this.waitingBusy = true;
      try { while (this.busy() && !this.forceApply && Date.now() - t0 < BUSY_MAX) await new Promise((r) => setTimeout(r, BUSY_RETRY)); }
      finally { this.waitingBusy = false; this.forceApply = false; }
      if (latest.version <= this.version) return; // 等的时候自己存过了（页面切到后台时会立刻存）
    }
    let mine: unknown;
    // 取自己的内容出错也算编辑器的错（比如表格重建到一半失败、工作簿没了），连续几次就提示刷新，不当成网络错误一直重试
    try { mine = jsonClone(h.snapshot().content); }
    catch (e) { throw new ApplyError(`读取当前内容失败：${e instanceof Error ? e.message : String(e)}`); }
    const theirs = latest.content;
    const local = this.synced !== undefined && !same(mine, this.synced);
    const next = local ? merge3(this.synced, mine, theirs) : theirs;
    this.applying = true;
    try { await h.apply(jsonClone(next)); }
    catch (e) { throw new ApplyError(`合并别人的改动失败：${e instanceof Error ? e.message : String(e)}`); }
    finally { this.applying = false; }
    this.version = latest.version;
    if (this.doc) { this.doc.version = latest.version; this.doc.content = theirs; }
    if (local && !same(next, theirs)) {
      // 自己还有对方没有的改动：以对方的为准算 base，合并后的内容接着存
      this.synced = jsonClone(theirs);
      this.markDirty(() => h.snapshot());
    } else {
      this.synced = jsonClone(h.snapshot().content);
      this.clearDirty();
    }
  }

  private clearDirty() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.dirty) { this.dirty = false; this.send({ type: 'dirty', dirty: false }); }
  }

  /** 内容变了：记下取当前内容的办法，停下来以后保存 */
  markDirty(getter: () => Snapshot) {
    if (this.readonly || this.applying) return;
    this.getter = getter;
    if (!this.dirty) { this.dirty = true; this.send({ type: 'dirty', dirty: true }); }
    this.editing = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.opts.saveDelay ?? 1500);
  }

  /** 立刻保存（如果有改动）。keepalive 用于页面关闭前；force：宿主要求立刻保存，在等编辑器不忙的合并也不等了 */
  async flush(keepalive = false, force = false): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.dirty || !this.getter) return;
    if (this.saving) { await this.saving; if (!this.dirty) return; }
    // 正在合并别人的改动：合并完再存（版本号会变）。合并在等编辑器不忙时不卡着：过一会儿再存（宿主要求立刻存时让合并别等了）；页面关闭前来不及等
    if (this.pulling && !keepalive) {
      if (this.waitingBusy && !force) { this.timer = setTimeout(() => void this.flush(), this.opts.saveDelay ?? 1500); return; }
      if (force) this.forceApply = true;
      await this.pulling;
      if (!this.dirty || this.saving) return;
    }
    const snap = this.getter();
    // 接了 live 的：内容和服务器上的一样（比如换上别人的改动时编辑器自己报了一次改动）就不存
    const sent = this.liveH ? jsonClone(snap.content) : undefined;
    if (this.liveH && same(sent, this.synced) && snap.title === undefined) { this.clearDirty(); return; }
    this.dirty = false;
    this.send({ type: 'saving' });
    this.saving = (async () => {
      try {
        const r = await this.client.save({ version: this.version, content: snap.content, plain: snap.plain.slice(0, 200_000), title: snap.title }, keepalive);
        this.version = r.version;
        if (this.liveH) this.synced = sent;
        if (snap.title !== undefined) { this.doc.title = snap.title; document.title = snap.title; }
        this.send({ type: 'saved', version: r.version, at: r.updatedAt });
        if (!this.dirty) this.send({ type: 'dirty', dirty: false });
      } catch (e) {
        if (isConflict(e)) {
          this.send({ type: 'conflict', version: e.data.version });
          if (this.liveH) {
            // 别人先存了：把对方的合并进来，再存一次（pull 结束时自己的改动还在就会重新 markDirty）
            this.dirty = true;
            this.wantVersion = Math.max(this.wantVersion, e.data.version);
            void this.pull(e.data);
          } else if (this.conflictHandler) this.conflictHandler(e.data);
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

  /** 导出没做成：告诉宿主不用再等了（提示由调用的编辑器自己显示） */
  exportFailed(message?: string) { this.send({ type: 'export-failed', message }); }
}

export async function openSession(opts?: SessionOptions): Promise<Session> {
  const s = new Session(opts);
  await s.open();
  return s;
}
