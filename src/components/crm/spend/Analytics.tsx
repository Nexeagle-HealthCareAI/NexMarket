'use client';

import { AlertTriangle, ArrowRight, CheckCircle2, Info, TrendingDown, TrendingUp } from 'lucide-react';
import { Empty } from '@/components/crm/ui';
import { dayText, monthText, NATURE, rs, rsShort, type Data, type Kind, type Note } from './shared';

const TONE_ICON = { bad: AlertTriangle, warn: AlertTriangle, info: Info, ok: CheckCircle2 } as const;

/** Constant against variable as one bar, with the two amounts named beside it. */
function Split({ constant, variable, label }: { constant: number; variable: number; label: string }) {
  const total = constant + variable;
  const c = total ? (constant / total) * 100 : 0;
  return (
    <div className="ma-split">
      <div className="ma-split-bar" role="img" aria-label={`${label}: constant ${rs(constant)}, variable ${rs(variable)}`}>
        {total === 0 ? <span className="ma-split-empty" /> : <>
          {constant > 0 && <span style={{ width: `${c}%`, background: NATURE.constant.color }} />}
          {variable > 0 && <span style={{ width: `${100 - c}%`, background: NATURE.variable.color }} />}
        </>}
      </div>
      <div className="ma-split-legend">
        <span><i style={{ background: NATURE.constant.color }} aria-hidden />Constant <strong>{rs(constant)}</strong>{total > 0 && <em>{Math.round(c)}%</em>}</span>
        <span><i style={{ background: NATURE.variable.color }} aria-hidden />Variable <strong>{rs(variable)}</strong>{total > 0 && <em>{100 - Math.round(c)}%</em>}</span>
      </div>
    </div>
  );
}

/** Spending each day, constant under variable, as small columns. */
function Trend({ data }: { data: Data }) {
  // Every day in the range, oldest first (days without spending show as gaps).
  const byDay = new Map(data.days.map((d) => [d.date, d]));
  const list: { date: string; constant: number; variable: number }[] = [];
  for (let d = new Date(`${data.from}T00:00:00Z`); d <= new Date(`${data.to}T00:00:00Z`) && list.length < 370; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10);
    const x = byDay.get(k);
    list.push({ date: k, constant: x?.constant ?? 0, variable: x?.variable ?? 0 });
  }
  const top = Math.max(1, ...list.map((d) => d.constant + d.variable));
  if (list.length <= 1) return null;
  const every = Math.ceil(list.length / 8);
  return (
    <div className="ma-trend-wrap">
      <div className="ma-trend" role="img" aria-label={`Spending each day from ${dayText(data.from)} to ${dayText(data.to)}; highest ${rs(top)} in a day`}>
        {list.map((d) => (
          <div key={d.date} className="ma-col" title={`${dayText(d.date, true)}: ${rs(d.constant + d.variable)} (constant ${rs(d.constant)}, variable ${rs(d.variable)})`}>
            <span className="ma-col-v" style={{ height: `${(d.variable / top) * 100}%`, background: NATURE.variable.color }} />
            <span className="ma-col-c" style={{ height: `${(d.constant / top) * 100}%`, background: NATURE.constant.color }} />
          </div>
        ))}
      </div>
      <div className="ma-trend-x" aria-hidden>
        {list.map((d, i) => <span key={d.date}>{i % every === 0 ? dayText(d.date) : ''}</span>)}
      </div>
      <p className="crm-sub ma-trend-top">Highest day: {rs(top)}</p>
    </div>
  );
}

function KindBars({ kinds, data, nature }: { kinds: Kind[]; data: Data; nature: 'constant' | 'variable' }) {
  const list = kinds.filter((k) => k.nature === nature).map((k) => ({ k, v: data.byCategory[k.key] ?? 0 })).filter((x) => x.v > 0 || !x.k.archived).sort((a, b) => b.v - a.v);
  const sum = list.reduce((s, x) => s + x.v, 0);
  const top = Math.max(1, ...list.map((x) => x.v));
  return (
    <div className="ma-kinds">
      <h3 className="ma-h3"><i style={{ background: NATURE[nature].color }} aria-hidden />{NATURE[nature].label} costs <span>{rs(sum)}</span></h3>
      {list.length === 0 ? <p className="crm-sub" style={{ margin: 0 }}>No {nature} kinds yet.</p> : (
        <ul className="ms-cats">
          {list.map(({ k, v }) => (
            <li key={k.key}>
              <span className="ms-cat-name"><i style={{ background: k.color }} aria-hidden />{k.label}</span>
              <span className="ms-cat-bar" aria-hidden><i style={{ width: `${(v / top) * 100}%`, background: k.color }} /></span>
              <span className="ms-cat-amt">{v ? rs(v) : <span className="crm-sub">—</span>}</span>
              <span className="ms-cat-pct">{data.total && v ? `${Math.round((v / data.total) * 100)}%` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Analytics: what needs attention first, then the totals (constant and variable, funds in, against the days before),
 * this month's commitments, spending by project, where the money went, and the day-by-day detail.
 */
export function Analytics({ data, go, openProject, openPerson }: { data: Data; go: (tab: string) => void; openProject: (id: string) => void; openPerson: (id: string) => void }) {
  const kinds = data.categories;
  const change = data.prevTotal > 0 ? Math.round(((data.total - data.prevTotal) / data.prevTotal) * 100) : null;
  const net = data.fundsIn - data.total;
  const nDays = data.days.length;
  const c = data.commitments;
  const shownKinds = kinds.filter((k) => !k.archived || data.byCategory[k.key]);

  const noteRow = (n: Note, i: number) => {
    const Icon = TONE_ICON[n.tone];
    return (
      <li key={i} className={`ma-note is-${n.tone}`}>
        <Icon size={18} aria-hidden />
        <div><strong>{n.title}</strong><span>{n.body}</span></div>
        {n.go && <button type="button" className="wa-link ma-note-go" onClick={() => go(n.go!)}>Open <ArrowRight size={13} aria-hidden /></button>}
      </li>
    );
  };

  return (
    <div className="ma">
      <section className="crm-card ma-notes" aria-labelledby="ma-notes-h">
        <h2 id="ma-notes-h" className="crm-h2" style={{ margin: 0 }}>Things to note</h2>
        <ul>{data.notes.map(noteRow)}</ul>
      </section>

      <div className="ma-kpis">
        <div className="crm-card ma-kpi is-main">
          <span className="ma-kpi-l">Spent in these days</span>
          <strong className="ma-kpi-v">{rs(data.total)}</strong>
          {change != null ? (
            <span className={`ma-kpi-ch ${change > 0 ? 'is-up' : change < 0 ? 'is-down' : ''}`}>
              {change > 0 ? <TrendingUp size={14} aria-hidden /> : change < 0 ? <TrendingDown size={14} aria-hidden /> : null}
              {change === 0 ? 'Same as' : `${Math.abs(change)}% ${change > 0 ? 'more than' : 'less than'}`} the {dayText(data.prevFrom)}–{dayText(data.prevTo)} before ({rs(data.prevTotal)})
            </span>
          ) : <span className="crm-sub">{nDays ? `${rs(Math.round(data.total / nDays))} a day on ${nDays} days with spending` : 'Nothing spent yet'}</span>}
        </div>
        <div className="crm-card ma-kpi"><span className="ma-kpi-l"><i style={{ background: NATURE.constant.color }} aria-hidden />Constant</span><strong className="ma-kpi-v">{rs(data.constant)}</strong><span className="crm-sub">Salaries, rent and other fixed costs</span></div>
        <div className="crm-card ma-kpi"><span className="ma-kpi-l"><i style={{ background: NATURE.variable.color }} aria-hidden />Variable</span><strong className="ma-kpi-v">{rs(data.variable)}</strong><span className="crm-sub">Changes with the work</span></div>
        <div className="crm-card ma-kpi"><span className="ma-kpi-l">Funds received</span><strong className="ma-kpi-v">{rs(data.fundsIn)}</strong><span className="crm-sub">{data.funds.length} {data.funds.length === 1 ? 'entry' : 'entries'} in these days</span></div>
        <div className="crm-card ma-kpi"><span className="ma-kpi-l">Received less spent</span><strong className={`ma-kpi-v ${net < 0 ? 'is-bad' : 'is-ok'}`}>{net < 0 ? '−' : ''}{rs(Math.abs(net))}</strong><span className="crm-sub">{net < 0 ? 'More went out than came in' : 'More came in than went out'}</span></div>
      </div>

      <div className="ma-two">
        <section className="crm-card ma-card" aria-labelledby="ma-cv-h">
          <h2 id="ma-cv-h" className="crm-h2">Constant and variable</h2>
          <Split constant={data.constant} variable={data.variable} label="These days" />
          <h3 className="ma-h3">{monthText(c.month)}: what is committed</h3>
          <dl className="ma-commit">
            <div><dt>Salaries</dt><dd><strong>{rs(c.salaryDue)}</strong><span>{rs(c.salaryPaid)} paid · {c.salaryLeft ? <b className="is-warn">{rs(c.salaryLeft)} left</b> : 'nothing left'}</span></dd></div>
            <div><dt>Constant payments</dt><dd><strong>{rs(c.constantDue)}</strong><span>{rs(c.constantPaid)} paid · {c.constantLeft ? <b className="is-warn">{rs(c.constantLeft)} left</b> : 'nothing left'}</span></dd></div>
            {c.salaryLeftEarlier > 0 && <div><dt>Salaries from earlier months</dt><dd><strong className="is-bad">{rs(c.salaryLeftEarlier)}</strong><span><button type="button" className="wa-link" onClick={() => go('team')}>See who</button></span></dd></div>}
            {c.overdueCount > 0 && <div><dt>Overdue constant payments</dt><dd><strong className="is-bad">{rs(c.overdueSum)}</strong><span>{c.overdueCount} {c.overdueCount === 1 ? 'payment' : 'payments'}</span></dd></div>}
          </dl>
          {c.upcoming.length > 0 && <>
            <h3 className="ma-h3">Due soon</h3>
            <ul className="ma-due">
              {c.upcoming.map((u) => (
                <li key={`${u.id}${u.period}`}>
                  <span className={`ma-due-d${u.late ? ' is-late' : ''}`}>{u.late ? 'Late' : dayText(u.dueOn)}</span>
                  <span className="ma-due-t">{u.title} <em>{monthText(u.period, true)}</em></span>
                  <strong>{rs(u.left)}</strong>
                </li>
              ))}
            </ul>
            <button type="button" className="wa-link" onClick={() => go('constant')}>All constant payments <ArrowRight size={13} aria-hidden /></button>
          </>}
        </section>

        <section className="crm-card ma-card" aria-labelledby="ma-proj-h">
          <h2 id="ma-proj-h" className="crm-h2">By project</h2>
          {data.byProject.length === 0 ? <Empty title="Nothing spent in these days" /> : (
            <ul className="ma-proj">
              {data.byProject.map((p) => {
                const used = p.usedPct ?? null;
                return (
                  <li key={p.projectId ?? 'none'}>
                    <div className="ma-proj-top">
                      <i style={{ background: p.color }} aria-hidden />
                      {p.projectId ? <button type="button" className="wa-link" onClick={() => openProject(p.projectId!)}>{p.name}</button> : <span className="crm-sub">{p.name}</span>}
                      {p.status === 'closed' && <span className="crm-sub">· closed</span>}
                      <strong>{rs(p.total)}</strong>
                    </div>
                    <div className="ma-proj-cv" role="img" aria-label={`Constant ${rs(p.constant)}, variable ${rs(p.variable)}`}>
                      {p.constant > 0 && <span style={{ flex: p.constant, background: NATURE.constant.color }} />}
                      {p.variable > 0 && <span style={{ flex: p.variable, background: NATURE.variable.color }} />}
                    </div>
                    {p.projectId && (p.budget != null ? (
                      <div className="ma-proj-budget">
                        <span className={`ma-meter${used != null && used >= 100 ? ' is-bad' : used != null && used >= 85 ? ' is-warn' : ''}`} role="img" aria-label={`${used ?? 0}% of the budget used`}>
                          <span style={{ width: `${Math.min(100, used ?? 0)}%` }} />
                        </span>
                        <span className="crm-sub">{used ?? 0}% of {rs(p.budget)} used{p.left != null ? (p.left < 0 ? ` · ${rs(-p.left)} over` : ` · ${rs(p.left)} left`) : ''}</span>
                      </div>
                    ) : <span className="crm-sub">No budget set · {rs(p.receivedAllTime ?? 0)} received, {rs(p.spentAllTime ?? 0)} spent in all</span>)}
                  </li>
                );
              })}
            </ul>
          )}
          <button type="button" className="wa-link" onClick={() => go('projects')}>All projects <ArrowRight size={13} aria-hidden /></button>
        </section>
      </div>

      <section className="crm-card ma-card" aria-labelledby="ma-trend-h">
        <div className="ma-card-h">
          <h2 id="ma-trend-h" className="crm-h2">Day by day</h2>
          <span className="ma-legend"><span><i style={{ background: NATURE.constant.color }} aria-hidden />Constant</span><span><i style={{ background: NATURE.variable.color }} aria-hidden />Variable</span></span>
        </div>
        {data.total === 0 ? <p className="crm-sub" style={{ margin: 0 }}>No spending in these days.</p> : <Trend data={data} />}
      </section>

      <section className="crm-card ma-card" aria-labelledby="ma-where-h">
        <h2 id="ma-where-h" className="crm-h2">Where it went</h2>
        <div className="ma-two is-tight">
          <KindBars kinds={kinds} data={data} nature="constant" />
          <KindBars kinds={kinds} data={data} nature="variable" />
        </div>
      </section>

      <details className="crm-card ma-details">
        <summary>By person · {data.byPerson.length}</summary>
        {data.byPerson.length === 0 ? <p className="crm-sub">Nothing is tagged to a person in these days.</p> : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead><tr><th scope="col">Person</th>{shownKinds.map((k) => <th key={k.key} scope="col" className="wb-num">{k.label}</th>)}<th scope="col" className="wb-num">Total</th></tr></thead>
              <tbody>
                {data.byPerson.map((p) => (
                  <tr key={p.agentId}>
                    <td><button type="button" className="wa-link" onClick={() => openPerson(p.agentId)}>{p.name}</button></td>
                    {shownKinds.map((k) => <td key={k.key} className="wb-num">{p.byCategory[k.key] ? rs(p.byCategory[k.key]) : <span className="crm-sub">—</span>}</td>)}
                    <td className="wb-num"><strong>{rs(p.total)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>

      <details className="crm-card ma-details">
        <summary>Every day in a table · {nDays} {nDays === 1 ? 'day' : 'days'}</summary>
        {nDays === 0 ? <p className="crm-sub">No spending in these days.</p> : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead><tr><th scope="col">Day</th><th scope="col" className="wb-num">Constant</th><th scope="col" className="wb-num">Variable</th>{shownKinds.map((k) => <th key={k.key} scope="col" className="wb-num">{k.label}</th>)}<th scope="col" className="wb-num">Total</th></tr></thead>
              <tbody>
                {data.days.map((d) => (
                  <tr key={d.date}>
                    <th scope="row" className="ms-day">{dayText(d.date, true)}</th>
                    <td className="wb-num">{d.constant ? rsShort(d.constant) : <span className="crm-sub">—</span>}</td>
                    <td className="wb-num">{d.variable ? rsShort(d.variable) : <span className="crm-sub">—</span>}</td>
                    {shownKinds.map((k) => <td key={k.key} className="wb-num">{d.byCategory[k.key] ? rs(d.byCategory[k.key]) : <span className="crm-sub">—</span>}</td>)}
                    <td className="wb-num"><strong>{rs(d.total)}</strong></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><th scope="row">All</th><td className="wb-num"><strong>{rs(data.constant)}</strong></td><td className="wb-num"><strong>{rs(data.variable)}</strong></td>{shownKinds.map((k) => <td key={k.key} className="wb-num"><strong>{rs(data.byCategory[k.key] ?? 0)}</strong></td>)}<td className="wb-num"><strong>{rs(data.total)}</strong></td></tr></tfoot>
            </table>
          </div>
        )}
      </details>
    </div>
  );
}
