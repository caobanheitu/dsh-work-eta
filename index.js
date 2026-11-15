/**
 * Work ETA — Host half.
 *
 * Folds the durable session log into a client-visible `workEta` projection.
 * The Client turns two numbers into a live countdown:
 *
 *   budgetMs       — estimated TOTAL duration of the current work
 *   planElapsedMs  — time already spent on it, measured at the last event
 *
 * remaining = max(budgetMs - planElapsedMs - clientWallTimeSinceView, 0)
 *
 * Because `planElapsedMs` grows by the same wall time the Client adds itself,
 * a new view from ANY event (tool call, assistant message, ...) is continuous:
 * the reading counts down instead of freezing or restarting. The estimate is
 * only revised on `turn/start` and `todo/write`.
 *
 * Every figure is a duration measured from session-event timestamps; no
 * absolute Host timestamp is compared with the browser's clock.
 *
 * @module dsh-work-eta
 */

/** Bumped whenever the fold's fields or their meaning change (persisted-cache gate). */
const STATE_VERSION = 3

/** Per-item cost assumed before this session finished a measurable plan item, ms. */
const DEFAULT_ITEM_MS = 60_000
/** Brief wrap-up window after every plan item is complete, ms. */
const TAIL_MS = 8_000
/** One measured item shorter than this is treated as noise, ms. */
const ITEM_SAMPLE_MIN_MS = 3_000
/** One measured item longer than this is an idle tab, not work, ms. */
const ITEM_SAMPLE_MAX_MS = 20 * 60_000
/** One measured turn shorter than this cannot carry a plan, ms. */
const TURN_SAMPLE_MIN_MS = 5_000
/** One measured turn longer than this is an outlier, ms. */
const TURN_SAMPLE_MAX_MS = 2 * 60 * 60_000
/** Cap on how many past samples still sway the running average. */
const SAMPLE_MEMORY = 4
/** Upper bound on items carried to the Client (a pathological plan stays bounded). */
const MAX_VIEW_ITEMS = 200

/** Clamp a measurement so one outlier cannot poison the running average. */
function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

/** Blend one sample into a running average that trusts early samples more. */
function blend(average, count, sample) {
  if (count <= 0) return sample
  const weight = Math.min(count + 1, SAMPLE_MEMORY)
  return average + (sample - average) / weight
}

/**
 * Merge one `todo/write` snapshot into the plan, keeping the per-item timing
 * the model never states. Items are matched by their text (unique by contract).
 * An item born `completed` teaches the average nothing rather than "zero time".
 */
function foldPlan(state, todos, at) {
  const previous = state.plan
  const planStart = previous === null ? at : previous.startedAt
  const before = new Map()
  if (previous !== null) for (const item of previous.items) before.set(item.content, item)

  let itemAvgMs = state.itemAvgMs
  let itemSamples = state.itemSamples
  const items = []
  for (const todo of todos) {
    const content = todo.content
    const status = todo.status
    const known = before.get(content)
    let startedAt = known === undefined ? 0 : known.startedAt
    let completedAt = known === undefined ? 0 : known.completedAt

    if (status === 'completed') {
      if (completedAt === 0) {
        completedAt = at
        if (startedAt > 0) {
          itemAvgMs = blend(itemAvgMs, itemSamples, clamp(completedAt - startedAt, ITEM_SAMPLE_MIN_MS, ITEM_SAMPLE_MAX_MS))
          itemSamples += 1
        }
      }
      items.push({ content, status: 'completed', startedAt, completedAt })
    } else if (status === 'in_progress') {
      if (startedAt === 0) startedAt = at
      items.push({ content, status: 'in_progress', startedAt, completedAt: 0 })
    } else {
      items.push({ content, status: 'pending', startedAt: 0, completedAt: 0 })
    }
  }
  return { plan: { startedAt: planStart, items }, itemAvgMs, itemSamples }
}

/**
 * Estimated TOTAL plan duration: a completed item costs its observed duration
 * (or one average item when it was born completed); every unfinished item costs
 * one average item. The Client subtracts all elapsed time, so no item needs a
 * "spent" discount here — that is exactly what makes the countdown continuous.
 */
function priceTotal(plan, itemMs) {
  if (plan === null) return 0
  let total = 0
  for (const item of plan.items) {
    if (item.status === 'completed' && item.startedAt > 0 && item.completedAt > item.startedAt) {
      total += item.completedAt - item.startedAt
    } else {
      total += itemMs
    }
  }
  return Math.round(total)
}

/** Build the value the Client renders from. Pure and cheap: one bounded pass. */
function buildView(state) {
  const at = state.lastEventAt
  const items = []
  let done = 0
  let active = 0
  let pending = 0
  let truncated = false
  let allDone = false
  if (state.plan !== null) {
    allDone = state.plan.items.length > 0
    for (const item of state.plan.items) {
      if (item.status === 'completed') done += 1
      else {
        allDone = false
        if (item.status === 'in_progress') active += 1
        else pending += 1
      }
      if (items.length < MAX_VIEW_ITEMS) {
        items.push({ content: item.content, status: item.status })
      } else {
        truncated = true
      }
    }
  }
  const turnElapsedMs = state.openTurn === null ? 0 : Math.max(0, at - state.openTurn.start)
  const planElapsedMs = state.plan === null
    ? turnElapsedMs
    : Math.max(0, at - state.plan.startedAt)
  const itemMs = state.itemSamples > 0 ? state.itemAvgMs : DEFAULT_ITEM_MS

  let budgetMs
  if (truncated) {
    budgetMs = 0
  } else if (state.plan !== null && state.plan.items.length > 0) {
    // A finished plan leaves only a brief wrap-up window.
    budgetMs = allDone ? planElapsedMs + TAIL_MS : priceTotal(state.plan, itemMs)
  } else {
    // No plan: the session's finished-turn average is the only basis.
    budgetMs = state.turnSamples > 0 ? Math.round(state.turnAvgMs) : 0
  }

  return {
    running: state.openTurn !== null,
    elapsedMs: turnElapsedMs,
    planElapsedMs,
    budgetMs,
    items,
    truncated,
    allDone,
    done,
    active,
    pending,
    total: done + active + pending,
    itemAvgMs: state.itemSamples > 0 ? Math.round(state.itemAvgMs) : 0,
    itemSamples: state.itemSamples,
    turnAvgMs: state.turnSamples > 0 ? Math.round(state.turnAvgMs) : 0,
    turnSamples: state.turnSamples,
    defaults: { itemMs: DEFAULT_ITEM_MS },
  }
}

/**
 * The projection registry only calls `.parse(value)` on `stateSchema` and
 * `viewSchema` (persisted checkpoint rows and the outbound value). The fold
 * produces plain JSON it authored itself, so the identity schema keeps that
 * contract and leaves the view's object identity intact for the change feed.
 */
const identitySchema = { parse: value => value }

/** The `workEta` unit: whole-log fold of turns, plan writes, and item timing. */
export const workEtaProjection = (() => {
  // View memo: repeat reads of the same folded state must return the same
  // reference, otherwise every projection read would publish a "change".
  let cachedState = null
  let cachedView = null

  return {
    key: 'workEta',
    stateVersion: STATE_VERSION,
    stateSchema: identitySchema,
    init: header => ({
      plan: null,
      openTurn: null,
      itemAvgMs: 0,
      itemSamples: 0,
      turnAvgMs: 0,
      turnSamples: 0,
      lastEventAt: typeof header?.createdAt === 'number' ? header.createdAt : 0,
    }),
    apply: (state, event) => {
      const time = event.time
      // Every event advances the clock that `planElapsedMs` is measured from.
      const advance = patch => ({ ...state, ...patch, lastEventAt: time })
      switch (event.type) {
        case 'turn/start':
          // A new turn starts without a plan; the previous plan described
          // finished work, not the work ahead.
          return advance({
            openTurn: { turn: event.data.turn, start: time },
            plan: null,
          })
        case 'turn/end': {
          const open = state.openTurn
          if (open === null || open.turn !== event.data.turn) return advance({})
          const sample = clamp(time - open.start, TURN_SAMPLE_MIN_MS, TURN_SAMPLE_MAX_MS)
          return advance({
            openTurn: null,
            turnAvgMs: blend(state.turnAvgMs, state.turnSamples, sample),
            turnSamples: state.turnSamples + 1,
          })
        }
        case 'todo/write':
          return advance(foldPlan(state, event.data.todos, time))
        default:
          return advance({})
      }
    },
    wire: {
      viewSchema: identitySchema,
      view: state => {
        if (state === cachedState && cachedView !== null) return cachedView
        cachedState = state
        cachedView = buildView(state)
        return cachedView
      },
      // Summary rows list many sessions; this value is only useful live.
      summary: false,
    },
  }
})()

/** Cordis plugin name. */
export const name = 'work-eta'

/** Without the projection registry the fiber stays pending instead of throwing. */
export const inject = ['sessionProjections']

/** Register the `workEta` unit; unloading the plugin removes the key. */
export async function apply(ctx) {
  await ctx.sessionProjections.register(workEtaProjection)
}
