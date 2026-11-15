// DSH browser half of Work ETA.
//
// Not native ESM: the page loads this through window.__ModuleLoader__.load, the
// id must equal the bare package name, and the factory returns { inject, apply }.
// Components use React.createElement (no JSX transform here).
//
// The Host publishes an estimated TOTAL budget (`budgetMs`) and the time the
// plan has already spent (`planElapsedMs`), both measured from session-event
// timestamps. This half adds the wall time since that value arrived:
//
//   remaining = budgetMs - planElapsedMs - sinceMs
//
// `planElapsedMs` grows by the same wall time that `sinceMs` carries, so a new
// view from ANY event (tool call, assistant message, ...) is continuous: the
// reading counts down instead of freezing or restarting. When the estimate is
// exceeded it says so honestly instead of pretending the work is nearly done.
;(() => {
const PKG = 'dsh-work-eta'

const SLOT = 'conversation.composer.dock'
const SLOT_ID = 'work-eta'
/** After the shipped activity (0) and usage/cost (1, 5) readings. */
const SLOT_ORDER = 6

/** Per-item cost when the Host supplies no default, ms. */
const FALLBACK_ITEM_MS = 60_000
/** Once the countdown reaches this (without all items done), call it over-estimate. */
const TAIL_MS = 8_000

const CSS = `
.we-root{display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;max-width:100%;color:var(--dsw-alias-label-tertiary);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);font-variant-numeric:tabular-nums;line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap}
.we-glyph{width:14px;height:14px;flex:none;color:var(--dsw-alias-label-tertiary)}
.we-main{min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary)}
.we-est{flex:none;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary));font-size:.9em}
.we-bar{display:block;width:32px;height:4px;flex:none;border-radius:99px;overflow:hidden;background:var(--dsw-alias-border-l1)}
.we-fill{display:block;height:100%;border-radius:99px;background:var(--dsw-alias-label-primary);transition:width .35s ease}
.we-count{color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary));font-variant-numeric:tabular-nums}
@media (prefers-reduced-motion: reduce){.we-fill{transition:none}}
`

const ZH = {
  'eta.left': '剩 ~{time}',
  'eta.elapsed': '已用 {time}',
  'eta.tail': '收尾中',
  'eta.over': '已超预估 {time}',
  'eta.est': '估',
  'eta.minutes': '{minutes} 分',
  'eta.seconds': '{seconds} 秒',
  'eta.minutesSeconds': '{minutes} 分 {seconds} 秒',
  'eta.tip.plan': '按当前计划估算：{total} 项已完成 {done} 项，每项实测约 {avg}，已实测 {samples} 项',
  'eta.tip.planRough': '按当前计划估算：{total} 项已完成 {done} 项，暂按每项 {avg} 假设，已实测 {samples} 项',
  'eta.tip.history': '本回合没有计划，按本会话已完成的 {turns} 个回合平均 {avg} 估算',
  'eta.tip.tail': '计划已全部完成，等这一回合收尾',
  'eta.tip.over': '当前用时已超出预估，仍有 {remaining} 项未完成；预测仅供参考',
  'eta.tip.overHistory': '当前回合用时已超出历史平均；预测仅供参考',
  'eta.tip.unknown': '还没有可用的历史数据，只显示已用时间',
  'eta.tip.truncated': '计划条目过多，无法可靠估算，只显示已用时间',
  'eta.tip.active': '正在做：{item}',
  'eta.tip.done': '已完成 {done} 项',
  'eta.disclaimer': '这是预测，不是承诺',
}
const EN = {
  'eta.left': '~{time} left',
  'eta.elapsed': '{time} elapsed',
  'eta.tail': 'Wrapping up',
  'eta.over': '{time} over estimate',
  'eta.est': 'est.',
  'eta.minutes': '{minutes}m',
  'eta.seconds': '{seconds}s',
  'eta.minutesSeconds': '{minutes}m {seconds}s',
  'eta.tip.plan': 'Estimated from the current plan: {done} of {total} done, about {avg} each, {samples} items measured',
  'eta.tip.planRough': 'Estimated from the current plan: {done} of {total} done, assuming {avg} each, {samples} items measured',
  'eta.tip.history': 'No plan in this turn; based on {turns} finished turns averaging {avg}',
  'eta.tip.tail': 'Every plan item is done; waiting for this turn to wrap up',
  'eta.tip.over': 'This turn has run past the estimate with {remaining} items unfinished; the prediction is only a guide',
  'eta.tip.overHistory': 'This turn has run past the historical average; the prediction is only a guide',
  'eta.tip.unknown': 'Not enough history yet, so only elapsed time is shown',
  'eta.tip.truncated': 'Plan too large to estimate reliably; showing elapsed time only',
  'eta.tip.active': 'Working on: {item}',
  'eta.tip.done': '{done} done',
  'eta.disclaimer': 'An estimate, not a promise',
}

/** Compact duration; seconds stay visible below ten minutes so the reading is visibly live. */
function formatSpan(ms, t) {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return t('eta.seconds', { seconds: total })
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes < 10 && seconds > 0) return t('eta.minutesSeconds', { minutes, seconds })
  return t('eta.minutes', { minutes })
}

/**
 * Interpret the budget at one instant.
 * @param view - the `workEta` projection value.
 * @param sinceMs - wall time since this view arrived.
 * @returns { kind, confidence, remainingMs, progressPct }.
 *          kind is plan | history | tail | over | unknown.
 */
function estimate(view, sinceMs) {
  const since = Math.max(0, sinceMs || 0)
  const budget = typeof view.budgetMs === 'number' ? view.budgetMs : 0
  const planElapsed = (typeof view.planElapsedMs === 'number' ? view.planElapsedMs : 0) + since

  if (view.truncated || budget <= 0) {
    return { kind: 'unknown', confidence: 'none', remainingMs: 0, progressPct: 0 }
  }
  if (view.allDone) {
    return { kind: 'tail', confidence: 'measured', remainingMs: 0, progressPct: 100 }
  }

  const remainingMs = budget - planElapsed
  // Progress and the countdown share ONE source: elapsed against the budget.
  const progressPct = Math.max(0, Math.min(100, Math.round((planElapsed / budget) * 100)))
  if (remainingMs <= TAIL_MS) {
    return { kind: 'over', confidence: 'rough', remainingMs, progressPct: 100 }
  }
  const hasPlan = Array.isArray(view.items) && view.items.length > 0
  const samples = hasPlan ? view.itemSamples : view.turnSamples
  return {
    kind: hasPlan ? 'plan' : 'history',
    confidence: samples >= 2 ? 'measured' : 'rough',
    remainingMs,
    progressPct,
  }
}

/** Explain the reading: its basis, sample count, active item, and the disclaimer. */
function explain(view, result, t) {
  const parts = []
  const fallback = view.defaults && view.defaults.itemMs > 0 ? view.defaults.itemMs : FALLBACK_ITEM_MS
  const remainingItems = Math.max(0, (view.total || 0) - (view.done || 0))
  const items = Array.isArray(view.items) ? view.items : []
  const activeItem = items.find(item => item.status === 'in_progress')
  if (view.truncated) {
    parts.push(t('eta.tip.truncated'))
  } else if (result.kind === 'unknown') {
    parts.push(t('eta.tip.unknown'))
  } else if (result.kind === 'tail') {
    parts.push(t('eta.tip.tail'))
    if (view.done > 0) parts.push(t('eta.tip.done', { done: view.done }))
  } else if (result.kind === 'over') {
    if (items.length > 0) {
      parts.push(t('eta.tip.over', { remaining: remainingItems }))
    } else {
      parts.push(t('eta.tip.overHistory'))
    }
    if (activeItem) parts.push(t('eta.tip.active', { item: activeItem.content }))
  } else if (result.kind === 'plan') {
    parts.push(t(result.confidence === 'measured' ? 'eta.tip.plan' : 'eta.tip.planRough', {
      total: view.total,
      done: view.done,
      avg: formatSpan(view.itemAvgMs > 0 ? view.itemAvgMs : fallback, t),
      samples: view.itemSamples || 0,
    }))
    if (activeItem) parts.push(t('eta.tip.active', { item: activeItem.content }))
  } else {
    parts.push(t('eta.tip.history', { turns: view.turnSamples, avg: formatSpan(view.turnAvgMs, t) }))
  }
  parts.push(t('eta.disclaimer'))
  return parts.join('\n')
}

window.__ModuleLoader__.load({
  id: PKG,
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const runtime = { locale: undefined, translate: key => key }

    const readView = (useProjection) => {
      try {
        return useProjection ? useProjection('workEta') : undefined
      } catch {
        // The key exists only while the Host half is active.
        return undefined
      }
    }

    const WorkEtaPill = (props) => {
      const view = readView(props.useProjection)
      const t = runtime.translate
      const locale = runtime.locale
      const [, refreshLocale] = React.useState(0)
      const [, tick] = React.useState(0)
      const running = view !== null && view !== undefined && view.running === true

      React.useEffect(() => {
        if (!locale || typeof locale.subscribe !== 'function') return undefined
        return locale.subscribe(() => refreshLocale(n => n + 1))
      }, [locale])

      // The countdown is live only while a turn runs; an idle session keeps no timer.
      React.useEffect(() => {
        if (!running) return undefined
        const id = setInterval(() => tick(n => (n + 1) % 1000000), 1000)
        return () => clearInterval(id)
      }, [running])

      // Re-anchor on every new view. `planElapsedMs` already includes the wall
      // time of all past events, so resetting `sinceMs` to zero here keeps the
      // sum continuous — no freeze, no jump, at any event boundary.
      const anchor = React.useRef({ view: null, at: 0, elapsedBase: 0 })
      if (anchor.current.view !== view) {
        anchor.current = {
          view,
          at: Date.now(),
          elapsedBase: view && typeof view.elapsedMs === 'number' ? view.elapsedMs : 0,
        }
      }

      if (view === null || view === undefined || !running) return null

      const sinceMs = Math.max(0, Date.now() - anchor.current.at)
      const result = estimate(view, sinceMs)
      const elapsedMs = anchor.current.elapsedBase + sinceMs
      const total = view.total > 0 ? view.total : 0
      const done = view.done > 0 ? view.done : 0

      let reading
      let showEstimateTag = false
      if (result.kind === 'tail') {
        reading = t('eta.tail')
      } else if (result.kind === 'unknown') {
        reading = t('eta.elapsed', { time: formatSpan(elapsedMs, t) })
      } else if (result.kind === 'over') {
        // Honest: the estimate was too optimistic, work is still running.
        // Overrun = plan elapsed + client wall time - the estimated budget.
        reading = t('eta.over', {
          time: formatSpan((view.planElapsedMs || 0) + sinceMs - (view.budgetMs || 0), t),
        })
      } else {
        reading = t('eta.left', { time: formatSpan(result.remainingMs, t) })
        // An assumption-backed reading must be distinguishable without hovering.
        showEstimateTag = result.confidence === 'rough'
      }
      const tip = explain(view, result, t)

      return h('span', {
        className: 'we-root',
        'data-work-eta': '1',
        'data-work-eta-kind': result.kind,
        'data-work-eta-confidence': result.confidence,
        'aria-live': 'off',
        title: tip,
        'aria-label': tip,
      },
      h('svg', {
        className: 'we-glyph', viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false',
      },
      h('circle', { cx: 8, cy: 8, r: 6.2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }),
      h('path', {
        d: 'M8 4.7v3.6l2.4 1.4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      })),
      h('span', { className: 'we-main' }, reading),
      showEstimateTag ? h('span', { className: 'we-est' }, t('eta.est')) : null,
      total > 0 && result.kind !== 'unknown'
        ? h('span', { className: 'we-bar', 'aria-hidden': 'true' },
          h('span', { className: 'we-fill', style: { width: result.progressPct + '%' } }))
        : null,
      total > 0 ? h('span', { className: 'we-count' }, done + '/' + total) : null)
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const locale = ctx.get('locale')
        if (locale) {
          runtime.locale = locale
          runtime.translate = locale.bind(PKG)
          ctx.effect(() => {
            const dropZh = locale.register(PKG, 'zh', ZH)
            const dropEn = locale.register(PKG, 'en', EN)
            return () => {
              dropZh()
              dropEn()
            }
          }, 'work-eta: locale dictionaries')
        }

        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = PKG
          tag.dataset.pluginCss = PKG + '/pill.css'
          tag.textContent = CSS
          document.head.append(tag)
          return () => {
            tag.remove()
          }
        }, 'work-eta: styles')

        // slots.inject waits for the slot to be declared and withdraws this
        // entry when it collapses, so no cleanup of its own is needed here.
        ctx.slots.inject(SLOT, () => ctx.slots.register(
          { name: SLOT, id: SLOT_ID, order: SLOT_ORDER },
          WorkEtaPill,
        ))
      },
    }
  },
})
})()
