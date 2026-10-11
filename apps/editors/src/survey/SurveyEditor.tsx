/**
 * 问卷编辑器：编辑 / 预览填写 / 数据统计 / 设置四个页签；mode=fill 时只有填写页。
 * 题目和设置在 content 里（变了就 markDirty），答卷和收集状态走宿主接口。
 */
import { useEffect, useRef, useState } from 'react';
import type { Session, SurveyResponse } from '@cai/bridge';
import { useHost } from '../shell/session';
import { Toaster, cx, toast } from '../shell/ui';
import { EditTab } from './EditTab';
import { FillTab } from './FillTab';
import { SetTab } from './SetTab';
import { StatsTab } from './StatsTab';
import { exportXlsx } from './export';
import { GEN_QUESTIONS, dueOver, normalize, plainOf, type Answers, type SurveyContent } from './model';
import './survey.css';

type Tab = 'edit' | 'fill' | 'stats' | 'set';
const TABS: [Tab, string][] = [['edit', '编辑'], ['fill', '预览填写'], ['stats', '数据统计'], ['set', '设置']];
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function SurveyEditor({ session: s }: { session: Session }) {
  const fill = s.mode === 'fill';
  const [c, setC] = useState<SurveyContent>(() => normalize(s.doc.content));
  const cRef = useRef(c);
  const [tab, setTab] = useState<Tab>('edit');
  const [ro, setRo] = useState(s.readonly);
  const [title, setTitle] = useState(s.doc.title);
  const [collecting, setCollecting] = useState(!!s.doc.collecting);
  const [responded, setResponded] = useState(s.doc.responded ?? 0);
  const [responses, setResponses] = useState<SurveyResponse[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  /** 改题目或设置：复制一份改，再保存 */
  const update = (fn: (c: SurveyContent) => void) => {
    if (ro) return;
    const next = structuredClone(cRef.current);
    fn(next);
    cRef.current = next;
    setC(next);
    s.markDirty(() => ({ content: cRef.current, plain: plainOf(cRef.current) }));
  };

  const load = async () => {
    setLoading(true);
    try { setResponses((await s.client.responses()).responses); } catch (e) { toast('读取答卷失败：' + errMsg(e)); } finally { setLoading(false); }
  };
  // 打开时先取一次（页签上显示答卷数），进统计页签时再刷新；填写页用不着
  useEffect(() => { if (!fill) void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'stats') void load(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (answers: Answers): Promise<boolean> => {
    if (!collecting) { toast('问卷还没发布，到「设置」里发布后才能收集'); return false; }
    try {
      await s.client.respond(answers);
      setResponded((n) => n + 1);
      toast('已提交');
      if (!fill) { setTab('stats'); }
      return true;
    } catch (e) { toast('提交失败：' + errMsg(e)); return false; }
  };
  const collect = async (on: boolean) => {
    setBusy(true);
    try { const r = await s.client.collecting(on); setCollecting(r.collecting); toast(r.collecting ? '已发布，可以把填写链接发出去了' : '已停止收集'); }
    catch (e) { toast('操作失败：' + errMsg(e)); }
    finally { setBusy(false); }
  };
  const doExport = async () => {
    try {
      let list = responses;
      if (!list) { list = (await s.client.responses()).responses; setResponses(list); }
      await exportXlsx(title, cRef.current, list, (b, n) => s.download(b, n));
    } catch (e) { toast('导出失败：' + errMsg(e)); }
  };

  useHost((m) => {
    if (m.type === 'export') { if (m.format === 'xlsx') void doExport(); else toast('不支持导出为 ' + m.format); }
    else if (m.type === 'command' && m.name === 'gen') { if (ro) return; update((c) => { c.qs.push(...GEN_QUESTIONS()); }); setTab('edit'); toast('已追加 3 道常用题：满意度评分、改进方面、其他建议'); }
    else if (m.type === 'readonly') { s.doc.readonly = m.value; setRo(s.readonly); }
    else if (m.type === 'title') setTitle(m.title);
  });

  const blocked = fill && !collecting ? '这份问卷还没发布或已停止收集。'
    : c.set.once && responded > 0 ? '你已经填过这份问卷了，每人只能填一次。'
    : dueOver(c.set.due) ? `问卷已于 ${c.set.due} 截止。` : null;
  const fillView = <FillTab title={title} c={c} collecting={collecting} blocked={blocked} fillMode={fill} onSubmit={submit} />;
  // 换页签时回到顶上（内容区的滚动位置是共用的）
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { body.current?.scrollTo(0, 0); }, [tab]);

  if (fill) return <div className="ed"><div className="ed-body"><div className="sv"><div className="sv-body">{fillView}</div></div></div><Toaster /></div>;
  return <div className="ed">
    <div className="ed-body" ref={body}>
      <div className="sv">
        {/* 答卷只给能编辑问卷的人看（宿主的接口也这么限制），只读时不显示「数据统计」 */}
        <div className="tabs" role="tablist">{TABS.filter(([k]) => !(ro && k === 'stats')).map(([k, l]) => <button key={k} type="button" role="tab" className={cx('tab', tab === k && 'on')} aria-selected={tab === k} onClick={() => setTab(k)}>{l}{k === 'stats' && responses ? <span className="count">{responses.length}</span> : null}</button>)}</div>
        <div className="sv-body">
          {tab === 'edit' ? <EditTab c={c} ro={ro} update={update} />
            : tab === 'fill' ? fillView
            : tab === 'stats' ? <StatsTab c={c} responses={responses} loading={loading} collecting={collecting} onRefresh={() => void load()} onExport={() => void doExport()} />
            : <SetTab c={c} ro={ro} collecting={collecting} busy={busy} update={update} onCollect={(on) => void collect(on)} onShare={() => s.send({ type: 'request', what: 'share' })} />}
        </div>
      </div>
    </div>
    <Toaster />
  </div>;
}
