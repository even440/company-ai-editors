/** 答卷导出成 Excel：一张「答卷」表（一行一份），一张「题目」表，表头和表名按界面语言。xlsx 按需加载，不进首屏包 */
import { safeName, type SurveyResponse } from '@cai/bridge';
import { T } from './i18n';
import { QT, fmtAnswer, fmtTime, type Question, type SurveyContent } from './model';

const cell = (q: Question, v: unknown) => (q.type === 'rate' && v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : fmtAnswer(v));

export async function exportXlsx(title: string, c: SurveyContent, responses: SurveyResponse[], download: (blob: Blob, name: string) => void) {
  const XLSX = await import('xlsx');
  const anon = c.set.anon, X = T.x;
  const header = [X.no, ...(anon ? [] : [X.user]), X.at, ...c.qs.map((q, i) => `${i + 1}. ${q.t}`)];
  const rows = responses.map((r, i) => [i + 1, ...(anon ? [] : [r.userName]), fmtTime(r.at), ...c.qs.map((q) => cell(q, r.answers[q.id]))]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = header.map((h) => ({ wch: Math.min(40, Math.max(10, Array.from(h).length * 2)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, X.sheet);
  const qws = XLSX.utils.aoa_to_sheet([[X.no, X.qs, X.type, X.req, X.opts], ...c.qs.map((q, i) => [i + 1, q.t, QT[q.type], q.req ? X.yes : X.no2, (q.opts ?? []).join(' / ')])]);
  qws['!cols'] = [{ wch: 6 }, { wch: 40 }, { wch: 14 }, { wch: 10 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, qws, X.qs);
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), safeName(title) + X.file + '.xlsx');
}
