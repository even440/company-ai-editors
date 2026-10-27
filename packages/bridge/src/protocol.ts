/**
 * 编辑器和宿主（Company AI 平台或任何嵌入它的页面）之间的约定。
 * 编辑器在 iframe 里运行，宿主用 postMessage 和它通信；内容的读写走宿主提供的 HTTP 接口，带一次性的编辑令牌。
 * 这个文件只定义类型和常量，宿主侧可以照着它自己实现，不需要引用这个包。
 */

export type Kind = 'doc' | 'sheet' | 'slides' | 'base' | 'survey' | 'mind' | 'board' | 'flow' | 'file';
export const KINDS: Kind[] = ['doc', 'sheet', 'slides', 'base', 'survey', 'mind', 'board', 'flow', 'file'];
export const KIND_NAME: Record<Kind, string> = { doc: '文档', sheet: '表格', slides: '幻灯片', base: '多维表格', survey: '问卷', mind: '思维笔记', board: '画板', flow: '流程图', file: '文件' };

/** 当前打开编辑器的人（宿主按令牌确定，编辑器不能冒充） */
export interface EditorUser { id: string; name: string; color: string }
/** 通讯录里的一个人：人员字段、@提到成员用 */
export interface DirectoryUser { id: string; name: string; dept: string; tint: string }
/** 附在内容上的文件（上传的文件本身，或导入前的源文件） */
export interface EditorFile { id: string; name: string; size: number; mime: string; url: string }

export type EditorPerm = 'owner' | 'edit' | 'read' | 'respond';

/** GET /api/v1/editor/doc 的返回 */
export interface EditorDoc {
  id: string;
  kind: Kind;
  title: string;
  /** 各格式自己定义的 JSON；新建的内容是空对象 */
  content: unknown;
  version: number;
  perm: EditorPerm;
  /** 只能看不能改 */
  readonly: boolean;
  user: EditorUser;
  /** 数据级别：公开 | 内部 | 敏感 | 机密 */
  level: string;
  lang: string;
  updatedAt: string;
  /** kind 为 file 时是上传的文件 */
  file?: EditorFile | null;
  /** 刚导入、还没转换的源文件：编辑器转换后保存内容，宿主随即清掉这个标记 */
  importFile?: EditorFile | null;
  /** 问卷：是否在收集中 */
  collecting?: boolean;
  /** 问卷：当前成员填过几次 */
  responded?: number;
}

/** PUT /api/v1/editor/doc 的请求体 */
export interface SaveBody { version: number; content: unknown; plain: string; title?: string }
export interface SaveResult { version: number; updatedAt: string }
/** 版本冲突（HTTP 409）时返回最新的内容 */
export interface SaveConflict { error: 'version'; version: number; content: unknown; title: string }

export interface PresenceUser { id: string; name: string; editing: boolean }
/** 问卷的一份答卷 */
export interface SurveyResponse { id: string; userId: string | null; userName: string; at: string; answers: Record<string, unknown> }

/* ---------- 评论（锚在内容上的批注） ---------- */

/**
 * 评论的锚点：编辑器生成、宿主原样保存的 JSON，宿主不需要看懂里面的字段（序列化后不超过 COMMENT_ANCHOR_MAX 字节）。
 * 评论串、回复、@ 提到、通知都由宿主负责；编辑器只管选范围、画高亮、报点击和找不到的锚点。
 * 加评论不改内容本身（不写样式标记、不改格子、不调保存接口），所以只有阅读权限的人也能评论。
 */
export type CommentAnchor = DocCommentAnchor | SheetCommentAnchor;

/** 文档里的一段文字 */
export interface DocCommentAnchor {
  kind: 'doc';
  /** 锚点格式的版本 */
  v: 1;
  /**
   * 起点、终点的 Yjs 相对位置（Y.relativePositionToJSON 的结果，挂在协同正文的 Y.XmlFragment 上），别人同时改正文也跟得住。
   * 普通模式（collab=0）或没连上协同时创建的评论没有，为 null；相对位置失效时（比如协同服务按保存的内容重建了 Y.Doc）按下面的文字找。
   */
  rel: { from: unknown; to: unknown } | null;
  /** 选中的纯文字（段落之间是换行），最多 COMMENT_QUOTE_MAX 字 */
  quote: string;
  /** 选中文字的完整长度：超过 COMMENT_QUOTE_MAX 字时 quote 被截断，按文字找回来时用它恢复整段范围 */
  len: number;
  /** 前后各最多 COMMENT_CONTEXT 字的上下文：按文字找时，用它在多处相同的文字里挑对的那处 */
  prefix: string;
  suffix: string;
  /** 创建时的位置（ProseMirror 绝对位置），只在多处文字和上下文都一样时用来挑最近的 */
  at: number;
}

/** 表格里的一个格子或一片区域：行列号从 0 起，含两端 */
export interface SheetCommentAnchor {
  kind: 'sheet';
  v: 1;
  sheetId: string;
  row: number;
  col: number;
  endRow: number;
  endCol: number;
  /** 区域里格子的显示文字（格子之间制表符、行之间换行），最多 COMMENT_QUOTE_MAX 字；空格子是空字符串 */
  quote: string;
  /** 创建时的工作表名，只给宿主显示用（「Sheet1!B3」） */
  sheetName?: string;
}

/** 宿主发来的一条评论：编辑器只要锚点和是否已解决 */
export interface CommentItem { cid: string; anchor: CommentAnchor; resolved: boolean }

/** 锚点序列化后的上限（字节） */
export const COMMENT_ANCHOR_MAX = 4096;
/** 锚点里引用的原文最多多少字 */
export const COMMENT_QUOTE_MAX = 500;
/** 文档锚点前后各留多少字的上下文 */
export const COMMENT_CONTEXT = 32;

/* ---------- postMessage ---------- */

export const EDITOR_SOURCE = 'cai-editor';
export const HOST_SOURCE = 'cai-host';

/** 编辑器发给宿主 */
export type EditorToHost =
  /** comments 为 true 表示这种编辑器支持锚在内容上的评论（文档、表格），宿主收到后再发 comments */
  | { type: 'ready'; kind: Kind; title: string; readonly: boolean; comments?: boolean }
  | { type: 'title'; title: string }
  | { type: 'saving' }
  | { type: 'saved'; version: number; at: string }
  | { type: 'dirty'; dirty: boolean }
  | { type: 'conflict'; version: number }
  | { type: 'collab'; state: 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'denied' | 'failed' }
  | { type: 'present'; users: PresenceUser[] }
  | { type: 'error'; message: string }
  | { type: 'navigate'; docId: string }
  | { type: 'request'; what: 'share' | 'ai' | 'history' | 'close' }
  | { type: 'exported'; name: string }
  | { type: 'imported'; title: string }
  | { type: 'selection'; text: string }
  /** 用户要评论当前选中的内容：宿主打开评论框；发出以后把新评论放进 comments 发回来。quote 和 anchor.quote 相同，方便宿主直接显示 */
  | { type: 'comment-new'; anchor: CommentAnchor; quote: string }
  /** 用户点了内容里某条评论的高亮或标记 */
  | { type: 'comment-open'; cid: string }
  /** 锚点已经找不到的评论（原文被删了、工作表被删了……），包括已解决的。收到 comments 以后发一次，之后有变化再发（约 1 秒防抖）；没有就是空数组 */
  | { type: 'comment-orphans'; cids: string[] }
  /**
   * 表格：插入、删除行列以后锚点跟着挪了，anchor 是挪过以后的。宿主可以用它更新保存的锚点（要确认对方有编辑权限）；
   * 不处理也行，只是下次打开时评论回到原来的行列号上。文档的锚点不需要这个，不会发
   */
  | { type: 'comment-moved'; cid: string; anchor: CommentAnchor }
  /**
   * 用户要看大图（文档：双击图片，只读时单击也行；2026-10-27 同事反馈知识库、文档里的图片不能双击放大）：images 是这份内容里全部的图片（按出现的顺序），
   * index 是点的那张。宿主全屏打开看图（缩放、旋转、翻看）；不认的宿主什么都不做
   */
  | { type: 'image-view'; images: { src: string; alt?: string }[]; index: number };

/** 宿主发给编辑器 */
export type HostToEditor =
  | { type: 'theme'; theme: 'light' | 'dark' }
  | { type: 'title'; title: string }
  /** 把一段文字（或 HTML）插到内容末尾：AI 续写、整理稿 */
  | { type: 'insert'; text?: string; html?: string }
  /** 导出：格式名由各编辑器定义，例如 doc 的 docx / md / pdf，sheet 的 xlsx / csv */
  | { type: 'export'; format: string }
  | { type: 'readonly'; value: boolean }
  /** 各编辑器自己定义的命令，例如 base 的 filter、slides 的 play、mind 的 mode */
  | { type: 'command'; name: string; args?: unknown }
  | { type: 'focus' }
  /** 宿主让编辑器立刻把没保存的内容写回去（关闭前） */
  | { type: 'flush' }
  /**
   * 全部评论，整份替换之前的。宿主收到 ready（comments 为 true）以后发一次（没有评论也发空数组，编辑器收到过它才显示「评论」入口），
   * 之后评论有增删、解决状态变了就再发
   */
  | { type: 'comments'; items: CommentItem[] }
  /** 让某条评论成为当前评论：滚到它的位置、高亮加重（已解决的也会临时显示出来）；cid 为空字符串时取消 */
  | { type: 'comment-focus'; cid: string }
  /** 宿主的评论框开着时临时高亮的范围（一般就是 comment-new 里的锚点）；null 清掉 */
  | { type: 'comment-pending'; anchor: CommentAnchor | null };

export type EditorMessage = EditorToHost & { source: typeof EDITOR_SOURCE; docId: string };
export type HostMessage = HostToEditor & { source: typeof HOST_SOURCE };

/** 每种格式支持的导出格式：[格式键, 显示名] */
export const EXPORTS: Record<Kind, [string, string][]> = {
  doc: [['docx', 'Word'], ['md', 'Markdown'], ['pdf', 'PDF']],
  sheet: [['xlsx', 'Excel'], ['csv', 'CSV']],
  slides: [['pptx', 'PowerPoint'], ['pdf', 'PDF']],
  base: [['xlsx', 'Excel']],
  survey: [['xlsx', 'Excel（答卷）']],
  mind: [['png', '图片'], ['xmind', 'XMind'], ['md', 'Markdown 大纲']],
  board: [['png', '图片'], ['svg', 'SVG']],
  flow: [['png', '图片'], ['svg', 'SVG']],
  file: [['download', '下载原文件']],
};

/** 可以导入成哪种在线内容：按扩展名 */
export function importKindOf(name: string): Kind | null {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  if (['docx', 'md', 'markdown', 'txt', 'html', 'htm'].includes(ext)) return 'doc';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'sheet';
  if (['pptx'].includes(ext)) return 'slides';
  if (['xmind', 'opml'].includes(ext)) return 'mind';
  return null;
}
