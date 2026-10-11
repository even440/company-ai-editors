/**
 * 表格编辑器：Univer 开源核心接到编辑会话上。
 * 内容是 Univer 的 IWorkbookData；格子、行列、合并、样式等任何修改模型的 mutation 都算改动，停下来后由会话自动保存。
 * 宿主消息：export（xlsx / csv）、insert（末尾追加一行文字）、readonly、title；theme 和 flush 由会话处理。
 */
import { useEffect, useRef, useState } from 'react';
import { CommandType, LocaleType, createUniver, defaultTheme, mergeLocales, type FUniver, type IWorkbookData } from '@univerjs/presets';
import { UniverSheetsCorePreset, WorkbookPermissionService, type FWorkbook } from '@univerjs/preset-sheets-core';
import zhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import { safeName, type Session } from '@cai/bridge';
import { useHost, useTheme } from '../shell/session';
import { Icon, Toaster, toast } from '../shell/ui';
import { csvBlob, emptyWorkbook, fromSheetJS, isWorkbookData, lastRowOf, plainOf, readSpreadsheet, xlsxBlob } from './convert';

/** 这些 mutation 不改内容（渲染时算行高、过滤器脏标记、权限点、空操作），不算改动 */
const NOT_A_CHANGE = new Set([
  'sheet.mutation.empty',
  'sheet.mutation.set-worksheet-row-auto-height',
  'sheet.mutation.mark-dirty-filter-change',
  'sheet.mutation.set-worksheet-permission-points',
  'sheet.mutation.data-validation-formula-mark-dirty',
]);

/** 宿主插入的 HTML 变成多行文字：段落、换行当行，单元格当制表符 */
function htmlToText(html: string): string {
  const marked = html.replace(/<\/(p|div|tr|li|h[1-6])>|<br\s*\/?>/gi, '\n').replace(/<\/t[dh]>/gi, '\t');
  return new DOMParser().parseFromString(marked, 'text/html').body.textContent ?? '';
}

/** 在当前工作表末尾的空行追加文字：每行一行，制表符分列，数字串存成数字 */
function appendText(wb: FWorkbook, text: string) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim()).map((l) => l.split('\t'));
  if (!lines.length) return;
  const sh = wb.getActiveSheet();
  const start = lastRowOf(wb.save().sheets[sh.getSheetId()]) + 1;
  const cols = Math.max(...lines.map((l) => l.length));
  const moreRows = start + lines.length - sh.getMaxRows();
  if (moreRows > 0) sh.insertRowsAfter(sh.getMaxRows() - 1, moreRows + 10);
  const moreCols = cols - sh.getMaxColumns();
  if (moreCols > 0) sh.insertColumns(sh.getMaxColumns(), moreCols);
  const cell = (x: string | undefined) => {
    if (x === undefined || x === '') return {};
    const n = Number(x);
    return { v: x.trim() !== '' && Number.isFinite(n) && !/^0\d/.test(x.trim()) ? n : x };
  };
  sh.getRange(start, 0, lines.length, cols).setValues(lines.map((l) => Array.from({ length: cols }, (_, i) => cell(l[i]))));
  sh.getRange(start, 0).activate();
}

export function SheetEditor({ session: s }: { session: Session }) {
  const box = useRef<HTMLDivElement>(null);
  const inst = useRef<FUniver | null>(null);
  const [ro, setRo] = useState(s.readonly);
  const [busy, setBusy] = useState<string | null>(null);
  const theme = useTheme();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const { univer, univerAPI: api } = createUniver({
      locale: LocaleType.ZH_CN,
      locales: { [LocaleType.ZH_CN]: mergeLocales(zhCN) },
      theme: defaultTheme,
      darkMode: s.theme === 'dark',
      presets: [UniverSheetsCorePreset({ container: el })],
    });
    inst.current = api;
    // 开发时把 API 挂到 window 上，截图脚本和控制台调试用；正式构建里没有
    if (import.meta.env.DEV) (window as unknown as { univerAPI?: FUniver }).univerAPI = api;
    let disposed = false;
    // 工作簿刚建好的一小段时间里，Univer 自己会跑一些 mutation（算公式、量行高），不算改动
    let settling = true;
    const snapshot = () => {
      const data: IWorkbookData = { ...api.getActiveWorkbook()!.save(), name: s.doc.title };
      return { content: data, plain: plainOf(data) };
    };
    api.addEvent(api.Event.CommandExecuted, (e) => {
      if (settling || e.type !== CommandType.MUTATION || !e.id.startsWith('sheet.mutation.') || NOT_A_CHANGE.has(e.id)) return;
      if (e.options?.fromCollab || e.options?.fromChangeset) return;
      s.markDirty(snapshot);
    });
    // 只读靠 Univer 的工作簿权限：Edit 等权限点关掉后，单元格编辑、粘贴、工具栏、右键菜单都会禁用。
    // 工作簿加进来后 Univer 会异步把权限点初始化成「允许」，所以要等它初始化完（unitPermissionInitStateChange$ 发 true）再设，早了会被冲掉。
    const applyPermission = () => {
      const wb = api.getActiveWorkbook();
      if (!wb) return;
      const perm = wb.getWorkbookPermission();
      void (s.readonly ? perm.setReadOnly() : perm.setEditable()).catch(() => { /* 本地权限服务不会失败 */ });
    };
    // 权限服务要等插件启动（第一次建工作簿时）才注册进来，所以在建完工作簿后再去拿
    const watchPermissionInit = (): { unsubscribe(): void } => {
      try {
        return univer.__getInjector().get(WorkbookPermissionService).unitPermissionInitStateChange$.subscribe((ready) => { if (ready && s.readonly) applyPermission(); });
      } catch {
        const t = setTimeout(() => { if (s.readonly) applyPermission(); }, 500); // 拿不到服务（不该发生）就稍后直接设
        return { unsubscribe: () => clearTimeout(t) };
      }
    };
    let permissionInit: { unsubscribe(): void } | null = null;
    const load = (data: IWorkbookData) => {
      settling = true;
      const wb = api.createWorkbook(data);
      permissionInit ??= watchPermissionInit();
      setTimeout(() => { settling = false; }, 800);
      return wb;
    };
    const fallback = () => emptyWorkbook(s.docId, s.doc.title);

    void (async () => {
      const f = s.doc.importFile;
      if (!f) { load(isWorkbookData(s.doc.content) ? s.doc.content : fallback()); return; }
      setBusy(`正在导入 ${f.name}…`);
      let loaded = false; // 保存那一步失败时不要再建一次工作簿
      try {
        const res = await fetch(s.client.assetUrl(f.id));
        if (!res.ok) throw new Error(`下载源文件失败（${res.status}）`);
        const data = fromSheetJS(readSpreadsheet(await res.arrayBuffer()), s.docId, s.doc.title);
        if (disposed) return;
        load(data);
        loaded = true;
        if (!s.readonly) {
          s.markDirty(snapshot);
          await s.flush();
          await s.client.imported();
          s.send({ type: 'imported', title: s.doc.title });
        }
        toast(`已导入 ${f.name}`);
      } catch (e) {
        if (disposed) return;
        const message = e instanceof Error ? e.message : '导入失败';
        if (!loaded) load(isWorkbookData(s.doc.content) ? s.doc.content : fallback());
        toast(`导入失败：${message}`);
        s.send({ type: 'error', message: `导入失败：${message}` });
      } finally { if (!disposed) setBusy(null); }
    })();

    return () => { disposed = true; inst.current = null; permissionInit?.unsubscribe(); univer.dispose(); };
  }, [s]);

  // 主题跟着宿主：Univer 自带深色模式
  useEffect(() => { inst.current?.toggleDarkMode(theme === 'dark'); }, [theme]);

  useHost((m) => {
    const api = inst.current, wb = api?.getActiveWorkbook();
    if (!api || !wb) return;
    if (m.type === 'export') {
      const data = wb.save(), name = safeName(s.doc.title);
      if (m.format === 'xlsx') s.download(xlsxBlob(data), `${name}.xlsx`);
      else if (m.format === 'csv') s.download(csvBlob(data, wb.getActiveSheet().getSheetId()), `${name}.csv`);
      else toast(`不支持导出为 ${m.format}`);
    } else if (m.type === 'insert') {
      if (s.readonly) { toast('只读，不能插入'); return; }
      appendText(wb, m.text ?? (m.html ? htmlToText(m.html) : ''));
    } else if (m.type === 'readonly') {
      s.doc.readonly = m.value;
      const perm = wb.getWorkbookPermission();
      void (s.readonly ? perm.setReadOnly() : perm.setEditable());
      setRo(s.readonly);
    } else if (m.type === 'title') {
      // 标题由宿主改；记下来，下次保存时写进工作簿的名字
      s.doc.title = m.title;
      document.title = m.title;
    }
  });

  return (
    <div className="ed sh-ed">
      {ro ? <div className="sh-ro" role="status"><Icon name="lock" /><b>只读</b><span>这份表格只能查看，不能修改</span></div> : null}
      <div className="sh-wrap">
        <div className="sh-univer" ref={box} />
        {busy ? <div className="sh-busy"><span className="spin" role="status" aria-label="加载中" /><span>{busy}</span></div> : null}
      </div>
      <Toaster />
    </div>
  );
}
