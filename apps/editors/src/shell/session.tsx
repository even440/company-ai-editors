/** React 侧的会话：打开会话、提供给子组件、出错和加载中的界面 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { openSession, type HostToEditor, type Session, type SessionOptions } from '@cai/bridge';

const Ctx = createContext<Session | null>(null);
export function useSession(): Session { const s = useContext(Ctx); if (!s) throw new Error('会话还没打开'); return s; }

/** 订阅宿主的消息 */
export function useHost(handler: (m: HostToEditor) => void) {
  const s = useSession(), ref = useRef(handler);
  ref.current = handler;
  useEffect(() => s.onHost((m) => ref.current(m)), [s]);
}

/** 跟着主题变：返回 light | dark */
export function useTheme(): 'light' | 'dark' {
  const s = useSession(), [t, setT] = useState(s.theme);
  useHost((m) => { if (m.type === 'theme') setT(m.theme); });
  return t;
}

export function EditorApp({ options, children }: { options?: SessionOptions; children: (s: Session) => ReactNode }) {
  const [s, setS] = useState<Session | null>(null), [err, setErr] = useState<string | null>(null);
  useEffect(() => { openSession(options).then(setS).catch((e: Error) => setErr(e.message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="ed-state"><div className="ed-err"><b>打不开这份内容</b><p>{err}</p><p className="muted">请从平台里重新打开；如果一直这样，联系管理员。</p></div></div>;
  if (!s) return <div className="ed-state"><span className="spin" role="status" aria-label="加载中" /></div>;
  return <Ctx.Provider value={s}>{children(s)}</Ctx.Provider>;
}

export function mount(render: (s: Session) => ReactNode, options?: SessionOptions) {
  createRoot(document.getElementById('app')!).render(<EditorApp options={options}>{render}</EditorApp>);
}
