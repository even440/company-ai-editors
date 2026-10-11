/** 填写表单：预览填写页签和 mode=fill 的填写页都用它。blocked 有值时不能提交（已填过、已截止、没发布） */
import { useState } from 'react';
import { Icon, Select, toast } from '../shell/ui';
import type { Answers, SurveyContent } from './model';

interface Props { title: string; c: SurveyContent; collecting: boolean; blocked: string | null; fillMode: boolean; onSubmit: (a: Answers) => Promise<boolean> }

export function FillTab({ title, c, collecting, blocked, fillMode, onSubmit }: Props) {
  const [answers, setAnswers] = useState<Answers>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = (id: string, v: string | string[]) => setAnswers((a) => ({ ...a, [id]: v }));
  const toggle = (id: string, o: string) => setAnswers((a) => { const cur = Array.isArray(a[id]) ? (a[id] as string[]) : []; return { ...a, [id]: cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o] }; });

  const submit = async () => {
    if (blocked) { toast(blocked); return; }
    for (let i = 0; i < c.qs.length; i++) {
      const q = c.qs[i], v = answers[q.id];
      if (q.req && (v == null || v === '' || (Array.isArray(v) && !v.length))) { toast(`第 ${i + 1} 题是必答题`); document.getElementById('fq-' + q.id)?.scrollIntoView({ block: 'center' }); return; }
    }
    const out: Answers = {};
    for (const q of c.qs) { const v = answers[q.id]; if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) out[q.id] = v; }
    setBusy(true);
    try { if (await onSubmit(out)) { setDone(true); setAnswers({}); } } finally { setBusy(false); }
  };

  if (done) return <div className="sv-fill sv-done" role="status"><Icon name="check" /><h2>已提交</h2><p className="muted">感谢你的填写。</p>{fillMode ? null : <button type="button" className="btn" onClick={() => setDone(false)}>再填一份</button>}</div>;
  const dis = !!blocked;
  return <form className="sv-fill" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
    <h2>{title}</h2>
    {c.desc ? <p className="muted">{c.desc}</p> : null}
    {blocked ? <div className="note warn">{blocked}</div> : !collecting ? <div className="note warn">问卷还没发布，这是预览；发布后才会记录答卷。</div> : null}
    {c.qs.map((q, i) => <div className="sv-fq" key={q.id} id={'fq-' + q.id}>
      <b>{i + 1}. {q.t}{q.req ? <i className="sv-req" title="必答">*</i> : null}</b>
      {q.type === 'single' ? (q.opts ?? []).map((o) => <label className="sv-choice" key={o}><input type="radio" className="check" name={q.id} value={o} checked={answers[q.id] === o} disabled={dis} onChange={() => set(q.id, o)} />{o}</label>)
        : q.type === 'multi' ? (q.opts ?? []).map((o) => <label className="sv-choice" key={o}><input type="checkbox" className="check" name={q.id} value={o} checked={Array.isArray(answers[q.id]) && (answers[q.id] as string[]).includes(o)} disabled={dis} onChange={() => toggle(q.id, o)} />{o}</label>)
        : q.type === 'select' ? <Select aria-label={q.t} value={(answers[q.id] as string) ?? ''} disabled={dis} onChange={(v) => set(q.id, v)} options={[['', '请选择'], ...(q.opts ?? [])]} />
        : q.type === 'rate'
          // DOM 里 5 在前、1 在后，配合 .sv-rate 的 row-reverse 显示成 1…5，选中的星星和它左边的一起点亮
          ? <div className="sv-rate" role="radiogroup" aria-label={q.t}>{[5, 4, 3, 2, 1].map((n) => <label key={n} title={n + ' 分'}><input type="radio" name={q.id} value={n} checked={answers[q.id] === String(n)} disabled={dis} onChange={() => set(q.id, String(n))} /><span>★</span></label>)}</div>
        : q.type === 'date' ? <input className="input" type="date" aria-label={q.t} value={(answers[q.id] as string) ?? ''} disabled={dis} onChange={(e) => set(q.id, e.target.value)} />
        : <textarea className="input" rows={2} placeholder="请输入" aria-label={q.t} value={(answers[q.id] as string) ?? ''} disabled={dis} onChange={(e) => set(q.id, e.target.value)} />}
    </div>)}
    <div><button type="submit" className="btn primary" disabled={dis || busy}>{busy ? '提交中…' : '提交'}</button></div>
  </form>;
}
