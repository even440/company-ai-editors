/** 导出 Excel：当前视图看得见的记录和字段，一个工作表。xlsx 按需加载，不进主包 */
import { textOf, type Field, type Rec, type UserMap } from './model';

export async function exportXlsx(fields: Field[], recs: Rec[], users: UserMap, sheetName: string): Promise<Blob> {
  const XLSX = await import('xlsx');
  const rows: unknown[][] = [fields.map((f) => f.name)];
  for (const r of recs) rows.push(fields.map((f) => { const v = r.v[f.id]; if (v == null || v === '') return ''; if (f.type === 'number') { const n = Number(v); return Number.isFinite(n) ? n : textOf(f, v, users); } return textOf(f, v, users); }));
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = fields.map((f) => ({ wch: Math.min(40, Math.max(8, ...rows.map((row, i) => String(row[fields.indexOf(f)] ?? '').length * (i ? 1.6 : 2)))) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
