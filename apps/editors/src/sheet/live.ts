/**
 * 表格：别人保存的改动合并好以后换进 Univer（bridge 会话的 live；用户 2026-11-27：「两人同时在编辑的时候看不到对方编辑的结果」）。
 * - 只有格子变了：按格子发 set-range-values 改动，标成 fromCollab（不进撤销记录，SheetEditor 不当成自己的改动），选中、滚动、正在看的工作表都不动；
 * - 行列数、行高列宽、合并、工作表增删改名、冻结这些也变了：返回 null，由 SheetEditor 整个工作簿重建，再恢复当前工作表、选中区域和滚动位置。
 */
import { ICommandService, type ICellData, type IStyleData, type IWorkbookData, type Nullable, type Univer } from '@univerjs/presets';
import { same } from '@cai/bridge';

type Cells = Record<number, Record<number, ICellData | null>>;
export interface SheetCells { sheetId: string; cells: Cells; count: number }

/** 除了格子和样式表以外的样子：这些两边一样才能只改格子（工作簿名字跟着标题，不算） */
function shape(d: Partial<IWorkbookData>) {
  const sheets: Record<string, unknown> = {};
  for (const [k, sh] of Object.entries(d.sheets ?? {})) { const { cellData: _c, ...rest } = sh ?? {}; sheets[k] = rest; }
  const { styles: _s, sheets: _sh, name: _n, ...rest } = d;
  return { ...rest, sheets };
}

/** 格子里引用样式表的编号换成样式本身：两边样式表的编号可能不一样，新样式在自己这边的样式表里也可能没有 */
const inline = (cell: Nullable<ICellData>, styles: Record<string, Nullable<IStyleData>> | undefined): Nullable<ICellData> =>
  cell && typeof cell.s === 'string' && styles?.[cell.s] ? { ...cell, s: styles[cell.s] } : cell;

/** 按格子比出变了的格子（删掉的是 null）；结构也变了时返回 null（要整个重建） */
export function cellChanges(cur: IWorkbookData, next: IWorkbookData): SheetCells[] | null {
  if (!same(shape(cur), shape(next))) return null;
  const out: SheetCells[] = [];
  for (const [sheetId, sh] of Object.entries(next.sheets ?? {})) {
    const a = (cur.sheets?.[sheetId]?.cellData ?? {}) as Record<string, Record<string, ICellData>>;
    const b = (sh?.cellData ?? {}) as Record<string, Record<string, ICellData>>;
    const cells: Cells = {};
    let count = 0;
    for (const r of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const ra = a[r] ?? {}, rb = b[r] ?? {};
      for (const c of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
        const x = inline(ra[c], cur.styles), y = inline(rb[c], next.styles);
        if (same(x ?? null, y ?? null)) continue;
        (cells[Number(r)] ??= {})[Number(c)] = y ?? null;
        count++;
      }
    }
    if (count) out.push({ sheetId, cells, count });
  }
  return out;
}

/** 把变了的格子写进工作簿：先清掉再写（set-range-values 是往原来的格子上合并，对方去掉的公式、富文本这些要先清） */
export function applyCells(univer: Univer, unitId: string, changes: SheetCells[]) {
  const cmd = univer.__getInjector().get(ICommandService);
  for (const { sheetId, cells } of changes) {
    const clear: Cells = {}, write: Cells = {};
    for (const [r, row] of Object.entries(cells)) for (const [c, v] of Object.entries(row)) {
      (clear[Number(r)] ??= {})[Number(c)] = null;
      if (v) (write[Number(r)] ??= {})[Number(c)] = v;
    }
    cmd.syncExecuteCommand('sheet.mutation.set-range-values', { unitId, subUnitId: sheetId, cellValue: clear }, { fromCollab: true });
    if (Object.keys(write).length) cmd.syncExecuteCommand('sheet.mutation.set-range-values', { unitId, subUnitId: sheetId, cellValue: write, isOverrideStyle: true }, { fromCollab: true });
  }
}
