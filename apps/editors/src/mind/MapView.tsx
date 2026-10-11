/**
 * 导图模式：simple-mind-map 的容器。实例只建一次，布局 / 主题 / 只读的变化用它的方法更新；节点数据的变化通过 data_change 事件回传给父组件。
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import MindMap, { type SmmRenderNode } from 'simple-mind-map';
import Export from 'simple-mind-map/src/plugins/Export.js';
import ExportXMind from 'simple-mind-map/src/plugins/ExportXMind.js';
import Drag from 'simple-mind-map/src/plugins/Drag.js';
import Select from 'simple-mind-map/src/plugins/Select.js';
import KeyboardNavigation from 'simple-mind-map/src/plugins/KeyboardNavigation.js';
import TouchEvent from 'simple-mind-map/src/plugins/TouchEvent.js';
import { clean, type MNode } from './model';
import { registerThemes, themeId } from './themes';

// 插件是全局注册的：导出（png / xmind）、拖动节点、框选、方向键移动选中、触屏手势
MindMap.usePlugin(Export).usePlugin(ExportXMind).usePlugin(Drag).usePlugin(Select).usePlugin(KeyboardNavigation).usePlugin(TouchEvent);
registerThemes();

/** 新建一个导图实例；导出时也会在屏幕外临时建一个 */
export function createMap(el: HTMLElement, root: MNode, layout: string, theme: string, readonly: boolean): MindMap {
  return new MindMap({
    el, data: structuredClone(root), layout, theme, readonly, fit: true,
    selectTextOnEnterEditText: true, // 新节点进入编辑时全选默认文字，直接打字就能替换
    enableShortcutOnlyWhenMouseInSvg: false, // 快捷键不要求鼠标停在画布上
    defaultInsertSecondLevelNodeText: '分支主题',
    defaultInsertBelowSecondLevelNodeText: '子主题',
    errorHandler: (code: string, err: unknown) => console.error('[mind]', code, err),
  });
}

interface Props { root: MNode; layout: string; theme: string; dark: boolean; readonly: boolean; apiRef: MutableRefObject<MindMap | null>; onData: (root: MNode) => void; onSel: (uid: string | null) => void }

export function MapView({ root, layout, theme, dark, readonly, apiRef, onData, onSel }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const cb = useRef({ onData, onSel });
  cb.current = { onData, onSel };

  useEffect(() => {
    const box = el.current!;
    const map = createMap(box, root, layout, themeId(theme, dark), readonly);
    // 初始化和 setData 也会发 data_change；内容没变就不当作改动
    let last = JSON.stringify(clean(root));
    map.on('data_change', (d: MNode | null) => { if (!d) return; const j = JSON.stringify(clean(d)); if (j === last) return; last = j; cb.current.onData(d); });
    map.on('node_active', (_n: SmmRenderNode | null, list: SmmRenderNode[]) => cb.current.onSel(list.length ? (list[0].getData('uid') as string) : null));
    const ro = new ResizeObserver(() => { if (box.clientWidth > 0 && box.clientHeight > 0) map.resize(); });
    ro.observe(box);
    apiRef.current = map;
    return () => { ro.disconnect(); apiRef.current = null; map.destroy(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const m = apiRef.current; const id = themeId(theme, dark); if (m && m.getTheme() !== id) m.setTheme(id); }, [theme, dark, apiRef]);
  useEffect(() => { const m = apiRef.current; if (m && m.getLayout() !== layout) m.setLayout(layout); }, [layout, apiRef]);
  useEffect(() => { apiRef.current?.setMode(readonly ? 'readonly' : 'edit'); }, [readonly, apiRef]);

  return <div ref={el} className="mn-canvas" aria-label="思维导图" />;
}
