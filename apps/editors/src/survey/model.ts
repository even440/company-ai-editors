/**
 * 问卷的数据：content = { desc, qs, set }。答卷不在 content 里，走宿主的 responses 接口。
 */
import type { SurveyResponse } from '@cai/bridge';
import { lang, listSep } from '../shell/i18n';
import { T } from './i18n';

export type QType = 'single' | 'multi' | 'select' | 'text' | 'rate' | 'date';
export interface Question { id: string; type: QType; t: string; opts?: string[]; req: boolean }
export interface SurveySet { anon: boolean; once: boolean; due: string }
export interface SurveyContent { desc: string; qs: Question[]; set: SurveySet }
/** 一道题的答案：多选是数组，评分是 '1'…'5'，其余是字符串 */
export type Answer = string | string[];
export type Answers = Record<string, Answer>;

/** 题型的名字（按界面语言） */
export const QT: Record<QType, string> = T.qt;
export const QTYPES = Object.keys(QT) as QType[];
export const hasOpts = (t: QType) => t === 'single' || t === 'multi' || t === 'select';
/** 新题、新选项的默认文字按界面语言写进内容 */
export const defaultOpts = () => [T.opt(1), T.opt(2)];

let seq = 0;
export const qid = () => 'q' + Date.now().toString(36) + (++seq).toString(36);
export function newQuestion(type: QType, t = T.newQ, opts?: string[]): Question {
  return { id: qid(), type, t, opts: hasOpts(type) ? opts ?? defaultOpts() : undefined, req: false };
}
export function emptyContent(): SurveyContent { return { desc: '', qs: [newQuestion('single')], set: { anon: false, once: true, due: '' } }; }

/** 宿主给的 content 可能是 {}（新建）或缺字段，按空内容兜底 */
export function normalize(raw: unknown): SurveyContent {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SurveyContent>;
  if (!Array.isArray(r.qs)) return emptyContent();
  const qs: Question[] = r.qs.filter((q) => q && typeof q === 'object').map((q) => {
    const type = QTYPES.includes(q.type) ? q.type : 'text';
    return { id: String(q.id || qid()), type, t: typeof q.t === 'string' ? q.t : '', opts: hasOpts(type) ? (Array.isArray(q.opts) && q.opts.length ? q.opts.map(String) : defaultOpts()) : undefined, req: !!q.req };
  });
  const set = (r.set && typeof r.set === 'object' ? r.set : {}) as Partial<SurveySet>;
  return { desc: typeof r.desc === 'string' ? r.desc : '', qs: qs.length ? qs : [newQuestion('single')], set: { anon: !!set.anon, once: set.once !== false, due: typeof set.due === 'string' ? set.due : '' } };
}

/** 给搜索和 AI 用的纯文本：说明、题目和选项 */
export function plainOf(c: SurveyContent): string {
  const lines = [c.desc.trim()];
  c.qs.forEach((q, i) => { lines.push(`${i + 1}. ${q.t}`); if (q.opts?.length) lines.push('   ' + q.opts.join(' / ')); });
  return lines.filter(Boolean).join('\n');
}

/** 宿主「生成」命令追加的三道常用题 */
export const GEN_QUESTIONS = (): Question[] => [
  newQuestion('rate', T.gen.rate),
  newQuestion('multi', T.gen.multi, [...T.gen.opts]),
  newQuestion('text', T.gen.text),
];

/** 截止日期当天还能填，过了当天就不行 */
export const dueOver = (due: string) => !!due && /^\d{4}-\d{2}-\d{2}$/.test(due) && new Date(due + 'T23:59:59') < new Date();
/** 截止日期按界面语言的写法（2026/10/15、15/10/2026……） */
export const fmtDue = (due: string) => { const d = new Date(due + 'T00:00:00'); return isNaN(d.getTime()) ? due : d.toLocaleDateString(lang); };

export const fmtTime = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString(lang, { hour12: false }); };
/** 「10/9 15:25」这种短格式（月日的先后跟界面语言），统计的数字格里用 */
export const fmtShort = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString(lang, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); };
export const isToday = (iso: string) => { const d = new Date(iso), n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate(); };

/** 某道题所有有效的答案（去掉没填的） */
export function answersOf(q: Question, list: SurveyResponse[]): Answer[] {
  const out: Answer[] = [];
  for (const r of list) {
    const v = r.answers[q.id];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    out.push(Array.isArray(v) ? v.map(String) : String(v));
  }
  return out;
}
export const fmtAnswer = (v: unknown) => (Array.isArray(v) ? v.join(listSep) : v == null ? '' : String(v));
