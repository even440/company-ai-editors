/** 编辑页签：说明、题目列表（题型、选项、必答、上下移动、复制、删除）、添加各题型 */
import { Icon, Select, TT, Toggle, cx, toast } from '../shell/ui';
import { Editable } from './Editable';
import { T } from './i18n';
import { QT, QTYPES, defaultOpts, hasOpts, newQuestion, qid, type QType, type SurveyContent } from './model';

interface Props { c: SurveyContent; ro: boolean; update: (fn: (c: SurveyContent) => void) => void }

export function EditTab({ c, ro, update }: Props) {
  const move = (i: number, d: -1 | 1) => update((c) => { const j = i + d; if (j < 0 || j >= c.qs.length) return; [c.qs[i], c.qs[j]] = [c.qs[j], c.qs[i]]; });
  const dup = (i: number) => update((c) => { const copy = structuredClone(c.qs[i]); copy.id = qid(); c.qs.splice(i + 1, 0, copy); });
  const del = (i: number) => { if (c.qs.length <= 1) { toast(T.keepOneQ); return; } update((c) => { c.qs.splice(i, 1); }); };
  const setType = (i: number, t: QType) => update((c) => { const q = c.qs[i]; q.type = t; if (hasOpts(t)) { if (!q.opts?.length) q.opts = defaultOpts(); } else delete q.opts; });
  const delOpt = (i: number, j: number) => { if ((c.qs[i].opts?.length ?? 0) <= 2) { toast(T.keepTwoOpts); return; } update((c) => { c.qs[i].opts!.splice(j, 1); }); };
  const addOpt = (i: number) => update((c) => { const o = c.qs[i].opts!; o.push(T.opt(o.length + 1)); });

  return <div className="sv-edit">
    <div className="sv-desc"><span className="muted">{T.desc}</span><Editable tag="div" className="sv-desc-t" label={T.descLabel} ph={T.descPh} value={c.desc} disabled={ro} onChange={(v) => update((c) => { c.desc = v; })} /></div>
    {c.qs.map((q, i) => <div className="sv-q" key={q.id} data-q={q.id}>
      <div className="sv-qh">
        <span className="sv-n">{i + 1}</span>
        <Editable tag="b" label={T.qLabel(i + 1)} ph={T.qPh} value={q.t} disabled={ro} onChange={(v) => update((c) => { c.qs[i].t = v; })} />
        {q.req ? <i className="sv-req" title={T.req}>*</i> : null}
        {ro ? <span className="chip">{QT[q.type]}</span> : <Select aria-label={T.qType} value={q.type} onChange={(t) => setType(i, t as QType)} options={QTYPES.map((k) => [k, QT[k]])} />}
      </div>
      {hasOpts(q.type) ? <div className="sv-opts">
        {(q.opts ?? []).map((o, j) => <div className="sv-opt" key={j}>
          <i className={cx(q.type === 'multi' && 'sq')} aria-hidden="true" />
          <Editable label={T.opt(j + 1)} ph={T.optPh} value={o} disabled={ro} onChange={(v) => update((c) => { c.qs[i].opts![j] = v; })} />
          {ro ? null : <button type="button" className="btn ghost sm icon-only" aria-label={T.delOpt} onClick={() => delOpt(i, j)}><Icon name="x" /></button>}
        </div>)}
        {ro ? null : <button type="button" className="btn ghost sm sv-opt-add" onClick={() => addOpt(i)}><Icon name="plus" />{T.addOpt}</button>}
      </div>
        : q.type === 'rate' ? <div className="sv-stars" aria-hidden="true">{[1, 2, 3, 4, 5].map((k) => <span key={k}>★</span>)}<span className="muted">{T.rateHint}</span></div>
        : q.type === 'date' ? <div className="sv-ph">{T.datePh}</div>
        : <div className="sv-ph">{T.textPh}</div>}
      {ro ? null : <div className="sv-qf">
        <Toggle checked={q.req} onChange={(v) => update((c) => { c.qs[i].req = v; })} label={T.req} />
        <span className="spacer" />
        <button type="button" className="btn ghost sm icon-only" aria-label={T.up} title={T.up} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" /></button>
        <button type="button" className="btn ghost sm icon-only" aria-label={T.down} title={T.down} disabled={i === c.qs.length - 1} onClick={() => move(i, 1)}><Icon name="down" /></button>
        <button type="button" className="btn ghost sm icon-only" aria-label={T.dup} title={T.dup} onClick={() => dup(i)}><Icon name="copy" /></button>
        <button type="button" className="btn ghost sm icon-only" aria-label={T.del} title={T.del} onClick={() => del(i)}><Icon name="trash" /></button>
      </div>}
    </div>)}
    {ro ? null : <div className="sv-add"><span className="muted">{T.addQ}</span>{QTYPES.map((k) => <TT key={k} icon="plus" label={QT[k]} onClick={() => update((c) => { c.qs.push(newQuestion(k)); })} />)}</div>}
  </div>;
}
