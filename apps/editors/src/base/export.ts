/** 导出 Excel：当前视图看得见的记录和字段，一个工作表。xlsx 按需加载，不进主包 */
import { isNumeric, textOf, val, type Field, type Rec, type UserMap } from './model';

export async function exportXlsx(all: Field[], recs: Rec[], users: UserMap, sheetName: string): Promise<Blob> {
  const XLSX = await import('xlsx');
  // 按钮没有值，不占一列
  const fields = all.filter((f) => f.type !== 'button');
  const rows: unknown[][] = [fields.map((f) => f.name)];
  // 数字类（数字、货币、进度、评分、自动编号）写成数字，Excel 里还能算；别的写显示的文字（附件是文件名）
  for (const r of recs) rows.push(fields.map((f) => { const v = val(f, r); if (v == null || v === '') return ''; if (isNumeric(f.type) || ((f.type === 'formula' || f.type === 'lookup') && typeof v === 'number')) { const n = Number(v); return Number.isFinite(n) ? n : textOf(f, v, users); } return textOf(f, v, users); }));
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = fields.map((f) => ({ wch: Math.min(40, Math.max(8, ...rows.map((row, i) => String(row[fields.indexOf(f)] ?? '').length * (i ? 1.6 : 2)))) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
