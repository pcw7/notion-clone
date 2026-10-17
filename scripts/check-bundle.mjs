#!/usr/bin/env node
/**
 * 번들 예산 — 경로마다 처음 받는 JS(gzip)가 예산 안인가 (플랫폼 잔여 10g-1 · F-12-07 · 정본 §3.10 끝 [보강] 성능 계측 ⑥)
 *
 * `npm run build` 뒤에 돈다(CI 는 빌드 바로 뒤에). 처음 받는 파일은 모든 경로가 받는 것(`build-manifest.json` 의 `rootMainFiles`) ∪
 * 그 경로의 레이아웃 · 페이지의 진입 청크(`page_client-reference-manifest.js` 의 `entryJSFiles`). 크기는 파일마다 gzip 한 것의 합(서버가
 * 압축해 보낸다). 지연 로드(`import()`)는 세지 않는다 — 그쪽으로 옮기는 것이 이 예산이 바라는 일이다.
 * 예산은 `src/lib/perf/bundle-budget.ts` — 올리는 것은 커밋으로 보이는 결정이다(왜 커졌는지 적고 올린다).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { gzipSync } from 'node:zlib'

const { initialFiles, judge } = await import('../src/lib/perf/bundle-budget.ts')

const NEXT = join(import.meta.dirname, '..', '.next')
const BUILD_MANIFEST = join(NEXT, 'build-manifest.json')
if (!existsSync(BUILD_MANIFEST)) {
  console.error('프로덕션 빌드가 없다. `npm run build` 를 먼저 돌려라.')
  process.exit(1)
}
const { rootMainFiles } = JSON.parse(readFileSync(BUILD_MANIFEST, 'utf8'))
const APP = join(NEXT, 'server', 'app')
const manifests = readdirSync(APP, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('page_client-reference-manifest.js'))

const sizes = new Map()
const sizeOf = (file) => {
  if (!sizes.has(file)) {
    const bytes = readFileSync(join(NEXT, file))
    sizes.set(file, { raw: bytes.length, gzip: gzipSync(bytes).length })
  }
  return sizes.get(file)
}

const measured = []
for (const file of manifests) {
  // 매니페스트는 `globalThis.__RSC_MANIFEST[경로] = {...}` 를 쓰는 스크립트다 — 빈 맥락에서 돌려 그 값을 읽는다(우리 빌드의 산출물)
  const sandbox = {}
  vm.runInNewContext(readFileSync(join(APP, file), 'utf8'), sandbox)
  for (const [route, manifest] of Object.entries(sandbox.__RSC_MANIFEST ?? {})) {
    const files = initialFiles(rootMainFiles, manifest.entryJSFiles ?? {})
    measured.push({
      route,
      files: files.length,
      gzipBytes: files.reduce((sum, f) => sum + sizeOf(f).gzip, 0),
      rawBytes: files.reduce((sum, f) => sum + sizeOf(f).raw, 0),
    })
  }
}
if (measured.length === 0) {
  console.error('경로 매니페스트를 찾지 못했다 — 빌드 산출물의 모양이 바뀌었나(`.next/server/app/**/page_client-reference-manifest.js`)')
  process.exit(1)
}

const kb = (bytes) => (bytes / 1024).toFixed(1)
const verdicts = judge(measured).sort((a, b) => b.gzipBytes / (b.maxKB * 1024) - a.gzipBytes / (a.maxKB * 1024))
console.log('처음 받는 JS(gzip) / 예산 — 경로')
for (const v of verdicts) {
  console.log(`${v.over ? '✗' : ' '} ${kb(v.gzipBytes).padStart(7)}KB / ${String(v.maxKB).padStart(3)}KB  (${String(v.files).padStart(2)}개 · 원본 ${kb(v.rawBytes)}KB)  ${v.route}`)
}
const over = verdicts.filter((v) => v.over)
if (over.length > 0) {
  console.error(`\n예산을 넘은 경로 ${over.length}개 — 무거운 것을 정적으로 import 했나(지연 로드로 옮긴다). 정말 커져야 한다면 \`src/lib/perf/bundle-budget.ts\` 의 예산을 까닭과 함께 올린다.`)
  process.exit(1)
}
console.log(`\n${verdicts.length}개 경로 모두 예산 안`)
