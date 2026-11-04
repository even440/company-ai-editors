/** 数据统计页签：答卷数等几个数字，每道题一张卡片（选择题横条分布、评分平均和分布、填空列表） */
import type { SurveyResponse } from '@cai/bridge';
import { Icon, cx } from '../shell/ui';
import { T } from './i18n';
import { QT, answersOf, fmtAnswer, fmtShort, hasOpts, isToday, type SurveyContent } from './model';

interface Props { c: SurveyContent; responses: SurveyResponse[] | null; loading: boolean; collecting: boolean; onRefresh: () => void; onExport: () => void }

const Tile = ({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) => <div className="tile"><div className="tile-l">{label}</div><div className="tile-v">{value}</div>{sub ? <div className="tile-s">{sub}</div> : null}</div>;

function Bars({ rows, max }: { rows: [string, number][]; max: number }) {
  return <div className="hbars">{rows.map(([l, n]) => <div className="hbar" key={l}><span className="hbar-l">{l}</span><span className="hbar-t" title={T.barTitle(l, n)}><i style={{ width: ((n / Math.max(1, max)) * 100).toFixed(1) + '%' }} /></span><span className="hbar-v">{T.people(n)}</span></div>)}</div>;
}

export function StatsTab({ c, responses, loading, collecting, onRefresh, onExport }: Props) {
  const list = responses ?? [], n = list.length;
  const last = n ? list.reduce((a, b) => (a.at > b.at ? a : b)) : null;
  return <div className="sv-stats">
    <div className="tiles six">
      <Tile label={T.total} value={responses ? n : '…'} />
      <Tile label={T.today} value={responses ? list.filter((r) => isToday(r.at)).length : '…'} />
      <Tile label={T.last} value={last ? fmtShort(last.at) : '—'} sub={last && !c.set.anon ? last.userName : undefined} />
      <Tile label={T.status} value={<span className={cx('chip', collecting ? 'good' : 'warn')}>{collecting ? T.collecting : T.unpublished}</span>} />
    </div>
    {c.qs.map((q, i) => {
      const vals = answersOf(q, list);
      let body: React.ReactNode;
      if (hasOpts(q.type)) {
        const cnt: Record<string, number> = {};
        for (const v of vals) for (const x of Array.isArray(v) ? v : [v]) cnt[x] = (cnt[x] ?? 0) + 1;
        body = <Bars rows={(q.opts ?? []).map((o) => [o, cnt[o] ?? 0])} max={n} />;
      } else if (q.type === 'rate') {
        const nums = vals.map(Number).filter((x) => !isNaN(x));
        const avg = nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : '—';
        body = <><p>{T.avgPre}<b>{avg}</b>{T.avgPost}</p><Bars rows={[5, 4, 3, 2, 1].map((k) => [T.stars(k), nums.filter((x) => x === k).length])} max={n} /></>;
      } else if (!vals.length) body = <p className="muted">{T.noAnswer}</p>;
      else body = <><ul className="sv-texts">{vals.slice(0, 6).map((v, k) => <li key={k}>{fmtAnswer(v)}</li>)}</ul>{vals.length > 6 ? <p className="muted">{T.more(vals.length - 6)}</p> : null}</>;
      return <section className="card" key={q.id}><div className="card-h"><h2>{i + 1}. {q.t}</h2><span className="muted">{QT[q.type]} · {T.answered(vals.length)}</span></div><div className="card-b">{body}</div></section>;
    })}
    <div className="row">
      <button type="button" className="btn" onClick={onExport} disabled={!n}><Icon name="download" />{T.exportBtn}</button>
      <button type="button" className="btn" onClick={onRefresh} disabled={loading}>{loading ? T.reading : T.refresh}</button>
      {responses && !n ? <span className="muted">{collecting ? T.noneYet : T.afterPublish}</span> : null}
    </div>
  </div>;
}
