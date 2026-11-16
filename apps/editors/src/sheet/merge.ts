/**
 * 合并单元格以后，字在合并出来的格子里居中（左右、上下）。
 * Univer 默认靠下对齐，合并出一个几行高的格子，字贴在最底下（用户 2026-11-16：「点击合并后，文字显示在底部，应该在合并单元格内居中显示」）。
 * 做法：Univer 的合并命令执行时会问一圈「还有没有要一起做的改动」，在这里把「左上角那格设成居中」交给它，
 * 这样居中和合并是同一步，撤销一次两样一起退回。全部合并、垂直合并、水平合并最后都走这条命令。
 * 那一格已经设过的对齐方向不动（比如特意设了靠左）。
 */
import { HorizontalAlign, IUniverInstanceService, ObjectMatrix, UniverInstanceType, VerticalAlign, type ICellData, type IRange, type IStyleData, type Univer, type Workbook } from '@univerjs/presets';
import { AddWorksheetMergeCommand, SetRangeValuesMutation, SetRangeValuesUndoMutationFactory, SheetInterceptorService, type ISetRangeValuesMutationParams } from '@univerjs/preset-sheets-core';

const NOTHING = { redos: [], undos: [] };

/** 要在工作簿建好以后调（服务这时才注册进来）；返回的 dispose 取消 */
export function centerOnMerge(univer: Univer): { dispose(): void } {
  const injector = univer.__getInjector();
  return injector.get(SheetInterceptorService).interceptCommand({
    getMutations(command) {
      if (command.id !== AddWorksheetMergeCommand.id) return NOTHING;
      const { unitId, subUnitId, ranges } = command.params as { unitId: string; subUnitId: string; ranges: IRange[] };
      const wb = injector.get(IUniverInstanceService).getUnit<Workbook>(unitId, UniverInstanceType.UNIVER_SHEET);
      const sheet = wb?.getSheetBySheetId(subUnitId);
      if (!wb || !sheet || !ranges?.length) return NOTHING;
      const cells = new ObjectMatrix<ICellData>();
      for (const r of ranges) {
        const old = wb.getStyles().getStyleByCell(sheet.getCellRaw(r.startRow, r.startColumn));
        const s: IStyleData = {};
        if (!old?.ht) s.ht = HorizontalAlign.CENTER;
        if (!old?.vt) s.vt = VerticalAlign.MIDDLE;
        if (s.ht || s.vt) cells.setValue(r.startRow, r.startColumn, { s });
      }
      if (!cells.getLength()) return NOTHING;
      const params: ISetRangeValuesMutationParams = { unitId, subUnitId, cellValue: cells.getMatrix() };
      return {
        redos: [{ id: SetRangeValuesMutation.id, params }],
        // 这时合并还没做，按现在的格子算出撤销要写回去的样式
        undos: [{ id: SetRangeValuesMutation.id, params: SetRangeValuesUndoMutationFactory(injector, params) }],
      };
    },
  });
}
