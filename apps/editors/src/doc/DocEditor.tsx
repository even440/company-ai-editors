/**
 * 文档编辑器：Tiptap 正文 + Yjs 协同。从平台 src/features/docs/DocEditor.tsx 搬来，只保留正文编辑：标题、分享、AI 面板由宿主负责。
 * 两种模式：
 * - 协同（默认）：连宿主的 ws(s)://…/ws/collab/<编号>，正文在 Y.XmlFragment 'default'、标题在 Y.Text 'title'，服务端自己落库，
 *   编辑器只把连接状态（collab）、在线的人（present）和标题变化（title）告诉宿主；
 * - 普通（地址参数 collab=0）：直接加载 s.doc.content，改动后 markDirty 走会话的自动保存。
 * 协同模式 6 秒没同步上、或服务端拒绝时，退成只读视图并提示，可以重试。
 * 评论（comments.ts）：选中文字后点浮出来的「评论」或按 Ctrl/⌘+Alt+M，编辑和只读都能用；评论串本身在宿主那边。
 * 目录（outline.tsx，2026-10-27）：按标题列在正文左边，点了跳过去；窄的时候是左下角的按钮。
 * 看大图（2026-10-27，同事反馈知识库、文档里的图片不能双击放大）：双击图片（只读时单击也行，触屏上双击），把全文的图片交给宿主全屏看（image-view）。
 * 格式（format.tsx，2026-10-27）：字体、字号、文字颜色、底纹、对齐，列表和编号的样式；表格拖竖线调列宽（schema.ts）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import type { Extensions, JSONContent } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import type { EditorToHost, PresenceUser, Session, Snapshot } from '@cai/bridge';
import { useHost, useTheme } from '../shell/session';
import { Field, Icon, Modal, Select, Toaster, Toolbar, cx, toast } from '../shell/ui';
import { DocComments } from './comments';
import { contentOf, paragraphsOf, plainOf, type DocNode } from './content';
import { toDocx, toMarkdown } from './export';
import { AlignPick, ColorPick, FontPick, ListPick, SizePick } from './format';
import { importToHtml, titleOf } from './import';
import { anchorNames, anchorOfHref, anchorValue, findAnchor, validAnchor } from './anchors';
import { ImageResizer } from './imgsize';
import { Outline, TOC_WIDE, TocButton, tocOf, useToc, useTocOpen, useWide, type TocItem } from './outline';
import { Y_FIELD, Y_TITLE, schemaExtensions } from './schema';
import './doc.css';

type CollabState = Extract<EditorToHost, { type: 'collab' }>['state'];
/** 这么久还没同步上，就退成只读视图 */
const CONNECT_TIMEOUT = 6000;
/** 断开这么久以后算离线 */
const OFFLINE_AFTER = 12000;
/** 选区变化多久报一次给宿主 */
const SELECTION_EVERY = 300;
/**
 * 协同时告诉服务端这个编辑器认得哪一版的文档结构（地址参数 v）。结构里加了新的样式时加一，平台 src/server/modules/docs/collab.ts 的 COLLAB_V 跟着改：
 * 旧版的编辑器遇到不认识的样式会把那一段文字删掉，所以发布以后还开着的旧页面连不上协同，提示刷新。
 * 2：字体、字号、颜色、底纹、对齐、列表样式（2026-10-27）
 */
const COLLAB_V = '2';
const placeholder = () => Placeholder.configure({ placeholder: '从这里开始写……' });
const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;
const param = (k: string) => new URLSearchParams(location.search).get(k) ?? '';

/** 一条协同连接：Y.Doc、WebSocket 和我在 awareness 里的身份 */
interface YSession { doc: Y.Doc; provider: WebsocketProvider; user: { id: string; name: string; color: string } }

const snapshot = (editor: Editor): Snapshot => { const json = editor.getJSON() as DocNode; return { content: json, plain: plainOf(json) }; };
/** 把 Y.Text 改成目标文字：只改有变化的那一段，两个人同时改也不会乱 */
function setYText(y: Y.Text, v: string) {
  const cur = y.toString();
  if (cur === v) return;
  let a = 0; while (a < cur.length && a < v.length && cur[a] === v[a]) a++;
  let b = 0; while (b < cur.length - a && b < v.length - a && cur[cur.length - 1 - b] === v[v.length - 1 - b]) b++;
  y.doc!.transact(() => { if (cur.length - a - b > 0) y.delete(a, cur.length - a - b); if (v.length - a - b > 0) y.insert(a, v.slice(a, v.length - b)); });
}

/* ---------- 正文 ---------- */

/** 正文编辑器。协同模式绑在 Y.Doc 上（连接变了重新建）；普通模式直接加载内容。extra 是只影响交互的扩展（评论）；onImage 是要看大图（图片节点的位置） */
function Body({ s, ysess, editable, extra, onEditor, onUpdate, onSelection, onImage }: { s: Session; ysess: YSession | null; editable: boolean; extra: Extensions; onEditor: (e: Editor | null) => void; onUpdate: (e: Editor) => void; onSelection: (e: Editor) => void; onImage: (pos: number) => void }) {
  const upd = useRef(onUpdate), sel = useRef(onSelection), img = useRef(onImage);
  upd.current = onUpdate; sel.current = onSelection; img.current = onImage;
  const editor = useEditor({
    extensions: [
      ...schemaExtensions(), placeholder(),
      ...(ysess ? [Collaboration.configure({ document: ysess.doc, field: Y_FIELD }), CollaborationCaret.configure({ provider: ysess.provider, user: ysess.user })] : [UndoRedo]),
      ...extra,
    ],
    content: ysess ? undefined : (contentOf(s.doc.content) as JSONContent),
    editable, shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'doc-body', 'data-id': s.docId },
      // 看大图：双击图片；只读时单击也行（编辑时单击是选中图片，好拖动、删除）
      handleDoubleClickOn: (_view, _pos, node, nodePos, _event, direct) => { if (!direct || node.type.name !== 'image') return false; img.current(nodePos); return true; },
      handleClickOn: (view, _pos, node, nodePos, _event, direct) => { if (view.editable || !direct || node.type.name !== 'image') return false; img.current(nodePos); return true; },
    },
    onUpdate: ({ editor: e }) => upd.current(e),
    onSelectionUpdate: ({ editor: e }) => sel.current(e),
  }, [ysess]);
  useEffect(() => { onEditor(editor); return () => onEditor(null); }, [editor, onEditor]);
  useEffect(() => { editor?.setEditable(editable, false); }, [editor, editable]);
  return <EditorContent editor={editor} />;
}

/* ---------- 工具栏 ---------- */

function Tools({ editor, onImage, onLink }: { editor: Editor; onImage: () => void; onLink: () => void }) {
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      // 标题一到六级（2026-10-27 用户说文档会用到五级、六级标题）
      block: ((lv) => (lv ? `h${lv}` : 'p'))(HEADING_LEVELS.find((level) => e.isActive('heading', { level }))),
      bold: e.isActive('bold'), italic: e.isActive('italic'), ul: e.isActive('bulletList'), ol: e.isActive('orderedList'), table: e.isActive('table'), link: e.isActive('link'),
      undo: e.can().undo(), redo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();
  return (
    <Toolbar right={<>
      <button type="button" className="tt" onClick={() => c().undo().run()} disabled={!st.undo} title="撤销（Ctrl+Z）"><Icon name="undo" /><span className="lbl">撤销</span></button>
      <button type="button" className="tt" onClick={() => c().redo().run()} disabled={!st.redo} title="重做（Ctrl+Shift+Z）"><Icon name="redo" /><span className="lbl">重做</span></button>
    </>}>
      <Select aria-label="段落样式" title="段落样式" value={st.block} onChange={(v) => (v === 'p' ? c().setParagraph().run() : c().toggleHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6 }).run())} options={[['p', '正文'], ['h1', '标题 1'], ['h2', '标题 2'], ['h3', '标题 3'], ['h4', '标题 4'], ['h5', '标题 5'], ['h6', '标题 6']]} />
      <FontPick editor={editor} />
      <SizePick editor={editor} />
      <span className="sep" />
      <button type="button" className={cx('tt b', st.bold && 'on')} onClick={() => c().toggleBold().run()} aria-pressed={st.bold} title="加粗（Ctrl+B）">B</button>
      <button type="button" className={cx('tt i', st.italic && 'on')} onClick={() => c().toggleItalic().run()} aria-pressed={st.italic} title="斜体（Ctrl+I）">I</button>
      <ColorPick editor={editor} kind="color" />
      <ColorPick editor={editor} kind="bg" />
      <span className="sep" />
      <AlignPick editor={editor} />
      <span className="sep" />
      {/* 列表、编号：按钮本身是开关，旁边的小三角选样式 */}
      <span className="fmt-split">
        <button type="button" className={cx('tt', st.ul && 'on')} onClick={() => c().toggleBulletList().run()} aria-pressed={st.ul} title="列表"><Icon name="list" /><span className="lbl">列表</span></button>
        <ListPick editor={editor} type="bulletList" />
      </span>
      <span className="fmt-split">
        <button type="button" className={cx('tt', st.ol && 'on')} onClick={() => c().toggleOrderedList().run()} aria-pressed={st.ol} title="编号"><Icon name="ol" /><span className="lbl">编号</span></button>
        <ListPick editor={editor} type="orderedList" />
      </span>
      <span className="sep" />
      {st.table ? <>
        <button type="button" className="tt" onClick={() => c().addRowAfter().run()} title="在下面加一行">加行</button>
        <button type="button" className="tt" onClick={() => c().addColumnAfter().run()} title="在右边加一列">加列</button>
        <button type="button" className="tt" onClick={() => c().deleteRow().run()} title="删除这一行">删行</button>
        <button type="button" className="tt" onClick={() => c().deleteColumn().run()} title="删除这一列">删列</button>
        <button type="button" className="tt" onClick={() => c().deleteTable().run()}>删除表格</button>
      </> : <button type="button" className="tt" onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="插入表格（插入后拖竖线调列宽）"><Icon name="grid" /><span className="lbl">表格</span></button>}
      <button type="button" className="tt" onClick={onImage} title="插入图片"><Icon name="image" /><span className="lbl">图片</span></button>
      <button type="button" className={cx('tt', st.link && 'on')} onClick={onLink} aria-pressed={st.link} title="链接"><Icon name="link" /><span className="lbl">链接</span></button>
    </Toolbar>
  );
}

/** 给标题新起一个书签名：Word 也认的写法（字母开头，只有字母、数字、下划线），文档里没人用过 */
function newAnchorName(editor: Editor): string {
  for (;;) {
    const name = 'h_' + Math.random().toString(36).slice(2, 10);
    if (validAnchor(name) && !findAnchor(editor.state.doc, name)) return name;
  }
}

/**
 * 链接弹窗：有选中文字就给它加链接，没有就把地址本身插进去。
 * 也能链到文档里的标题（用户 2026-10-30 转来同事反馈：插入链接只能填网页、邮件或站内地址，要能插文档里的目录）：
 * 下面列出正文的标题，点一个就链到它——标题没有书签时给它起一个（挂在 anchor 属性上，导出 Word 也带着），链接地址是 #书签；
 * 没选中文字时插入标题的文字。点这种链接跳到那个标题（anchors.ts）
 */
function LinkDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [href, setHref] = useState<string>(String(editor.getAttributes('link').href ?? ''));
  const [q, setQ] = useState('');
  const had = editor.isActive('link');
  const heads = useMemo(() => tocOf(editor.state.doc), [editor]);
  // 正在改的链接指向文档里的哪个标题（高亮它）
  const curPos = useMemo(() => { const name = anchorOfHref(href); const hit = name ? findAnchor(editor.state.doc, name) : null; return hit?.node.type.name === 'heading' ? hit.pos : -1; }, [editor, href]);
  const shown = useMemo(() => { const k = q.trim().toLowerCase(); return k ? heads.filter((h) => h.text.toLowerCase().includes(k)) : heads; }, [heads, q]);
  const put = (url: string, text: string) => {
    const { from, to } = editor.state.selection;
    if (from === to && !had) editor.chain().focus().insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href: url } }] }).run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };
  const apply = () => {
    const v = href.trim();
    if (!v) { editor.chain().focus().extendMarkRange('link').unsetLink().run(); onClose(); return; }
    const url = /^(https?:\/\/|mailto:|\/|#)/i.test(v) ? v : 'https://' + v;
    put(url, url);
    onClose();
  };
  const toHeading = (it: TocItem) => {
    const node = editor.state.doc.nodeAt(it.pos);
    if (!node || node.type.name !== 'heading') { toast('这个标题已经不在了，请重新打开'); return; }
    const names = anchorNames(node.attrs.anchor);
    const name = names[0] ?? newAnchorName(editor);
    // 先挂书签（只改属性，选区不动），再加链接
    if (!names.length) editor.chain().command(({ tr }) => { tr.setNodeAttribute(it.pos, 'anchor', anchorValue([name])); return true; }).run();
    put('#' + encodeURIComponent(name), it.text || '跳转');
    onClose();
  };
  return (
    <Modal title={had ? '修改链接' : '插入链接'} onClose={onClose} footer={<>{had ? <button type="button" className="btn" onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); onClose(); }}>去掉链接</button> : null}<span className="spacer" /><button type="button" className="btn" onClick={onClose}>取消</button><button type="button" className="btn primary" onClick={apply}>确定</button></>}>
      <Field label="地址" htmlFor="link-href" hint="网页、邮件（mailto:）或站内地址；也可以在下面选文档里的标题">
        <input id="link-href" className="input" value={href} onChange={(e) => setHref(e.target.value)} placeholder="https://" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') apply(); }} />
      </Field>
      {heads.length ? <Field label="链接到文档里的标题" htmlFor="link-head-q">
        {heads.length > 8 ? <input id="link-head-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜标题" /> : null}
        <div className="link-heads" role="list">
          {shown.length ? shown.map((it) => <button key={it.key} type="button" role="listitem" className={cx('link-head', it.pos === curPos && 'on')} style={{ paddingLeft: 8 + (it.level - 1) * 14 }} onClick={() => toHeading(it)} title={it.text}>{it.text || '（没有文字的标题）'}</button>)
            : <p className="fine">没有找到「{q.trim()}」</p>}
        </div>
      </Field> : null}
    </Modal>
  );
}

/* ---------- 评论按钮 ---------- */

/** 选区里有没有字（只选了图片、空段落时不出评论按钮）；只看选中的那部分，碰到第一个字就停 */
function hasText(e: Editor): boolean {
  const { from, to } = e.state.selection;
  if (from === to) return false;
  let found = false;
  e.state.doc.nodesBetween(from, to, (n, pos) => {
    if (found) return false;
    if (n.isText && /\S/.test((n.text ?? '').slice(Math.max(0, from - pos), to - pos))) found = true;
    return !found;
  });
  return found;
}

/** 选中文字后浮在选区末尾下方的「评论」按钮，编辑和只读都有。放在正文的滚动容器里，跟着内容一起滚 */
function CommentButton({ editor, box, made, onComment }: { editor: Editor; box: RefObject<HTMLDivElement | null>; made: number; onComment: () => void }) {
  const sel = useEditorState({ editor, selector: ({ editor: e }) => (hasText(e) ? `${e.state.selection.from}:${e.state.selection.to}` : '') });
  // 拖着选的时候不出来，松手再出来；评论过（点按钮或快捷键，made 加一）就藏起来，选区变了再出来
  const [drag, setDrag] = useState(false), [done, setDone] = useState(''), [, relayout] = useState(0);
  const selNow = useRef(sel); selNow.current = sel;
  useEffect(() => { if (made) setDone(selNow.current); }, [made]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const down = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.('.cmt-btn')) setDrag(true); };
    const up = () => setDrag(false), resize = () => relayout((n) => n + 1);
    el.addEventListener('pointerdown', down);
    for (const t of ['pointerup', 'pointercancel', 'blur'] as const) window.addEventListener(t, up);
    window.addEventListener('resize', resize);
    return () => {
      el.removeEventListener('pointerdown', down);
      for (const t of ['pointerup', 'pointercancel', 'blur'] as const) window.removeEventListener(t, up);
      window.removeEventListener('resize', resize);
    };
  }, [box]);
  const el = box.current;
  if (!sel || drag || done === sel || !el) return null;
  let top = 0, left = 0;
  try {
    const c = editor.view.coordsAtPos(editor.state.selection.to, -1), r = el.getBoundingClientRect();
    top = c.bottom - r.top + el.scrollTop + 8;
    left = Math.max(8, Math.min(c.left - r.left + el.scrollLeft - 28, el.scrollLeft + el.clientWidth - 96));
  } catch { return null; }
  return (
    <button type="button" className="btn sm cmt-btn" style={{ top, left }} title="评论（Ctrl+Alt+M，Mac 上 ⌘+⌥+M）"
      onMouseDown={(e) => e.preventDefault()} onClick={onComment}>
      <Icon name="chat" />评论
    </button>
  );
}

const CONN_TEXT: Record<CollabState, string> = { connecting: '正在连接……', connected: '已连接', reconnecting: '正在重连……', offline: '离线，修改会在重连后同步', denied: '无法协同', failed: '没有连上协同服务' };

/* ---------- 编辑器 ---------- */

export function DocEditor({ session: s }: { session: Session }) {
  const theme = useTheme();
  const collab = param('collab') !== '0';
  const [ro, setRo] = useState(s.readonly);
  const roRef = useRef(ro); roRef.current = ro;
  const [editor, setEditor] = useState<Editor | null>(null);
  const [link, setLink] = useState(false), [busy, setBusy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null), bodyBox = useRef<HTMLDivElement>(null);
  // 目录：标题跟着正文变；宽屏固定在左边，窄的时候从左边滑出来
  const toc = useToc(editor), tocWide = useWide(TOC_WIDE);
  const [tocOpen, setTocOpen] = useTocOpen(toc.length, tocWide);

  // 评论：控制器和扩展一个编辑器页面一份，编辑器因为连接变化重建时沿用；宿主发过 comments 才显示入口
  const cmt = useMemo(() => new DocComments((m) => s.send(m)), [s]);
  const cmtExt = useMemo(() => [cmt.extension()], [cmt]);
  const [cmtOn, setCmtOn] = useState(false), [made, setMade] = useState(0);
  const comment = useCallback(() => { if (cmt.create()) setMade((n) => n + 1); else toast('先选中要评论的文字'); }, [cmt]);
  // 宿主可能在编辑器挂上之前就发来了评论列表（会话替我们记着）
  useEffect(() => {
    const c = s.lastHost('comments'), p = s.lastHost('comment-pending'), f = s.lastHost('comment-focus');
    if (c) { cmt.setItems(c.items); setCmtOn(true); }
    if (p) cmt.setPending(p.anchor);
    if (f) cmt.focus(f.cid);
  }, [s, cmt]);
  // 快捷键 Ctrl/⌘+Alt+M：挂在 window 上，只读时正文拿不到焦点也能用。Mac 上 Alt+M 会打出 µ，所以看 code 不看 key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.altKey || e.shiftKey || e.code !== 'KeyM' || !cmt.enabled) return;
      e.preventDefault();
      comment();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cmt, comment]);

  // 协同连接：一篇文档一个 Y.Doc 和一条 WebSocket；点了「重试」就重连
  const [ysess, setYsess] = useState<YSession | null>(null), [attempt, setAttempt] = useState(0);
  const [conn, setConn] = useState<CollabState>('connecting'), [connMsg, setConnMsg] = useState(''), [synced, setSynced] = useState(false);
  useEffect(() => {
    if (!collab) return;
    const doc = new Y.Doc();
    // s.wsUrl() 是 ws(s)://宿主/ws/collab/<编号>?token=…；y-websocket 自己拼房间名和参数，这里只要前面那段
    const base = s.wsUrl().replace(/\/ws\/collab\/.*$/, '/ws/collab');
    const provider = new WebsocketProvider(base, s.docId, doc, { params: { token: s.token, v: COLLAB_V }, disableBc: true, maxBackoffTime: 5000 });
    const sess: YSession = { doc, provider, user: { id: s.doc.user.id, name: s.doc.user.name, color: s.doc.user.color } };
    let everSynced = false, offlineTimer: number | undefined, lastPresent = '';
    const failTimer = window.setTimeout(() => { if (!everSynced) setConn((c) => (c === 'denied' ? c : 'failed')); }, CONNECT_TIMEOUT);
    // 标题在 Y.Text 'title' 里：别人改了就告诉宿主
    const ytitle = doc.getText(Y_TITLE);
    const onTitle = () => { const t = ytitle.toString().trim(); if (t && t !== s.doc.title) { s.doc.title = t; document.title = t; s.send({ type: 'title', title: t }); } };
    ytitle.observe(onTitle);
    provider.on('sync', (ok: boolean) => {
      if (!ok) return;
      everSynced = true; window.clearTimeout(failTimer); window.clearTimeout(offlineTimer);
      setSynced(true); setConn('connected'); setConnMsg('');
    });
    provider.on('status', ({ status }: { status: 'connected' | 'disconnected' | 'connecting' }) => {
      if (status !== 'disconnected' || !everSynced) return;
      setConn((c) => (c === 'denied' ? c : 'reconnecting'));
      window.clearTimeout(offlineTimer);
      offlineTimer = window.setTimeout(() => setConn((c) => (c === 'reconnecting' ? 'offline' : c)), OFFLINE_AFTER);
    });
    // 服务端说重连也没用：没有权限、文档不存在
    provider.on('closed', (ev: { code: number; reason: string }) => { window.clearTimeout(failTimer); setConn('denied'); setConnMsg(ev.reason || '没有权限'); lastPresent = '[]'; s.send({ type: 'present', users: [] }); });
    // 在线的人：awareness 里除了我以外的每个人报一次（服务端会把 user 换成登录身份，页面冒充不了）。
    // 光标一动 awareness 就变（每按一个键都变），名单没变就不报：以前每个键都报一次，宿主整个文档页跟着重画，大文档打字卡（2026-10-30）
    const onAwareness = () => {
      const seen = new Map<string, PresenceUser>();
      for (const [cid, st] of provider.awareness.getStates()) {
        const u = (st as { user?: { id?: string; name?: string } }).user;
        if (cid !== doc.clientID && u?.id && u.id !== s.doc.user.id && !seen.has(u.id)) seen.set(u.id, { id: u.id, name: u.name ?? '', editing: true });
      }
      const users = [...seen.values()], key = JSON.stringify(users);
      if (key === lastPresent) return;
      lastPresent = key;
      s.send({ type: 'present', users });
    };
    provider.awareness.on('change', onAwareness);
    setYsess(sess);
    return () => {
      window.clearTimeout(failTimer); window.clearTimeout(offlineTimer);
      ytitle.unobserve(onTitle); provider.awareness.off('change', onAwareness);
      provider.destroy(); doc.destroy();
      setYsess(null); setSynced(false); setConn('connecting');
    };
  }, [collab, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (collab) s.send({ type: 'collab', state: conn }); }, [collab, conn]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = collab && synced && conn !== 'denied' && !!ysess;
  /** 正文能不能改：只读、还没连上协同、协同失败都不能 */
  const editable = !ro && (!collab || live);
  // 协同模式没连上时看到的是打开时的内容，按它判断「原文找不到」不准，先不报
  useEffect(() => { cmt.setReportable(!collab || live); }, [cmt, collab, live]);

  // 普通模式：改动后交给会话自动保存；协同模式服务端自己落库
  const onUpdate = useCallback((e: Editor) => { if (!collab && !roRef.current) s.markDirty(() => snapshot(e)); }, [collab, s]);
  // 选区变化：节流后把选中的文字告诉宿主（AI 面板用）
  const selTimer = useRef(0), lastSel = useRef('');
  const onSelection = useCallback((e: Editor) => {
    if (selTimer.current) return;
    selTimer.current = window.setTimeout(() => {
      selTimer.current = 0;
      if (e.isDestroyed) return;
      const { from, to } = e.state.selection, text = from === to ? '' : e.state.doc.textBetween(from, to, '\n');
      if (text !== lastSel.current) { lastSel.current = text; s.send({ type: 'selection', text }); }
    }, SELECTION_EVERY);
  }, [s]);
  const onEditor = useCallback((e: Editor | null) => { setEditor(e); cmt.attach(e); if (import.meta.env.DEV) (window as unknown as { __editor?: Editor | null }).__editor = e; }, [cmt]);
  /** 看大图：全文的图片按出现的顺序交给宿主，at 是点的那张图片节点的位置 */
  const editorRef = useRef(editor); editorRef.current = editor;
  const viewImage = useCallback((at: number) => {
    const e = editorRef.current;
    if (!e || e.isDestroyed) return;
    const images: { src: string; alt?: string }[] = [];
    let index = -1;
    e.state.doc.descendants((n, pos) => {
      if (n.type.name !== 'image') return true;
      const src = typeof n.attrs.src === 'string' ? n.attrs.src : '';
      if (src) { if (pos === at) index = images.length; images.push({ src, ...(n.attrs.alt ? { alt: String(n.attrs.alt) } : {}) }); }
      return false;
    });
    if (index >= 0) s.send({ type: 'image-view', images, index });
  }, [s]);

  /** 宿主改了标题：协同模式写进 Y.Text，普通模式只记下来 */
  const applyTitle = useCallback((t: string) => {
    s.doc.title = t; document.title = t;
    if (ysess) setYText(ysess.doc.getText(Y_TITLE), t);
  }, [s, ysess]);

  // 导入：刚从文件创建、还没转换的内容。协同模式等连上以后再写，内容才会进 Y.Doc
  const imported = useRef(false);
  useEffect(() => {
    const f = s.doc.importFile;
    if (!f || !editor || !editable || imported.current) return;
    imported.current = true;
    (async () => {
      setBusy(`正在导入 ${f.name}……`);
      try {
        const res = await fetch(f.url || s.client.assetUrl(f.id));
        if (!res.ok) throw new Error(`下载源文件失败（${res.status}）`);
        // 几百张图的 Word 要传一会儿：报到第几张了（images.ts）
        const html = await importToHtml(f, await res.arrayBuffer(), s.client, (done, total) => { if (total) setBusy(`正在导入 ${f.name}：处理图片 ${done} / ${total}`); });
        editor.commands.setContent(html, { emitUpdate: true });
        const title = titleOf(s.doc.title, f.name);
        if (collab) applyTitle(title);
        else { s.markDirty(() => ({ ...snapshot(editor), title })); await s.flush(); }
        await s.client.imported();
        s.send({ type: 'imported', title });
        toast(`已导入 ${f.name}`);
      } catch (e) { imported.current = false; toast(`导入失败：${e instanceof Error ? e.message : '未知错误'}`); }
      finally { setBusy(null); }
    })();
  }, [editor, editable, collab, s, applyTitle]);

  // 宿主的消息
  useHost((m) => {
    if (m.type === 'readonly') setRo(m.value);
    else if (m.type === 'title') applyTitle(m.title);
    else if (m.type === 'focus') editor?.commands.focus();
    else if (m.type === 'comments') { cmt.setItems(m.items); setCmtOn(true); }
    else if (m.type === 'comment-focus') cmt.focus(m.cid);
    else if (m.type === 'comment-pending') cmt.setPending(m.anchor);
    else if (!editor) return;
    else if (m.type === 'insert') {
      if (!editor.isEditable) { toast('现在是只读状态，插不进去'); return; }
      if (m.html) editor.chain().focus('end').insertContent(m.html).run();
      else if (m.text) { const paras = paragraphsOf(m.text); if (paras.length) editor.chain().focus('end').insertContent(paras).run(); }
    } else if (m.type === 'export') void exportAs(editor, m.format);
  });
  const exportAs = async (e: Editor, format: string) => {
    const json = e.getJSON() as DocNode, title = s.doc.title || '文档';
    try {
      if (format === 'docx') s.download(await toDocx(json, title), `${title}.docx`);
      else if (format === 'md') s.download(new Blob([toMarkdown(json, title)], { type: 'text/markdown;charset=utf-8' }), `${title}.md`);
      else if (format === 'pdf') { window.print(); s.send({ type: 'exported', name: `${title}.pdf` }); }
      else toast(`不支持导出为 ${format}`);
    } catch (err) { toast(`导出失败：${err instanceof Error ? err.message : '未知错误'}`); }
  };

  const pickImage = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0]; ev.target.value = '';
    if (!file || !editor) return;
    if (!file.type.startsWith('image/')) { toast('只能插入图片文件'); return; }
    setBusy('正在上传图片……');
    try { const r = await s.client.upload(file); editor.chain().focus().setImage({ src: r.url, alt: file.name }).run(); }
    catch (e) { toast(`上传失败：${e instanceof Error ? e.message : '未知错误'}`); }
    finally { setBusy(null); }
  };

  const note = !collab ? null
    : conn === 'denied' ? <div className="note warn ed-note"><Icon name="warn" /> 没法参与协同编辑：{connMsg}。下面是打开时的内容，只能查看。</div>
    : conn === 'failed' && !synced ? <div className="note warn row ed-note"><span><Icon name="warn" /> 没有连上协同服务，暂时只能查看打开时的内容；连上以后会自动切回{ro ? '实时更新' : '编辑'}。</span><button type="button" className="btn sm" onClick={() => setAttempt((a) => a + 1)}>重试</button></div>
    : conn === 'offline' ? <div className="note warn ed-note"><Icon name="warn" /> {ro ? '现在是离线状态，看到的可能不是最新内容。' : '现在是离线状态，你可以继续写，连上以后会自动同步；别人这期间的修改也会合并进来。'}</div>
    : null;
  const showBody = !collab || live || conn === 'denied' || conn === 'failed';

  return (
    <div className="ed" style={{ colorScheme: theme }} data-collab={collab ? conn : 'off'}>
      {editable && editor ? <Tools editor={editor} onImage={() => fileInput.current?.click()} onLink={() => setLink(true)} /> : null}
      <div className="ed-row">
        {showBody && editor && tocOpen ? <Outline editor={editor} items={toc} box={bodyBox} wide={tocWide} onClose={() => setTocOpen(false)} /> : null}
        <div className="ed-body" ref={bodyBox}>
          <article className="doc">
            {note}
            {busy ? <div className="note ed-note"><span className="spin" /> {busy}</div> : null}
            {showBody ? <Body key={live ? `y${attempt}` : 'plain'} s={s} ysess={live ? ysess : null} editable={editable} extra={cmtExt} onEditor={onEditor} onUpdate={onUpdate} onSelection={onSelection} onImage={viewImage} />
              : <div className="ed-state"><span className="spin" role="status" aria-label={CONN_TEXT[conn]} /></div>}
            {ro && showBody ? <p className="note ed-note">你对这篇文档只有阅读权限{cmtOn ? '，可以选中文字加评论' : ''}。</p> : null}
          </article>
          {cmtOn && editor && showBody ? <CommentButton editor={editor} box={bodyBox} made={made} onComment={comment} /> : null}
          {editable && editor && showBody ? <ImageResizer editor={editor} box={bodyBox} /> : null}
        </div>
        {showBody && editor && toc.length && !tocOpen ? <TocButton wide={tocWide} onOpen={() => setTocOpen(true)} /> : null}
      </div>
      <input ref={fileInput} type="file" accept="image/*" className="sr" aria-label="选择图片" onChange={(e) => void pickImage(e)} />
      {link && editor ? <LinkDialog editor={editor} onClose={() => setLink(false)} /> : null}
      <Toaster />
    </div>
  );
}
