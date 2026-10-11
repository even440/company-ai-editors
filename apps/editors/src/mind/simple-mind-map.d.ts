/**
 * simple-mind-map 0.14 没有带类型声明（package.json 指向的 types 目录不存在），这里只声明我们用到的那部分。
 * 节点数据的形状和 model.ts 里的 MNode 一致：{ data: { text, uid, expand, … }, children }。
 */
declare module 'simple-mind-map' {
  export interface SmmNodeData { text: string; uid?: string; expand?: boolean; isActive?: boolean; [k: string]: unknown }
  export interface SmmNode { data: SmmNodeData; children: SmmNode[]; [k: string]: unknown }
  /** 渲染后的节点实例（命令的 appointNodes 参数要的是这个） */
  export interface SmmRenderNode {
    uid: string;
    isRoot: boolean;
    layerIndex: number;
    nodeData: SmmNode;
    parent: SmmRenderNode | null;
    children: SmmRenderNode[];
    getData(key?: string): unknown;
  }
  export interface SmmOptions {
    el: HTMLElement;
    data?: SmmNode | null;
    layout?: string;
    theme?: string;
    themeConfig?: Record<string, unknown>;
    readonly?: boolean;
    fit?: boolean;
    [k: string]: unknown;
  }
  export default class MindMap {
    constructor(opt: SmmOptions);
    static usePlugin(plugin: unknown, opt?: unknown): typeof MindMap;
    static hasPlugin(plugin: unknown): number;
    static defineTheme(name: string, config: Record<string, unknown>): void;
    opt: SmmOptions;
    el: HTMLElement;
    renderer: {
      activeNodeList: SmmRenderNode[];
      root: SmmRenderNode | null;
      findNodeByUid(uid: string): SmmRenderNode | undefined;
      textEdit: { isShowTextEdit(): boolean; hideEditTextBox(): void };
    };
    view: {
      scale: number;
      enlarge(cx?: number, cy?: number): void;
      narrow(cx?: number, cy?: number): void;
      fit(): void;
      reset(): void;
    };
    on(event: string, fn: (...args: any[]) => void): void;
    off(event: string, fn: (...args: any[]) => void): void;
    emit(event: string, ...args: unknown[]): void;
    getData(withConfig?: boolean): any;
    setData(data: SmmNode): void;
    updateData(data: SmmNode): void;
    getLayout(): string;
    setLayout(layout: string): void;
    getTheme(): string;
    setTheme(theme: string): void;
    setThemeConfig(config: Record<string, unknown>, notRender?: boolean): void;
    setMode(mode: 'readonly' | 'edit'): void;
    execCommand(name: string, ...args: unknown[]): void;
    export(type: string, isDownload?: boolean, name?: string, ...args: unknown[]): Promise<any>;
    resize(): void;
    destroy(): void;
  }
}

declare module 'simple-mind-map/src/plugins/*' {
  const plugin: { instanceName: string; new (...args: any[]): unknown };
  export default plugin;
}

declare module 'simple-mind-map/src/parse/xmind.js' {
  const xmind: {
    /** 解析 .xmind（新版 content.json 和旧版 content.xml 都行），返回节点树 */
    parseXmindFile(file: Blob | ArrayBuffer, handleMultiCanvas?: (sheets: unknown[]) => Promise<unknown>): Promise<any>;
    /** 把节点树打成 .xmind 的 zip */
    transformToXmind(data: unknown, name: string): Promise<Blob>;
  };
  export default xmind;
}
