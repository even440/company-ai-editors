/** 设置页签：收集状态（发布 / 停止、填写链接）和填写规则（每人一次、匿名、截止日期） */
import { Field, Icon, Toggle, cx } from '../shell/ui';
import { T } from './i18n';
import type { SurveyContent } from './model';

interface Props { c: SurveyContent; ro: boolean; collecting: boolean; busy: boolean; update: (fn: (c: SurveyContent) => void) => void; onCollect: (on: boolean) => void; onShare: () => void }

export function SetTab({ c, ro, collecting, busy, update, onCollect, onShare }: Props) {
  return <div className="sv-set">
    <section className="card">
      <div className="card-h"><h2>{T.collectState}</h2><span className={cx('chip', collecting ? 'good' : 'warn')}>{collecting ? T.collecting : T.unpublished}</span></div>
      <div className="card-b">
        <div className="row">
          {collecting
            ? <button type="button" className="btn" disabled={ro || busy} onClick={() => onCollect(false)}>{T.stop}</button>
            : <button type="button" className="btn primary" disabled={ro || busy} onClick={() => onCollect(true)}>{T.publish}</button>}
          <button type="button" className="btn" onClick={onShare}><Icon name="link" />{T.copyLink}</button>
        </div>
        <p className="fine">{T.linkNote}{ro ? T.roNote : ''}</p>
      </div>
    </section>
    <section className="card">
      <div className="card-h"><h2>{T.rules}</h2></div>
      {/* 只读时整组禁用 */}
      <fieldset className="card-b sv-rules" disabled={ro}>
        <Toggle checked={c.set.once} onChange={(v) => update((c) => { c.set.once = v; })} label={T.once} />
        <Toggle checked={c.set.anon} onChange={(v) => update((c) => { c.set.anon = v; })} label={T.anon} />
        <Field label={T.due} htmlFor="sv-due" hint={T.dueHint}>
          <input id="sv-due" className="input" type="date" value={c.set.due} onChange={(e) => update((c) => { c.set.due = e.target.value; })} />
        </Field>
      </fieldset>
    </section>
  </div>;
}
