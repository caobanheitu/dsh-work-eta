// Verification for the Work ETA bundle: Host fold math, the continuous
// countdown (freeze regression), Client rendering, and a replay of this
// session's own log.
import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
// This file lives in <bundle>/test/, so the bundle root is one level up.
const bundle = path.resolve(here, '..')
const failures = []
function check(label, condition, detail) {
  if (condition) console.log('  ok   ' + label)
  else {
    failures.push(label + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)))
    console.log('  FAIL ' + label + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)))
  }
}

// ---------------------------------------------------------------- Host fold
const { workEtaProjection } = await import(pathToFileURL(path.join(bundle, 'index.js')).href)
const def = workEtaProjection
let state = def.init({ createdAt: 1_000_000, id: 'synthetic', version: 4, isSeeded: false }, 0)
const feed = (type, time, data) => { state = def.apply(state, { type, seq: 0, time, data }) }
const view = () => def.wire.view(state)

console.log('Host fold — synthetic turn with a plan')
feed('turn/start', 1_000_000, { turn: 1 })
feed('todo/write', 1_010_000, { todos: [
  { content: 'A', status: 'in_progress' },
  { content: 'B', status: 'pending' },
  { content: 'C', status: 'pending' },
] })
let v = view()
check('plan written: 3 items, A active', v.total === 3 && v.active === 1 && v.pending === 2, v)
check('running with a measured elapsed', v.running === true && v.elapsedMs === 10_000, v)
// No measurements yet => assumption of 60s/item, total budget = 3 * 60s = 180s.
check('budget priced from the assumption', v.budgetMs === 180_000, v.budgetMs)
check('plan elapsed starts at the first write', v.planElapsedMs === 0, v.planElapsedMs)
check('not all done', v.allDone === false)

// A stream of unrelated events advances the clock but must NOT change the
// budget: the Client subtracts elapsed time itself, so the reading decreases.
feed('tool/call', 1_030_000, { turn: 1, step: 2, callId: 'c1', name: 'bash', arguments: '{}' })
feed('assistant/message', 1_060_000, { turn: 1, step: 2, message: {}, stream: [] })
feed('tool/result', 1_090_000, { turn: 1, step: 2, message: { source: { callId: 'c1' } } })
v = view()
check('unrelated events keep the budget frozen', v.budgetMs === 180_000, v.budgetMs)
check('unrelated events advance plan elapsed', v.planElapsedMs === 80_000, v.planElapsedMs)
check('continuous: budget - elapsed is 100s', v.budgetMs - v.planElapsedMs === 100_000, { b: v.budgetMs, e: v.planElapsedMs })

feed('todo/write', 1_100_000, { todos: [
  { content: 'A', status: 'completed' },
  { content: 'B', status: 'in_progress' },
  { content: 'C', status: 'pending' },
] })
v = view()
check('A measured at 90s', v.itemSamples === 1 && v.itemAvgMs === 90_000, { samples: v.itemSamples, avg: v.itemAvgMs })
// Budget = A observed (90s) + B (90s) + C (90s) = 270s.
check('budget includes the observed completed item', v.budgetMs === 270_000, v.budgetMs)
check('B starts its own clock', v.items[1].status === 'in_progress')
check('completion counted once', v.done === 1 && v.active === 1 && v.total === 3, v)

feed('todo/write', 1_190_000, { todos: [
  { content: 'A', status: 'completed' },
  { content: 'B', status: 'completed' },
  { content: 'C', status: 'in_progress' },
] })
v = view()
check('two samples, average stays 90s', v.itemSamples === 2 && v.itemAvgMs === 90_000, { samples: v.itemSamples, avg: v.itemAvgMs })
check('completion counted once', v.done === 2 && v.active === 1 && v.total === 3, v)
// Budget = A (90s) + B (90s) + C (90s average) = 270s.
check('budget stays the priced total', v.budgetMs === 270_000, v.budgetMs)

// A no-op rewrite (identical list) must not re-measure anything.
feed('todo/write', 1_200_000, { todos: [
  { content: 'A', status: 'completed' },
  { content: 'B', status: 'completed' },
  { content: 'C', status: 'in_progress' },
] })
v = view()
check('no double sample on rewrite', v.itemSamples === 2, v.itemSamples)
check('rewrite leaves the budget unchanged', v.budgetMs === 270_000, v.budgetMs)

// An item born completed teaches the average nothing.
feed('todo/write', 1_205_000, { todos: [
  { content: 'A', status: 'completed' }, { content: 'B', status: 'completed' },
  { content: 'C', status: 'in_progress' }, { content: 'D', status: 'completed' },
] })
v = view()
check('a born-completed item adds no sample', v.itemSamples === 2 && v.itemAvgMs === 90_000, { samples: v.itemSamples, avg: v.itemAvgMs })
check('born-completed item counts as done', v.done === 3 && v.total === 4, v)

feed('todo/write', 1_250_000, { todos: [
  { content: 'A', status: 'completed' }, { content: 'B', status: 'completed' },
  { content: 'C', status: 'completed' }, { content: 'D', status: 'completed' },
] })
v = view()
check('exhausted plan is allDone', v.allDone === true && v.done === 4, { allDone: v.allDone, done: v.done })
check('exhausted plan leaves only the tail window', v.budgetMs - v.planElapsedMs === 8_000, { b: v.budgetMs, e: v.planElapsedMs })

feed('turn/end', 1_260_000, { turn: 1, reason: { kind: 'completed' } })
v = view()
check('turn end closes the reading', v.running === false && v.turnSamples === 1, v)
check('turn measured at 260s', v.turnAvgMs === 260_000, v.turnAvgMs)

console.log('Host fold — next turn has a history budget but no plan')
feed('turn/start', 1_300_000, { turn: 2 })
v = view()
check('new turn starts with no plan', v.total === 0 && v.running === true, v)
check('history average becomes the budget', v.budgetMs === 260_000, v.budgetMs)
check('plan elapsed falls back to turn elapsed', v.planElapsedMs === 0, v.planElapsedMs)
check('turn history survives', v.turnAvgMs === 260_000 && v.turnSamples === 1, v.turnAvgMs)

const again = def.wire.view(state)
check('view memo returns the same reference', again === v)

// ------------------------------------------------------------------ Client
console.log('Client half — loading the browser module')
const source = fs.readFileSync(path.join(bundle, 'client.js'), 'utf8')
let captured
let styleTag = null
let clockNow = 1_000_000_000_000
const fakeDate = { now: () => clockNow }
const fakeDocument = {
  createElement: () => ({ dataset: {}, textContent: '', removed: false, remove() { this.removed = true } }),
  head: { append(node) { styleTag = node } },
  querySelector: () => null,
}
new Function('window', 'document', 'Date', source)(
  { __ModuleLoader__: { load: (definition) => { captured = definition } } }, fakeDocument, fakeDate,
)
check('module registers under the package name', captured && captured.id === 'dsh-work-eta', captured && captured.id)

const EN = {
  'eta.left': '~{time} left', 'eta.elapsed': '{time} elapsed', 'eta.tail': 'Wrapping up',
  'eta.over': '{time} over estimate', 'eta.est': 'est.',
  'eta.minutes': '{minutes}m', 'eta.seconds': '{seconds}s', 'eta.minutesSeconds': '{minutes}m {seconds}s',
  'eta.tip.plan': 'Estimated from the current plan: {done} of {total} done, about {avg} each, {samples} items measured',
  'eta.tip.planRough': 'Estimated from the current plan: {done} of {total} done, assuming {avg} each, {samples} items measured',
  'eta.tip.history': 'No plan in this turn; based on {turns} finished turns averaging {avg}',
  'eta.tip.tail': 'Every plan item is done; waiting for this turn to wrap up',
  'eta.tip.over': 'This turn has run past the estimate with {remaining} items unfinished; the prediction is only a guide',
  'eta.tip.overHistory': 'This turn has run past the historical average; the prediction is only a guide',
  'eta.tip.unknown': 'Not enough history yet, so only elapsed time is shown',
  'eta.tip.truncated': 'Plan too large to estimate reliably; showing elapsed time only',
  'eta.tip.active': 'Working on: {item}', 'eta.tip.done': '{done} done',
  'eta.disclaimer': 'An estimate, not a promise',
}
const translate = (key, params) => {
  const template = EN[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
}

/** React mock whose hooks persist across renders of one mounted component. */
function createReact() {
  let hooks = []
  let idx = 0
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const i = idx++
      if (!Object.prototype.hasOwnProperty.call(hooks, i)) hooks[i] = initial
      return [hooks[i], (value) => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value }]
    },
    useRef(initial) {
      const i = idx++
      if (!Object.prototype.hasOwnProperty.call(hooks, i)) hooks[i] = { current: initial }
      return hooks[i]
    },
    useEffect() {},
  }
  return { react, beginRender: () => { idx = 0 } }
}
const flat = (node, out) => {
  if (node === null || node === undefined) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const child of node) flat(child, out); return out }
  if (node.children) for (const child of node.children) flat(child, out)
  return out
}
const describe = (element) => {
  if (element === null) return { element, text: '', title: '', tag: '', kind: '', confidence: '', fills: [] }
  const parts = []
  flat(element, parts)
  const fills = []
  const collect = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const child of node) collect(child); return }
    if (node.props && node.props.style && node.props.style.width) fills.push(node.props.style.width)
    if (node.children) for (const child of node.children) collect(child)
  }
  collect(element)
  return {
    element, text: parts.join(' '), title: element.props.title || '',
    tag: parts.includes('est.') ? 'est.' : '',
    kind: element.props['data-work-eta-kind'] || '',
    confidence: element.props['data-work-eta-confidence'] || '', fills,
  }
}
function loadComponent(reactImpl) {
  let component = null
  let registered = null
  const module = captured.factory((name) => {
    if (name === 'react') return reactImpl
    throw new Error('unexpected require: ' + name)
  })
  module.apply({
    get: (name) => name === 'locale' ? {
      register: (ns, locale, dict) => { return () => {} }, bind: () => translate, subscribe: () => () => {},
    } : undefined,
    effect: (callback) => callback(),
    slots: { inject: (slot, callback) => callback(), register: (options, fn) => { registered = options; component = fn; return () => {} } },
  })
  return { component, registered }
}
const stateless = createReact()
const { component: statelessComponent, registered } = loadComponent(stateless.react)
const renderFresh = (value) => {
  stateless.beginRender()
  return describe(statelessComponent({ useProjection: (key) => key === 'workEta' ? value : undefined, sessionId: 's1' }))
}

console.log('Client half — classification and copy')
check('dock slot entry registered', registered && registered.name === 'conversation.composer.dock' && registered.id === 'work-eta' && registered.order === 6, registered)
check('styles inserted once', styleTag !== null && styleTag.textContent.includes('.we-root'), styleTag !== null)

const planView = {
  running: true,
  elapsedMs: 60_000,
  planElapsedMs: 60_000,
  budgetMs: 180_000,
  allDone: false,
  truncated: false,
  items: [
    { content: 'A', status: 'completed' },
    { content: 'B', status: 'completed' },
    { content: 'C', status: 'in_progress' },
  ],
  done: 2, active: 1, pending: 0, total: 3,
  itemAvgMs: 60_000, itemSamples: 2, turnAvgMs: 0, turnSamples: 0,
  defaults: { itemMs: 60_000 },
}
clockNow = 1_000_000_000_000
let r = renderFresh(planView)
check('plan view shows a measured reading', r.text.includes('~2m left'), r.text)
check('measured plan has no estimate tag', r.tag === '', r.tag)
check('plan view kind', r.kind === 'plan' && r.confidence === 'measured', { kind: r.kind, confidence: r.confidence })
check('tooltip names the active item and disclaimer', r.title.includes('Working on: C') && r.title.includes('An estimate'), r.title)
check('progress bar has a fill width', r.fills.length === 1 && /%$/.test(r.fills[0]), r.fills)

r = renderFresh({ ...planView, itemSamples: 1 })
check('assumption-backed reading shows the estimate tag', r.tag === 'est.' && r.confidence === 'rough', { tag: r.tag, confidence: r.confidence })
check('rough tooltip says assuming', r.title.includes('assuming'), r.title)

r = renderFresh({
  ...planView, budgetMs: 200_000, planElapsedMs: 10_000, elapsedMs: 10_000,
  items: [], done: 0, active: 0, pending: 0, total: 0, allDone: false,
  itemAvgMs: 0, itemSamples: 0, turnAvgMs: 200_000, turnSamples: 2,
})
check('history view uses the turn-average budget', r.text.includes('~3m 10s left'), r.text)
check('history view kind', r.kind === 'history', r.kind)
check('history view has no plan fraction', !r.text.includes('2/3'), r.text)

r = renderFresh({
  ...planView, budgetMs: 0, planElapsedMs: 30_000, elapsedMs: 30_000,
  items: [], done: 0, active: 0, pending: 0, total: 0, allDone: false,
  itemAvgMs: 0, itemSamples: 0, turnAvgMs: 0, turnSamples: 0,
})
check('unknown view shows elapsed, not a guess', r.text.includes('elapsed'), r.text)
check('unknown view has no fraction', !r.text.includes('/'), r.text)

r = renderFresh({ ...planView, allDone: true })
check('finished plan says wrapping up', r.kind === 'tail' && r.text.includes('Wrapping up'), { kind: r.kind, text: r.text })

r = renderFresh({ ...planView, running: false })
check('idle turn renders nothing', r.element === null)

r = renderFresh(undefined)
check('missing projection renders nothing', r.element === null)

r = renderFresh({ ...planView, defaults: undefined })
check('value without defaults still renders', r.text.includes('left'), r.text)

r = renderFresh({ ...planView, truncated: true, budgetMs: 0 })
check('truncated plan downgrades to elapsed', r.kind === 'unknown' && r.title.includes('too large'), { kind: r.kind, title: r.title })

r = renderFresh({ ...planView, budgetMs: 100_000, planElapsedMs: 150_000, elapsedMs: 150_000 })
check('overrun is stated honestly', r.kind === 'over' && r.text.includes('over estimate'), { kind: r.kind, text: r.text })
check('overrun tooltip names unfinished items', r.title.includes('1 items unfinished'), r.title)

r = renderFresh({
  ...planView, budgetMs: 100_000, planElapsedMs: 150_000, elapsedMs: 150_000,
  items: [], done: 0, active: 0, pending: 0, total: 0, allDone: false,
  itemAvgMs: 0, itemSamples: 0, turnAvgMs: 100_000, turnSamples: 2,
})
check('history overrun uses the average-based copy', r.kind === 'over' && r.title.includes('historical average'), { kind: r.kind, title: r.title })

console.log('Client half — mounted countdown continuity (the freeze regression)')
const mounted = createReact()
const { component: mountedComponent } = loadComponent(mounted.react)
const renderMounted = (value) => {
  mounted.beginRender()
  return describe(mountedComponent({ useProjection: (key) => key === 'workEta' ? value : undefined, sessionId: 's1' }))
}
const T0 = 2_000_000_000_000
const live = (planElapsed, elapsed) => ({
  ...planView, planElapsedMs: planElapsed, elapsedMs: elapsed,
})
clockNow = T0
r = renderMounted(live(60_000, 60_000))
check('anchored at 2m', r.text.includes('~2m left'), r.text)
const fill0 = r.fills[0]

// A tool event 30s later delivers a NEW view object whose planElapsedMs grew
// by exactly those 30s. The Client resets its sinceMs to zero; the sum stays
// continuous, so the reading must NOT restart at 2m.
clockNow = T0 + 30_000
r = renderMounted(live(90_000, 90_000))
check('tool event does NOT restart the countdown', r.text.includes('~1m 30s left'), r.text)
check('progress fill advances', r.fills[0] !== fill0, { before: fill0, after: r.fills[0] })

clockNow = T0 + 60_000
const viewAt60 = live(120_000, 120_000)
r = renderMounted(viewAt60)
check('countdown keeps decreasing', r.text.includes('~1m left'), r.text)

// 30s pass with NO new event: useProjection keeps returning the SAME view
// reference, so the anchor is not reset and the local timer alone ticks down.
clockNow = T0 + 90_000
r = renderMounted(viewAt60)
check('local timer ticks between events', r.text.includes('~30s left'), r.text)

clockNow = T0 + 120_000
r = renderMounted(live(150_000, 150_000))
check('near the end it shows seconds', /\d+s left/.test(r.text) || /over estimate/.test(r.text), r.text)

clockNow = T0 + 130_000
r = renderMounted(live(180_000, 180_000))
check('past the estimate it says over, not a frozen 8s', r.kind === 'over' && r.text.includes('over estimate'), { kind: r.kind, text: r.text })

// ------------------------------------------------------- This session's log
console.log('Replay — this session log')
const logFile = process.argv[2]
if (!logFile || !fs.existsSync(logFile)) {
  console.log('  skip  no log file supplied')
} else {
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const raw = fs.readFileSync(logFile)
  const starts = []
  let at = raw.indexOf(MAGIC, 0)
  while (at !== -1) { starts.push(at); at = raw.indexOf(MAGIC, at + 4) }
  let text = ''
  for (let i = 0; i < starts.length; i++) {
    const to = i + 1 < starts.length ? starts[i + 1] : raw.length
    try { text += zlib.zstdDecompressSync(raw.subarray(starts[i], to)).toString('utf8') } catch { /* partial tail */ }
  }
  const rows = text.split('\n').filter(Boolean).map(line => JSON.parse(line))
  let replay = def.init(rows[0], 0)
  let writes = 0
  let turns = 0
  for (const row of rows.slice(1)) {
    if (row.type === 'todo/write') writes += 1
    if (row.type === 'turn/start') turns += 1
    replay = def.apply(replay, row)
  }
  const replayed = def.wire.view(replay)
  console.log('  log: turns=' + turns + ' todo/writes=' + writes + ' events=' + (rows.length - 1))
  console.log('  view: ' + JSON.stringify({
    running: replayed.running, elapsedMs: replayed.elapsedMs,
    planElapsedMs: replayed.planElapsedMs, budgetMs: replayed.budgetMs,
    done: replayed.done, active: replayed.active, pending: replayed.pending,
    itemAvgMs: replayed.itemAvgMs, itemSamples: replayed.itemSamples,
    turnAvgMs: replayed.turnAvgMs, turnSamples: replayed.turnSamples,
  }))
  if (replayed.items.length) console.log('  items: ' + replayed.items.map(i => i.content.slice(0, 16) + ':' + i.status).join(' | '))
  check('replay produced a coherent view', typeof replayed.running === 'boolean' && replayed.done >= 0 && replayed.total >= replayed.done, replayed)
  check('budget is non-negative', replayed.budgetMs >= 0, replayed.budgetMs)
  if (replayed.running) {
    clockNow = 1_000_000_000_000
    const live = renderFresh(replayed)
    console.log('  rendered: ' + live.text + '  [' + live.kind + '/' + live.confidence + ']  [title: ' + live.title.replace(/\n/g, ' / ') + ']')
    check('running replay renders a reading', live.element !== null && live.text.length > 0, live.text)
  }
}

console.log('')
if (failures.length === 0) console.log('ALL CHECKS PASSED')
else {
  console.log('FAILURES: ' + failures.length)
  for (const failure of failures) console.log(' - ' + failure)
  process.exitCode = 1
}
