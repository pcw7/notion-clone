#!/usr/bin/env node
/**
 * 영향 기반 e2e 고르기 — 바꾼 파일이 닿는 게이트를 찾아 `E2E_ONLY` 를 만든다 (e2e 도구 1조각 · 순수 부분은 `src/lib/testing/e2e-affected.ts`)
 *
 *   npm run e2e:affected                    # main 에서 갈라진 뒤 바꾼 것(커밋 · 작업 트리 · 새 파일) → 게이트 목록 · E2E_ONLY
 *   npm run e2e:affected -- <파일…>         # 그 파일들만(저장소 기준 경로)
 *   npm run e2e:affected -- --run           # 고른 게이트로 곧바로 `npm run e2e`(E2E_BROWSER 같은 환경은 그대로 넘긴다)
 *   npm run e2e:affected -- --base=<ref>    # 기준을 바꾼다(기본은 main 에서 갈라진 곳) — 예: 마지막 전체 판의 커밋 이후 바꾼 것 전부
 *
 * 전체 판(약 1900개 · 30~40분)은 4조각마다 · 트랙 끝에만 돈다(HANDOFF §4). 그 사이 조각마다는 이것으로 고른다 — 조각 이름으로 고르면
 * 바꾼 부품을 함께 쓰는 다른 절을 놓친다. **전역 바꿈**(마이그레이션 · 협업 서버 · 의존성 · 뿌리 레이아웃 · 뿌리 CSS)이 있거나 게이트의
 * 절반 넘게 걸리면 고르는 뜻이 없다 — 전체 판을 권하고, `--run` 이면 거르지 않고 전체를 돌린다.
 *
 * ⚠ 고른 절은 자기 데이터를 스스로 만들어야 홀로 돈다(e2e 머리의 E2E_ONLY 주석). 앞 절에 기대는 절이 걸리면 기대는 절도 함께 켠다.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const { changedLines, gatesAtLines, gatesUsingIds, gatesUsingRoute, isGlobalChange, nearestCarriers, onlyValue, parseGates, staticTestIds } =
  await import('../src/lib/testing/e2e-affected.ts')
const { resolveImport, valueImports, walkSources } = await import('../src/lib/testing/import-graph.ts')

const ROOT = resolve(import.meta.dirname, '..')
const SRC = join(ROOT, 'src')
const APP = join(SRC, 'app')
const E2E = 'scripts/e2e-editor.mjs'
const toRepo = (abs) => relative(ROOT, abs).split(sep).join('/')
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })

const args = process.argv.slice(2)
const run = args.includes('--run')
const baseArg = args.find((a) => a.startsWith('--base='))?.slice('--base='.length)
const explicit = args.filter((a) => !a.startsWith('--')).map((p) => p.replace(/\\/g, '/'))

const base = git('rev-parse', baseArg ?? git('merge-base', 'HEAD', 'main').trim()).trim()
const changed = explicit.length > 0
  ? explicit
  : [...new Set([...git('diff', '--name-only', base).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')])].filter((p) => p !== '')

// ── import 그래프(거꾸로) ──
const sourceOf = new Map()
const importers = new Map()
for (const file of walkSources(SRC)) {
  const source = readFileSync(file, 'utf8')
  sourceOf.set(file, source)
  for (const spec of valueImports(source)) {
    const target = resolveImport(SRC, file, spec)
    if (target === null) continue
    if (!importers.has(target)) importers.set(target, [])
    importers.get(target).push(file)
  }
}
const idsOf = (file) => staticTestIds(sourceOf.get(file) ?? (existsSync(file) && /\.(ts|tsx)$/.test(file) ? readFileSync(file, 'utf8') : ''))
const isRoute = (file) => file.startsWith(APP + sep) && /^(page|route|layout|template|loading|error|not-found)\.(tsx|ts)$/.test(file.split(sep).pop())

// ── 게이트 ──
const e2eSource = readFileSync(join(ROOT, E2E), 'utf8')
const gates = parseGates(e2eSource)
const reasons = new Map()
const report = []
const globals = []
const outsideBrowser = []

for (const path of changed) {
  if (isGlobalChange(path)) {
    globals.push(path)
    continue
  }
  if (path === E2E) {
    const before = reasons.size
    const { outside } = gatesAtLines(e2eSource, gates, changedLines(git('diff', '-U0', base, '--', E2E)), reasons)
    report.push(`${path} → 바뀐 줄을 품은 게이트 ${reasons.size - before}개${outside.length > 0 ? ` · 게이트 밖(공용 도우미) ${outside.length}줄` : ''}`)
    if (outside.length > 0) globals.push(`${E2E} 의 공용 도우미(${outside.slice(0, 3).join(' · ')}번 줄${outside.length > 3 ? ' …' : ''})`)
    continue
  }
  if (!path.startsWith('src/') || /\.test\.ts$/.test(path) || path.startsWith('src/lib/testing/')) {
    outsideBrowser.push(path)
    continue
  }
  const abs = join(ROOT, ...path.split('/'))
  if (!existsSync(abs)) {
    report.push(`${path} → 지워진 파일(그것을 쓰던 쪽이 바뀌었으면 그쪽이 고른다)`)
    continue
  }
  const { carriers, routes } = nearestCarriers([abs], (f) => importers.get(f) ?? [], (f) => idsOf(f).length > 0, isRoute)
  const ids = [...carriers].flatMap(idsOf)
  const hit = new Map()
  gatesUsingIds(e2eSource, gates, ids, hit)
  for (const route of routes) gatesUsingRoute(e2eSource, gates, toRepo(route).slice('src/app/'.length), hit)
  for (const [title, why] of hit) for (const w of why) {
    if (!reasons.has(title)) reasons.set(title, new Set())
    reasons.get(title).add(w)
  }
  const via = [...carriers].filter((f) => f !== abs).map(toRepo)
  report.push(`${path} → testid ${ids.length}개${via.length > 0 ? `(가장 가까운: ${via.slice(0, 4).join(' · ')}${via.length > 4 ? ` 외 ${via.length - 4}` : ''})` : ''} · 주소 ${routes.size}개 → 게이트 ${hit.size}개`)
}

console.log(`기준: ${baseArg === undefined ? 'main 에서 갈라진 곳' : baseArg} ${base.slice(0, 8)} · 바꾼 파일 ${changed.length}개`)
for (const line of report) console.log(`  ${line}`)
if (outsideBrowser.length > 0) console.log(`  브라우저 밖(테스트 · 도구 · 문서) ${outsideBrowser.length}개 — ${outsideBrowser.slice(0, 4).join(' · ')}${outsideBrowser.length > 4 ? ' …' : ''}`)
const ordered = gates.filter((g) => reasons.has(g.title)).map((g) => g.title)
console.log(`\n게이트 ${ordered.length}개 / ${gates.length}`)
for (const title of ordered) {
  const why = [...reasons.get(title)]
  console.log(`  ${title}  ←  ${why.slice(0, 3).join(' · ')}${why.length > 3 ? ` 외 ${why.length - 3}` : ''}`)
}

const full = globals.length > 0 || ordered.length > gates.length / 2
if (globals.length > 0) console.log(`\n⚠ 전역 바꿈 — ${globals.join(' · ')} → 전체 판을 돌린다`)
else if (full) console.log(`\n⚠ 게이트의 절반 넘게 걸렸다 → 전체 판을 돌린다`)
const only = full ? '' : onlyValue(ordered)
if (!full) console.log(ordered.length === 0 ? '\n고를 게이트가 없다 — 브라우저로 볼 것이 없는 바꿈이다' : `\nE2E_ONLY="${only}"`)

if (run && (full || ordered.length > 0)) {
  console.log(full ? '\n전체 판을 돈다' : `\n게이트 ${ordered.length}개를 돈다`)
  const result = spawnSync('npm', ['run', 'e2e'], { cwd: ROOT, stdio: 'inherit', shell: true, env: { ...process.env, E2E_ONLY: only } })
  process.exit(result.status ?? 1)
}
