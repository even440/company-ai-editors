/**
 * 问卷的数据：content = { desc, qs, set }。答卷不在 content 里，走宿主的 responses 接口。
 */
import type { SurveyResponse } from '@cai/bridge';

export type QType = 'single' | 'multi' | 'select' | 'text' | 'rate' | 'date';
export interface Question { id: string; type: QType; t: string; opts?: string[]; req: boolean }
export interface SurveySet { anon: boolean; once: boolean; due: string }
export interface SurveyContent { desc: string; qs: Question[]; set: SurveySet }
/** 一道题的答案：多选是数组，评分是 '1'…'5'，其余是字符串 */
export type Answer = string | string[];
export type Answers = Record<string, Answer>;

export const QT: Record<QType, string> = { single: '单选', multi: '多选', select: '下拉', text: '填空', rate: '评分', date: '日期' };
export const QTYPES = Object.keys(QT) as QType[];
export const hasOpts = (t: QType) => t === 'single' || t === 'multi' || t === 'select';

let seq = 0;
export const qid = () => 'q' + Date.now().toString(36) + (++seq).toString(36);
export function newQuestion(type: QType, t = '新问题', opts?: string[]): Question {
  return { id: qid(), type, t, opts: hasOpts(type) ? opts ?? ['选项 1', '选项 2'] : undefined, req: false };
}
export function emptyContent(): SurveyContent { return { desc: '', qs: [newQuestion('single')], set: { anon: false, once: true, due: '' } }; }

/** 宿主给的 content 可能是 {}（新建）或缺字段，按空内容兜底 */
export function normalize(raw: unknown): SurveyContent {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SurveyContent>;
  if (!Array.isArray(r.qs)) return emptyContent();
  const qs: Question[] = r.qs.filter((q) => q && typeof q === 'object').map((q) => {
    const type = QTYPES.includes(q.type) ? q.type : 'text';
    return { id: String(q.id || qid()), type, t: typeof q.t === 'string' ? q.t : '', opts: hasOpts(type) ? (Array.isArray(q.opts) && q.opts.length ? q.opts.map(String) : ['选项 1', '选项 2']) : undefined, req: !!q.req };
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

/** AI「生成」命令追加的三道常用题 */
export const GEN_QUESTIONS = (): Question[] => [
  newQuestion('rate', '你对这次安排的整体满意度'),
  newQuestion('multi', '你希望我们在哪些方面改进（可多选）', ['沟通协调', '流程效率', '工具支持', '培训资源', '其他']),
  newQuestion('text', '其他建议'),
];

/** 截止日期当天还能填，过了当天就不行 */
export const dueOver = (due: string) => !!due && /^\d{4}-\d{2}-\d{2}$/.test(due) && new Date(due + 'T23:59:59') < new Date();

export const fmtTime = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false }); };
/** 「10/9 15:25」这种短格式，统计的数字格里用 */
export const fmtShort = (iso: string) => { const d = new Date(iso); if (isNaN(d.getTime())) return iso; const p = (n: number) => String(n).padStart(2, '0'); return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
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
export const fmtAnswer = (v: unknown) => (Array.isArray(v) ? v.join('、') : v == null ? '' : String(v));
