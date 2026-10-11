/** 编辑页签：说明、题目列表（题型、选项、必答、上下移动、复制、删除）、添加各题型 */
import { Icon, Select, TT, Toggle, cx, toast } from '../shell/ui';
import { Editable } from './Editable';
import { QT, QTYPES, hasOpts, newQuestion, qid, type QType, type SurveyContent } from './model';

interface Props { c: SurveyContent; ro: boolean; update: (fn: (c: SurveyContent) => void) => void }

export function EditTab({ c, ro, update }: Props) {
  const move = (i: number, d: -1 | 1) => update((c) => { const j = i + d; if (j < 0 || j >= c.qs.length) return; [c.qs[i], c.qs[j]] = [c.qs[j], c.qs[i]]; });
  const dup = (i: number) => update((c) => { const copy = structuredClone(c.qs[i]); copy.id = qid(); c.qs.splice(i + 1, 0, copy); });
  const del = (i: number) => { if (c.qs.length <= 1) { toast('至少保留一个问题'); return; } update((c) => { c.qs.splice(i, 1); }); };
  const setType = (i: number, t: QType) => update((c) => { const q = c.qs[i]; q.type = t; if (hasOpts(t)) { if (!q.opts?.length) q.opts = ['选项 1', '选项 2']; } else delete q.opts; });
  const delOpt = (i: number, j: number) => { if ((c.qs[i].opts?.length ?? 0) <= 2) { toast('至少两个选项'); return; } update((c) => { c.qs[i].opts!.splice(j, 1); }); };
  const addOpt = (i: number) => update((c) => { const o = c.qs[i].opts!; o.push('选项 ' + (o.length + 1)); });

  return <div className="sv-edit">
    <div className="sv-desc"><span className="muted">说明</span><Editable tag="div" className="sv-desc-t" label="问卷说明" value={c.desc} disabled={ro} onChange={(v) => update((c) => { c.desc = v; })} /></div>
    {c.qs.map((q, i) => <div className="sv-q" key={q.id} data-q={q.id}>
      <div className="sv-qh">
        <span className="sv-n">{i + 1}</span>
        <Editable tag="b" label={`第 ${i + 1} 题标题`} value={q.t} disabled={ro} onChange={(v) => update((c) => { c.qs[i].t = v; })} />
        {q.req ? <i className="sv-req" title="必答">*</i> : null}
        {ro ? <span className="chip">{QT[q.type]}</span> : <Select aria-label="题型" value={q.type} onChange={(t) => setType(i, t as QType)} options={QTYPES.map((k) => [k, QT[k]])} />}
      </div>
      {hasOpts(q.type) ? <div className="sv-opts">
        {(q.opts ?? []).map((o, j) => <div className="sv-opt" key={j}>
          <i className={cx(q.type === 'multi' && 'sq')} aria-hidden="true" />
          <Editable label={`选项 ${j + 1}`} value={o} disabled={ro} onChange={(v) => update((c) => { c.qs[i].opts![j] = v; })} />
          {ro ? null : <button type="button" className="btn ghost sm icon-only" aria-label="删除选项" onClick={() => delOpt(i, j)}><Icon name="x" /></button>}
        </div>)}
        {ro ? null : <button type="button" className="btn ghost sm sv-opt-add" onClick={() => addOpt(i)}><Icon name="plus" />添加选项</button>}
      </div>
        : q.type === 'rate' ? <div className="sv-stars" aria-hidden="true">{[1, 2, 3, 4, 5].map((k) => <span key={k}>★</span>)}<span className="muted">1 到 5 分</span></div>
        : q.type === 'date' ? <div className="sv-ph">填写者选择一个日期</div>
        : <div className="sv-ph">填写者在这里输入文字</div>}
      {ro ? null : <div className="sv-qf">
        <Toggle checked={q.req} onChange={(v) => update((c) => { c.qs[i].req = v; })} label="必答" />
        <span className="spacer" />
        <button type="button" className="btn ghost sm icon-only" aria-label="上移" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" /></button>
        <button type="button" className="btn ghost sm icon-only" aria-label="下移" disabled={i === c.qs.length - 1} onClick={() => move(i, 1)}><Icon name="down" /></button>
        <button type="button" className="btn ghost sm icon-only" aria-label="复制" onClick={() => dup(i)}><Icon name="copy" /></button>
        <button type="button" className="btn ghost sm icon-only" aria-label="删除" onClick={() => del(i)}><Icon name="trash" /></button>
      </div>}
    </div>)}
    {ro ? null : <div className="sv-add"><span className="muted">添加问题</span>{QTYPES.map((k) => <TT key={k} icon="plus" label={QT[k]} onClick={() => update((c) => { c.qs.push(newQuestion(k)); })} />)}</div>}
  </div>;
}
