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

/* ---------- postMessage ---------- */

export const EDITOR_SOURCE = 'cai-editor';
export const HOST_SOURCE = 'cai-host';

/** 编辑器发给宿主 */
export type EditorToHost =
  | { type: 'ready'; kind: Kind; title: string; readonly: boolean }
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
  | { type: 'selection'; text: string };

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
  | { type: 'flush' };

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
