/** 设置页签：收集状态（发布 / 停止、填写链接）和填写规则（每人一次、匿名、截止日期） */
import { Field, Icon, Toggle, cx } from '../shell/ui';
import type { SurveyContent } from './model';

interface Props { c: SurveyContent; ro: boolean; collecting: boolean; busy: boolean; update: (fn: (c: SurveyContent) => void) => void; onCollect: (on: boolean) => void; onShare: () => void }

export function SetTab({ c, ro, collecting, busy, update, onCollect, onShare }: Props) {
  return <div className="sv-set">
    <section className="card">
      <div className="card-h"><h2>收集状态</h2><span className={cx('chip', collecting ? 'good' : 'warn')}>{collecting ? '收集中' : '未发布'}</span></div>
      <div className="card-b">
        <div className="row">
          {collecting
            ? <button type="button" className="btn" disabled={ro || busy} onClick={() => onCollect(false)}>停止收集</button>
            : <button type="button" className="btn primary" disabled={ro || busy} onClick={() => onCollect(true)}>发布并开始收集</button>}
          <button type="button" className="btn" onClick={onShare}><Icon name="link" />复制填写链接</button>
        </div>
        <p className="fine">填写链接对公司内的人有效；收到的答卷记在这份问卷里，发起人和可编辑的人能看统计。{ro ? '你只有查看权限，不能改收集状态。' : ''}</p>
      </div>
    </section>
    <section className="card">
      <div className="card-h"><h2>填写规则</h2></div>
      {/* 只读时整组禁用 */}
      <fieldset className="card-b sv-rules" disabled={ro}>
        <Toggle checked={c.set.once} onChange={(v) => update((c) => { c.set.once = v; })} label="每人只能填一次" />
        <Toggle checked={c.set.anon} onChange={(v) => update((c) => { c.set.anon = v; })} label="匿名收集（统计和导出里不显示填写人）" />
        <Field label="截止日期" htmlFor="sv-due" hint="到期后不再接受新答卷；留空表示不限">
          <input id="sv-due" className="input" type="date" value={c.set.due} onChange={(e) => update((c) => { c.set.due = e.target.value; })} />
        </Field>
      </fieldset>
    </section>
  </div>;
}
