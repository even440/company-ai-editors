/**
 * 表格内容的转换：Univer 的 IWorkbookData 和 SheetJS 工作簿互转、纯文本、空工作簿。
 * 不依赖 Univer 的运行时实例，导入导出和搜索文本都在这里，组件只负责把它们接到会话上。
 */
import { CellValueType, LocaleType, type ICellData, type IObjectMatrixPrimitiveType, type IStyleData, type IWorkbookData, type IWorksheetData } from '@univerjs/presets';
import * as XLSX from 'xlsx';

/** 保存的内容里 appVersion 要有值，Univer 保存时会换成它自己的版本号 */
const APP_VERSION = '1.0.3';
/** 新建工作簿的大小：够日常填一张小表，不够时在表里插行插列 */
const EMPTY_ROWS = 50, EMPTY_COLS = 12;

/** content 是不是一份 Univer 工作簿（不是就按空内容处理） */
export function isWorkbookData(c: unknown): c is IWorkbookData {
  return !!c && typeof c === 'object' && Array.isArray((c as IWorkbookData).sheetOrder) && typeof (c as IWorkbookData).sheets === 'object';
}

/** 空工作簿：一张 Sheet1 */
export function emptyWorkbook(id: string, name: string): IWorkbookData {
  return {
    id, name, appVersion: APP_VERSION, locale: LocaleType.ZH_CN, styles: {}, sheetOrder: ['sheet-01'],
    sheets: { 'sheet-01': { id: 'sheet-01', name: 'Sheet1', rowCount: EMPTY_ROWS, columnCount: EMPTY_COLS, cellData: {} } },
  };
}

/** 一个格子显示出来的文字：富文本取正文，布尔值写成 TRUE / FALSE */
export function cellText(cell: ICellData | null | undefined): string {
  if (!cell) return '';
  const rich = cell.p?.body?.dataStream;
  if (typeof rich === 'string') return rich.replace(/[\r\n]+$/, '').trim();
  if (cell.v === null || cell.v === undefined) return '';
  if (cell.t === CellValueType.BOOLEAN) return cell.v ? 'TRUE' : 'FALSE';
  return String(cell.v).trim();
}

/** 给搜索和 AI 用的纯文本：每个工作表每一行的非空格子按行拼起来，多张表时加表名 */
export function plainOf(wb: IWorkbookData, limit = 50_000): string {
  const out: string[] = [];
  let n = 0;
  for (const id of wb.sheetOrder) {
    const sh = wb.sheets[id];
    if (!sh) continue;
    if (wb.sheetOrder.length > 1 && sh.name) out.push(`【${sh.name}】`);
    const cells = sh.cellData ?? {};
    for (const r of Object.keys(cells).map(Number).sort((a, b) => a - b)) {
      const row = cells[r] ?? {};
      const vals = Object.keys(row).map(Number).sort((a, b) => a - b).map((c) => cellText(row[c])).filter(Boolean);
      if (!vals.length) continue;
      const line = vals.join('\t');
      out.push(line);
      n += line.length + 1;
      if (n > limit) return out.join('\n').slice(0, limit);
    }
  }
  return out.join('\n').slice(0, limit);
}

/** 工作表里最后一个有内容的行号（没有内容时 -1） */
export function lastRowOf(sh: Partial<IWorksheetData> | undefined): number {
  let last = -1;
  const cells: IObjectMatrixPrimitiveType<ICellData> = sh?.cellData ?? {};
  for (const r of Object.keys(cells)) {
    const row: Record<number, ICellData | null | undefined> = cells[Number(r)] ?? {};
    if (Object.values(row).some((c) => c && (c.v !== null && c.v !== undefined || c.p || c.f))) last = Math.max(last, Number(r));
  }
  return last;
}

/* ---------- SheetJS → Univer（导入） ---------- */

/** SheetJS 的一个格子变成 Univer 的格子：值、类型、公式和数字格式 */
function cellFromSheetJS(cell: XLSX.CellObject): ICellData | null {
  let d: ICellData;
  switch (cell.t) {
    case 'n': d = { v: cell.v as number, t: CellValueType.NUMBER }; break;
    case 'b': d = { v: cell.v ? 1 : 0, t: CellValueType.BOOLEAN }; break;
    case 'd': d = { v: cell.w ?? String(cell.v), t: CellValueType.STRING }; break; // cellDates 关着，一般不会出现；真出现就按显示文字存
    case 'e': d = { v: cell.w ?? '#VALUE!', t: CellValueType.STRING }; break;
    case 's': d = { v: String(cell.v ?? ''), t: CellValueType.STRING }; break;
    default: return null; // 'z'：空的占位格
  }
  if (cell.f) d.f = '=' + cell.f;
  if (cell.z && typeof cell.z === 'string' && cell.z !== 'General') d.s = { n: { pattern: cell.z } };
  if (d.v === '' && !d.f) return null;
  return d;
}

/** SheetJS 解析出来的工作簿变成 Univer 的内容：格子的值、公式、合并、列宽行高、隐藏的表都保留 */
export function fromSheetJS(wb: XLSX.WorkBook, id: string, name: string): IWorkbookData {
  const sheets: IWorkbookData['sheets'] = {};
  const sheetOrder: string[] = [];
  wb.SheetNames.forEach((sn, i) => {
    const ws = wb.Sheets[sn];
    if (!ws) return;
    const sid = `sheet-${String(i + 1).padStart(2, '0')}`;
    const cellData: IObjectMatrixPrimitiveType<ICellData> = {};
    let maxR = -1, maxC = -1;
    for (const k of Object.keys(ws)) {
      if (k[0] === '!') continue;
      const d = cellFromSheetJS(ws[k] as XLSX.CellObject);
      if (!d) continue;
      const { r, c } = XLSX.utils.decode_cell(k);
      (cellData[r] ??= {})[c] = d;
      if (r > maxR) maxR = r;
      if (c > maxC) maxC = c;
    }
    const mergeData = (ws['!merges'] ?? []).map((m) => ({ startRow: m.s.r, startColumn: m.s.c, endRow: m.e.r, endColumn: m.e.c }));
    for (const m of mergeData) { maxR = Math.max(maxR, m.endRow); maxC = Math.max(maxC, m.endColumn); }
    const columnData: IWorksheetData['columnData'] = {};
    (ws['!cols'] ?? []).forEach((c, ci) => { const w = c?.wpx ?? (c?.wch ? Math.round(c.wch * 7 + 5) : undefined); if (w) columnData[ci] = { w }; if (c?.hidden) columnData[ci] = { ...columnData[ci], hd: 1 }; });
    const rowData: IWorksheetData['rowData'] = {};
    (ws['!rows'] ?? []).forEach((r, ri) => { const h = r?.hpx ?? (r?.hpt ? Math.round(r.hpt * 4 / 3) : undefined); if (h) rowData[ri] = { h }; if (r?.hidden) rowData[ri] = { ...rowData[ri], hd: 1 }; });
    const hidden = wb.Workbook?.Sheets?.[i]?.Hidden ? 1 : 0;
    sheets[sid] = {
      id: sid, name: sn, hidden,
      rowCount: Math.max(maxR + 1 + 20, EMPTY_ROWS), columnCount: Math.max(maxC + 1 + 4, EMPTY_COLS),
      cellData, mergeData, columnData, rowData,
    };
    sheetOrder.push(sid);
  });
  if (!sheetOrder.length) return emptyWorkbook(id, name);
  return { id, name, appVersion: APP_VERSION, locale: LocaleType.ZH_CN, styles: {}, sheetOrder, sheets };
}

/** 读一份 xlsx / xls / csv 的二进制。cellStyles 开着才会解析列宽行高（!cols / !rows） */
export function readSpreadsheet(buf: ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(new Uint8Array(buf), { type: 'array', cellFormula: true, cellNF: true, cellDates: false, cellStyles: true });
}

/* ---------- Univer → SheetJS（导出） ---------- */

/** 格子的数字格式：样式可以是内联对象，也可以是 styles 表里的编号 */
function patternOf(cell: ICellData, styles: IWorkbookData['styles']): string | undefined {
  const s = typeof cell.s === 'string' ? styles[cell.s] : cell.s;
  const p = (s as IStyleData | null | undefined)?.n?.pattern;
  return p && p !== 'General' ? p : undefined;
}

function cellToSheetJS(cell: ICellData | null | undefined, styles: IWorkbookData['styles']): XLSX.CellObject | null {
  if (!cell) return null;
  const rich = cell.p?.body?.dataStream;
  let out: XLSX.CellObject;
  if (typeof rich === 'string') out = { t: 's', v: rich.replace(/[\r\n]+$/, '') };
  else if (cell.v === null || cell.v === undefined) { if (!cell.f) return null; out = { t: 's', v: '' }; }
  else if (cell.t === CellValueType.BOOLEAN) out = { t: 'b', v: !!cell.v };
  else if (typeof cell.v === 'number' && cell.t !== CellValueType.STRING && cell.t !== CellValueType.FORCE_STRING) out = { t: 'n', v: cell.v };
  else if (typeof cell.v === 'boolean') out = { t: 'b', v: cell.v };
  else out = { t: 's', v: String(cell.v) };
  // 共享公式（只有 si 没有 f）的格子要按偏移推公式，这里只导出算好的值
  if (typeof cell.f === 'string' && cell.f.startsWith('=')) out.f = cell.f.slice(1);
  const z = patternOf(cell, styles);
  if (z) out.z = z;
  return out;
}

/** Excel 的表名最多 31 个字，不能有 [ ] : * ? / \，也不能重复 */
function sheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let n = base, i = 2;
  while (used.has(n.toLowerCase())) { const suffix = ` (${i++})`; n = base.slice(0, 31 - suffix.length) + suffix; }
  used.add(n.toLowerCase());
  return n;
}

/** 一张 Univer 工作表变成 SheetJS 工作表 */
export function sheetToSheetJS(sh: Partial<IWorksheetData>, styles: IWorkbookData['styles']): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let maxR = -1, maxC = -1;
  const cells: IObjectMatrixPrimitiveType<ICellData> = sh.cellData ?? {};
  for (const r of Object.keys(cells)) {
    const row: Record<number, ICellData | null | undefined> = cells[Number(r)] ?? {};
    for (const [c, cell] of Object.entries(row)) {
      const x = cellToSheetJS(cell, styles);
      if (!x) continue;
      ws[XLSX.utils.encode_cell({ r: Number(r), c: Number(c) })] = x;
      maxR = Math.max(maxR, Number(r));
      maxC = Math.max(maxC, Number(c));
    }
  }
  for (const m of sh.mergeData ?? []) { maxR = Math.max(maxR, m.endRow); maxC = Math.max(maxC, m.endColumn); }
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(maxR, 0), c: Math.max(maxC, 0) } });
  if (sh.mergeData?.length) ws['!merges'] = sh.mergeData.map((m) => ({ s: { r: m.startRow, c: m.startColumn }, e: { r: m.endRow, c: m.endColumn } }));
  const cols = Object.entries(sh.columnData ?? {}).filter(([, c]) => c?.w || c?.hd);
  if (cols.length) { const arr: XLSX.ColInfo[] = []; for (const [i, c] of cols) arr[Number(i)] = { ...(c?.w ? { wpx: c.w } : {}), ...(c?.hd ? { hidden: true } : {}) }; ws['!cols'] = arr; }
  const rows = Object.entries(sh.rowData ?? {}).filter(([, r]) => r?.h || r?.hd);
  if (rows.length) { const arr: XLSX.RowInfo[] = []; for (const [i, r] of rows) arr[Number(i)] = { ...(r?.h ? { hpx: r.h } : {}), ...(r?.hd ? { hidden: true } : {}) }; ws['!rows'] = arr; }
  return ws;
}

/** 整份 Univer 内容变成 SheetJS 工作簿 */
export function toSheetJS(data: IWorkbookData): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const sid of data.sheetOrder) {
    const sh = data.sheets[sid];
    if (!sh) continue;
    XLSX.utils.book_append_sheet(wb, sheetToSheetJS(sh, data.styles), sheetName(sh.name ?? sid, used));
  }
  if (!wb.SheetNames.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Sheet1');
  return wb;
}

/** 导出成 xlsx 的二进制 */
export function xlsxBlob(data: IWorkbookData): Blob {
  const out = XLSX.write(toSheetJS(data), { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** 当前工作表导出成 csv：带 BOM，Excel 打开中文不乱码 */
export function csvBlob(data: IWorkbookData, sheetId: string): Blob {
  const sh = data.sheets[sheetId] ?? data.sheets[data.sheetOrder[0]] ?? {};
  const csv = XLSX.utils.sheet_to_csv(sheetToSheetJS(sh, data.styles));
  return new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
}
