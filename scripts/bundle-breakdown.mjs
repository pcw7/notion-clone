#!/usr/bin/env node
/**
 * 경로의 처음 받는 JS 를 모듈 · 패키지로 나눈다 — 번들 줄이기(BD-1)의 측정 도구. `docs/perf/bundle-diet.md` 가 이것으로 쟀다.
 *
 * 준비(순서가 중요하다 — 빌드가 `.next` 를 비운다):
 *   npm run build
 *   npx next experimental-analyze --output     # Next 16 이 싣고 오는 Turbopack 분석기 → .next/diagnostics/analyze
 *
 * 사용:
 *   node scripts/bundle-breakdown.mjs <경로 정규식> [--by=file|pkg|dir] [--top=N]
 *   node scripts/bundle-breakdown.mjs <경로 정규식> --cut="모듈a,모듈b;모듈c"   # 그것을 지연 로드로 옮기면 몇 KB 가 빠지나(묶음마다)
 *   node scripts/bundle-breakdown.mjs <경로 정규식> --why=모듈                   # 그 모듈이 첫 JS 에 들어온 사슬(진입점까지)
 *   예: node scripts/bundle-breakdown.mjs '^/w/\[workspaceId\]/settings/page$' --cut="search-overlay.tsx;settings/mfa-panel"
 *
 * 어떻게 재나 — 처음 받는 파일은 `check-bundle.mjs` 와 같다(`rootMainFiles` ∪ 그 경로의 `entryJSFiles`). 분석기 실행은 빌드와 청크 해시가
 * 다르다(서버 액션 id 같은 것이 달라 파일마다 수십 바이트 차이) — 그래서 이름이 아니라 **크기가 가장 가까운 분석 청크**와 잇는다(한 분석
 * 청크는 한 번만). 파일의 실제 gzip 을 그 분석 청크 안 원본 모듈의 `compressed_size` 비율로 나눈다 — 모듈별 KB 는 어림값이고, 합은 실제와
 * 같다. 지연 로드 절감은 모듈 그래프(동기 의존)에서 후보를 끊고 진입점에서 다시 닿는 것만 남겨 뺀다 — 청크 경계의 덧붙는 몫은 세지 않는다.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { gzipSync } from 'node:zlib'

const ROOT = join(import.meta.dirname, '..')
const NEXT = join(ROOT, '.next')
const [routeArg, ...rest] = process.argv.slice(2)
if (!routeArg) {
  console.error('경로 정규식을 준다 — 예: node scripts/bundle-breakdown.mjs \'^/w/\\[workspaceId\\]/settings/page$\'')
  process.exit(1)
}
const opt = Object.fromEntries(rest.map((a) => a.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)))
const ANALYZE = join(NEXT, 'diagnostics', 'analyze', 'data')
if (!existsSync(join(NEXT, 'build-manifest.json')) || !existsSync(ANALYZE)) {
  console.error('빌드 · 분석 데이터가 없다 — `npm run build` 뒤에 `npx next experimental-analyze --output` 을 돌린다.')
  process.exit(1)
}

// ── 경로의 처음 받는 파일(check-bundle.mjs 와 같다) ──────────────────
const { rootMainFiles } = JSON.parse(readFileSync(join(NEXT, 'build-manifest.json'), 'utf8'))
const APP = join(NEXT, 'server', 'app')
const routeRe = new RegExp(routeArg)
const targets = []
for (const file of readdirSync(APP, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('page_client-reference-manifest.js'))) {
  const sandbox = {}
  vm.runInNewContext(readFileSync(join(APP, file), 'utf8'), sandbox)
  for (const [route, manifest] of Object.entries(sandbox.__RSC_MANIFEST ?? {})) {
    if (routeRe.test(route)) targets.push({ route, files: [...new Set([...rootMainFiles, ...Object.values(manifest.entryJSFiles ?? {}).flat()])] })
  }
}
if (targets.length !== 1) {
  console.error(`경로가 하나여야 한다 — 맞은 것 ${targets.length}개: ${targets.map((t) => t.route).join(' ')}`)
  process.exit(1)
}
const target = targets[0]

// ── 분석 데이터 — [u32 길이][JSON 머리][이진 간선] ─────────────────────
function readData(file) {
  const buf = readFileSync(file)
  const len = buf.readUInt32BE(0)
  return { head: JSON.parse(buf.subarray(4, 4 + len).toString('utf8')), bin: new DataView(buf.buffer, buf.byteOffset + 4 + len) }
}
const routeData = join(ANALYZE, target.route.replace(/^\//, '').replace(/\/page$/, ''), 'analyze.data')
const { head: h } = readData(routeData)
const sourcePath = new Map()
const fullPath = (i) => {
  if (!sourcePath.has(i)) {
    const s = h.sources[i]
    sourcePath.set(i, (s.parent_source_index == null ? '' : fullPath(s.parent_source_index)) + s.path)
  }
  return sourcePath.get(i)
}
const clean = (p) => p.replace(/^\[project\]\//, '')

// 분석 쪽 클라이언트 청크 — 파일마다 원본 모듈(부분) 목록
const partsByFile = new Map()
for (const p of h.chunk_parts) {
  const name = h.output_files[p.output_file_index].filename
  if (!name.startsWith('[client-fs]') || !name.endsWith('.js')) continue
  if (!partsByFile.has(p.output_file_index)) partsByFile.set(p.output_file_index, [])
  partsByFile.get(p.output_file_index).push(p)
}

// 실제 파일 ↔ 분석 청크 — 크기 차의 비율이 작은 쌍부터, 둘 다 비었으면 잇는다
const real = target.files.map((f) => {
  const bytes = readFileSync(join(NEXT, f))
  return { f, raw: bytes.length, gz: gzipSync(bytes).length }
})
const pairs = []
for (const r of real) {
  for (const [idx, parts] of partsByFile) {
    const size = parts.reduce((s, p) => s + p.size, 0)
    pairs.push({ r, idx, parts, ratio: Math.abs(size - r.raw) / Math.max(r.raw, 1), d: Math.abs(size - r.raw) })
  }
}
pairs.sort((a, b) => a.ratio - b.ratio)
const matchOf = new Map()
const usedIdx = new Set()
for (const p of pairs) {
  if (matchOf.has(p.r.f) || usedIdx.has(p.idx) || (p.ratio > 0.02 && p.d > 200)) continue
  matchOf.set(p.r.f, p)
  usedIdx.add(p.idx)
}

// 원본 모듈(경로)마다 KB — 파일의 실제 gzip 을 compressed_size 비율로 나눈다
const kbOf = new Map()
let totalGz = 0
let unmatched = 0
for (const { f, gz } of real) {
  totalGz += gz
  const m = matchOf.get(f)
  if (!m) {
    unmatched += gz
    kbOf.set(`(짝 없음) ${f}`, gz / 1024)
    continue
  }
  const sum = m.parts.reduce((s, p) => s + p.compressed_size, 0) || 1
  for (const part of m.parts) {
    const p = clean(fullPath(part.source_index))
    kbOf.set(p, (kbOf.get(p) ?? 0) + ((part.compressed_size / sum) * gz) / 1024)
  }
}
const kb = (n) => n.toFixed(1).padStart(6)
console.log(`${target.route} — 파일 ${target.files.length}개 · gzip ${(totalGz / 1024).toFixed(1)}KB · 짝 없음 ${(unmatched / 1024).toFixed(1)}KB`)

// ── 모듈 그래프(전역) — 동기 의존만 ─────────────────────────────────
function moduleGraph() {
  const { head: mh, bin } = readData(join(ANALYZE, 'modules.data'))
  const edges = (ref, i) => {
    if (ref.length === 0) return []
    const n = bin.getUint32(ref.offset)
    if (i < 0 || i >= n) return []
    const start = ref.offset + 4
    const prev = i === 0 ? 0 : bin.getUint32(start + (i - 1) * 4)
    const count = bin.getUint32(start + i * 4) - prev
    const data = start + 4 * n
    return Array.from({ length: count }, (_, j) => bin.getUint32(data + (prev + j) * 4))
  }
  const pathOf = (i) => clean(mh.modules[i].path)
  // 이 경로의 첫 JS 에 든 클라이언트 모듈만
  const nodes = new Set()
  mh.modules.forEach((m, i) => {
    if (/\[app-client\]|\[client\]/.test(m.ident) && kbOf.has(pathOf(i))) nodes.add(i)
  })
  const deps = new Map()
  const parents = new Map()
  for (const i of nodes) {
    const d = edges(mh.module_dependencies, i).filter((j) => nodes.has(j))
    deps.set(i, d)
    for (const j of d) parents.set(j, [...(parents.get(j) ?? []), i])
  }
  return { nodes, deps, parents, pathOf, roots: [...nodes].filter((i) => !parents.has(i)), ident: (i) => clean(mh.modules[i].ident) }
}

if (opt.cut !== undefined) {
  const g = moduleGraph()
  const reach = (cut) => {
    const seen = new Set(g.roots.filter((r) => !cut(r)))
    const queue = [...seen]
    while (queue.length > 0) {
      for (const d of g.deps.get(queue.pop())) {
        if (seen.has(d) || cut(d)) continue
        seen.add(d)
        queue.push(d)
      }
    }
    return new Set([...seen].map(g.pathOf))
  }
  const all = reach(() => false)
  for (const group of opt.cut.split(';').filter(Boolean)) {
    const keys = group.split(',').map((s) => s.trim())
    const left = reach((i) => keys.some((k) => g.pathOf(i).includes(k)))
    const gone = [...all].filter((p) => !left.has(p)).sort((a, b) => kbOf.get(b) - kbOf.get(a))
    console.log(`${kb(gone.reduce((s, p) => s + kbOf.get(p), 0))}KB  ${group}  (${gone.length}개 모듈)`)
    for (const p of gone.slice(0, Number(opt.top ?? 8))) console.log(`          ${kb(kbOf.get(p))} ${p}`)
  }
} else if (opt.why !== undefined) {
  const g = moduleGraph()
  for (const start of [...g.nodes].filter((i) => g.pathOf(i).includes(opt.why)).slice(0, 3)) {
    // 거슬러 올라가 가장 가까운 진입점(위가 서버 · 클라이언트 참조)까지
    const prev = new Map([[start, -1]])
    const queue = [start]
    let end = start
    while (queue.length > 0) {
      const cur = queue.shift()
      const up = g.parents.get(cur) ?? []
      if (up.length === 0) {
        end = cur
        break
      }
      for (const p of up) {
        if (prev.has(p)) continue
        prev.set(p, cur)
        queue.push(p)
      }
    }
    const chain = []
    for (let c = end; c !== -1 && c !== undefined; c = prev.get(c)) chain.push(g.ident(c))
    console.log(chain.map((c, k) => `${'  '.repeat(k)}${k === 0 ? '진입 ' : '→ '}${c}`).join('\n'))
  }
} else {
  const by = opt.by ?? 'file'
  const group = new Map()
  for (const [p, v] of kbOf) {
    const pkg = p.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
    const key = by === 'file' ? p : pkg ? `npm:${pkg[1]}` : by === 'pkg' ? p.replace(/\/[^/]+$/, '/') : p.split('/').slice(0, 4).join('/')
    group.set(key, (group.get(key) ?? 0) + v)
  }
  for (const [k, v] of [...group].sort((a, b) => b[1] - a[1]).slice(0, Number(opt.top ?? 40))) console.log(`${kb(v)}  ${k}`)
}
