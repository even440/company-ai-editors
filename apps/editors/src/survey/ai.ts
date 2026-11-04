/**
 * AI 出的题：宿主（平台文档页的 AI 面板「加到问卷」）发来的 insert 文字认成题目。
 * 格式由平台的系统指令约定（platform 的 modules/docs/file-text.ts 的 insertBrief，改格式两边一起改）：
 *   > 问卷说明（可选）
 *   1. [single*] 题目
 *   - 选项
 *   - 选项
 *   2. [rate] 题目
 * 方括号里是题型（single multi select text rate date，五种语言的题型名也认），* 是必答。
 * 模型不一定照做：加粗、标题符号、「Q1.」「1)」「第 1 题：」、A. 这种选项、前后的客套话都容忍；没写题型的有选项算单选、没选项算填空。
 */
import { DEFAULT_OPTS, DEFAULT_TITLES, QT_NAMES } from './i18n';
import { QTYPES, defaultOpts, hasOpts, newQuestion, type QType, type Question, type SurveyContent } from './model';

/** 一次最多认多少道题、每道题多少个选项、题目多长 */
export const AI_MAX_QS = 50, AI_MAX_OPTS = 20, AI_MAX_LEN = 200;

const TYPE_WORDS = new Map<string, QType>([
  ...QTYPES.map((k) => [k, k] as [string, QType]),
  ...QT_NAMES.map(([name, k]) => [name.toLowerCase(), k] as [string, QType]),
  ...([
    ['radio', 'single'], ['choice', 'single'], ['单选题', 'single'],
    ['checkbox', 'multi'], ['multiple', 'multi'], ['多选题', 'multi'],
    ['dropdown', 'select'], ['下拉题', 'select'],
    ['input', 'text'], ['open', 'text'], ['textarea', 'text'], ['填空题', 'text'], ['问答', 'text'], ['简答', 'text'],
    ['rating', 'rate'], ['star', 'rate'], ['stars', 'rate'], ['score', 'rate'], ['评分题', 'rate'], ['打分', 'rate'],
  ] as [string, QType][]),
]);
const REQ_WORDS = new Set(['*', 'required', 'req', 'must', '必答', '必填', 'obrigatória', 'obrigatório', 'obrigatoria', 'obrigatorio', '必須', '필수']);
/** 题目末尾的「（必答）」「(required)」「*」 */
const REQ_TAIL = /\s*(?:[（(]\s*(?:必答|必填|required|obrigatóri[ao]|obrigatori[ao]|必須|필수)\s*[)）]|[*＊])\s*$/i;
/** 没写题型时，题目里这样说的有选项算多选 */
const MULTI_HINT = /可多选|多选|multiple|select all|all that apply|várias|mais de uma|marque quantas|複数|복수/i;

const QUESTION = /^(?:q|第)?\s*(\d{1,3})\s*题?\s*[.)．、:：]\s*(\S.*)$/i;
const OPTION = /^(?:[-*+•·●○◯□☐▪◦]|[a-z][.)．、]|\([a-z]\)|[①-⑳])\s*(\S.*)$/i;

/** 去掉 Markdown 的加粗、行内代码、标题符号和任务列表的方框 */
function clean(line: string): string {
  return line.replace(/\*\*|__|`/g, '').replace(/^\s*#{1,6}\s+/, '').replace(/^(\s*[-*+]\s+)\[[ xX]\]\s*/, '$1').trim();
}

/** 题目前后的 [题型] / 【题型】：认得出题型或必答才算，认不出的（「[可选]」这类）留在题目里 */
function takeTag(title: string): { title: string; type: QType | null; req: boolean } | null {
  const front = title.match(/^[[【]([^\]】]{1,40})[\]】]\s*(.*)$/);
  const tail = front ? null : title.match(/^(.*?)\s*[[【]([^\]】]{1,40})[\]】]$/);
  const tag = front ? front[1] : tail?.[2], rest = front ? front[2] : tail?.[1];
  if (tag == null || rest == null) return null;
  let s = tag.toLowerCase().trim(), type: QType | null = null, req = false;
  if (/[*＊]/.test(s)) { req = true; s = s.replace(/[*＊]/g, ' ').trim(); }
  // 先按整段认（「escolha única」「single choice」这种带空格的名字），再按逗号、空格拆开认
  for (const part of [s, ...s.split(/[,，、|/;；]+/)].map((x) => x.trim()).filter(Boolean)) {
    for (const w of [part, ...part.split(/\s+/)]) {
      if (REQ_WORDS.has(w)) req = true;
      else type ??= TYPE_WORDS.get(w) ?? null;
    }
  }
  return type || req ? { title: rest.trim(), type, req } : null;
}

interface Draft { title: string; type: QType | null; req: boolean; opts: string[] }

/** 认出的说明和题目；一道题都没认出时为 null */
export function parseQuestions(text: string): { desc: string; qs: Question[] } | null {
  const desc: string[] = [], drafts: Draft[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const quote = raw.match(/^\s*>\s?(.*)$/);
    if (quote) { if (!drafts.length && clean(quote[1])) desc.push(clean(quote[1])); continue; }
    const line = clean(raw);
    if (!line) continue;
    const q = line.match(QUESTION);
    if (q) {
      if (drafts.length >= AI_MAX_QS) break;
      let title = q[2], type: QType | null = null, req = false;
      const tag = takeTag(title);
      if (tag) ({ title, type, req } = tag);
      if (REQ_TAIL.test(title)) { req = true; title = title.replace(REQ_TAIL, ''); }
      drafts.push({ title: title.trim().slice(0, AI_MAX_LEN), type, req, opts: [] });
      continue;
    }
    // 选项只认挂在题目下面的；第一道题之前、各种说明文字一律不要
    const o = drafts.length ? line.match(OPTION) : null;
    const cur = drafts[drafts.length - 1];
    if (o && cur && cur.opts.length < AI_MAX_OPTS) {
      const opt = o[1].trim().slice(0, AI_MAX_LEN);
      if (opt && !cur.opts.includes(opt)) cur.opts.push(opt);
    }
  }
  const qs = drafts.filter((d) => d.title).map((d) => {
    const type = d.type ?? (d.opts.length ? (MULTI_HINT.test(d.title) ? 'multi' : 'single') : 'text');
    let opts: string[] | undefined;
    if (hasOpts(type)) {
      opts = d.opts.length ? [...d.opts] : defaultOpts();
      // 只给了一个选项时补一个默认的，编辑器要求至少两个
      if (opts.length < 2) opts.push(defaultOpts()[1]);
    }
    return { ...newQuestion(type, d.title, opts), req: d.req };
  });
  return qs.length ? { desc: desc.join(' ').slice(0, 500), qs } : null;
}

/** 还只有一道没改过的默认题（新建的问卷）：AI 出的题直接替换它 */
export function isBlank(c: SurveyContent): boolean {
  if (c.qs.length !== 1 || c.desc.trim()) return false;
  const q = c.qs[0];
  return !q.req && q.type === 'single' && DEFAULT_TITLES.has(q.t) && (q.opts ?? []).every((o) => DEFAULT_OPTS.has(o));
}

/** 把认出的题放进问卷：空问卷替换默认题，否则加在后面；问卷还没有说明时用 AI 写的 */
export function applyAi(c: SurveyContent, got: { desc: string; qs: Question[] }): void {
  if (isBlank(c)) c.qs = got.qs;
  else c.qs.push(...got.qs);
  if (got.desc && !c.desc.trim()) c.desc = got.desc;
}
