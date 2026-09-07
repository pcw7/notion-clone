#!/usr/bin/env node
/**
 * 의존성 라이선스 검사 — CLAUDE.md "절대 제약 1: 무료 라이브러리만 쓴다"의 기계적 강제.
 *
 * 외부 의존성 없이 `npm query`만 쓴다. 라이선스 검사기를 넣자고 라이선스가 불분명한
 * 패키지를 하나 더 다는 것은 자기모순이다.
 *
 *   node scripts/check-licenses.mjs          검사 (위반 시 exit 1)
 *   node scripts/check-licenses.mjs --list   전체 라이선스 집계 출력
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** 허용 — 상용 이용·수정·비공개 배포에 제약이 없는 것만. */
const ALLOWED = new Set([
  'MIT',
  'ISC',
  '0BSD',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'PostgreSQL',
  'Unlicense',
  'CC0-1.0',
  'BlueOak-1.0.0',
  'Artistic-2.0',
  'Zlib',
  // 데이터·문서 전용 (코드가 아님)
  'CC-BY-4.0',
  'CC-BY-3.0',
  // Python-2.0 은 GPL 호환 허용 라이선스다 (argparse 등)
  'Python-2.0',
  // MPL-2.0 은 파일 단위 copyleft. 해당 파일을 수정하지 않는 한 의무가 없다.
  // 빌드 도구(lightningcss)·테스트 도구(axe-core)로만 쓴다.
  'MPL-2.0',
])

/**
 * 금지 — 배포·SaaS 운영에 의무나 제약을 만드는 것.
 * CLAUDE.md 절대 제약 1과 동일한 목록이다.
 */
const DENIED_PATTERNS = [
  /\bAGPL/i, // 네트워크 사용도 소스 공개 의무
  /\bSSPL/i, // 서비스로 제공 시 전체 스택 공개 의무
  /\bRSAL/i, // Redis Source Available — 경쟁 제품 금지
  /\bBUSL/i, // Business Source License — 기간 제한
  /\bElastic-2\.0/i,
  /\bCommons.?Clause/i,
  /^GPL-/i, // 강한 copyleft
  /\bLGPL/i, // 번들링이 정적 링크로 해석될 여지
  /^UNLICENSED$/,
  /\bProprietary/i,
]

/**
 * 문서화된 예외. 이유 없이 추가하지 마라.
 * 새 예외를 넣을 때는 반드시 (a) 왜 의무가 발생하지 않는지 (b) 제거 경로를 적는다.
 */
const EXCEPTIONS = [
  {
    // Next.js 이미지 최적화가 쓰는 네이티브 바이너리.
    // sharp 자체는 Apache-2.0이고 LGPL-3.0은 여기 묶인 libvips 쪽이다.
    // 우리는 libvips를 수정하지 않고 별도 공유 바이너리로 호출만 하므로
    // LGPL의 동적 링크 허용 범위 안에 있다. 소스 공개 의무가 생기지 않는다.
    // 제거 경로: next.config.ts 에서 images.unoptimized = true 로 두면 의존이 사라진다.
    match: (name) => name.startsWith('@img/sharp') || name === 'sharp',
    reason: 'libvips(LGPL-3.0)를 수정 없이 별도 바이너리로 호출 — 동적 링크 허용 범위',
  },
]

const args = process.argv.slice(2)
const LIST_ONLY = args.includes('--list')

function licenseOf(pkg) {
  const l = pkg.license
  if (typeof l === 'string') return l
  if (l && typeof l === 'object' && typeof l.type === 'string') return l.type
  if (Array.isArray(pkg.licenses) && pkg.licenses[0]?.type) return pkg.licenses[0].type
  return 'UNKNOWN'
}

function isAllowed(license) {
  if (ALLOWED.has(license)) return true
  // "(MIT OR Apache-2.0)" 같은 SPDX 표현식: 허용 항목이 하나라도 있으면 통과
  const orParts = license
    .replace(/[()]/g, '')
    .split(/\s+OR\s+/i)
    .map((s) => s.trim())
  if (orParts.length > 1) return orParts.some((p) => ALLOWED.has(p))
  return false
}

function isDenied(license) {
  return DENIED_PATTERNS.some((re) => re.test(license))
}

/**
 * node_modules 를 직접 순회해 설치된 패키지를 수집한다.
 *
 * `npm query` 를 쓰지 않는 이유: Node 20+ 는 Windows 에서 보안상(CVE-2024-27980)
 * shell 없이 `.cmd` 실행을 막고, shell:true 는 인자 이스케이프 경고를 낸다.
 * 디렉터리를 직접 읽으면 외부 프로세스도 플랫폼 분기도 필요 없다.
 */
function collectPackages(nodeModulesDir, out = new Map()) {
  if (!existsSync(nodeModulesDir)) return out

  let entries
  try {
    entries = readdirSync(nodeModulesDir, { withFileTypes: true })
  } catch {
    return out
  }

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    if (entry.name.startsWith('.')) continue // .bin, .package-lock.json 등

    const full = join(nodeModulesDir, entry.name)

    // 스코프 디렉터리(@scope)는 한 단계 더 들어간다
    if (entry.name.startsWith('@')) {
      collectPackages(full, out)
      continue
    }

    const manifestPath = join(full, 'package.json')
    if (existsSync(manifestPath)) {
      try {
        const m = JSON.parse(readFileSync(manifestPath, 'utf8'))
        if (m.name) {
          const key = `${m.name}@${m.version ?? '0.0.0'}`
          if (!out.has(key)) out.set(key, m)
        }
      } catch {
        // 깨진 manifest 는 무시한다 (npm 내부 임시 디렉터리 등)
      }
    }

    // 중첩 의존성
    collectPackages(join(full, 'node_modules'), out)
  }
  return out
}

if (!existsSync('node_modules')) {
  console.error('node_modules 가 없습니다 — `npm install` 을 먼저 하세요.')
  process.exit(2)
}

const pkgs = [...collectPackages('node_modules').values()]
const rootName = JSON.parse(readFileSync('package.json', 'utf8')).name

const tally = new Map()
const violations = []
const exceptionsUsed = []
const unknowns = []

const rootManifest = JSON.parse(readFileSync('package.json', 'utf8'))
const directDev = new Set(Object.keys(rootManifest.devDependencies ?? {}))

for (const p of pkgs) {
  if (p.name === rootName) continue // 자기 자신

  const license = licenseOf(p)
  const dev = directDev.has(p.name)
  tally.set(license, (tally.get(license) ?? 0) + 1)

  const exc = EXCEPTIONS.find((e) => e.match(p.name))
  if (exc) {
    exceptionsUsed.push({ name: p.name, version: p.version, license, reason: exc.reason })
    continue
  }

  if (license === 'UNKNOWN') {
    unknowns.push({ name: p.name, version: p.version, dev })
    continue
  }
  if (isDenied(license) || !isAllowed(license)) {
    violations.push({ name: p.name, version: p.version, license, dev })
  }
}

if (LIST_ONLY) {
  console.log(`총 ${pkgs.length}개 패키지\n`)
  ;[...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([l, n]) => console.log(`  ${String(n).padStart(4)}  ${l}`))
  process.exit(0)
}

if (exceptionsUsed.length) {
  console.log('문서화된 예외:')
  for (const e of exceptionsUsed) {
    console.log(`  ~ ${e.name}@${e.version} [${e.license}]`)
    console.log(`    ${e.reason}`)
  }
  console.log('')
}

let failed = false

if (unknowns.length) {
  failed = true
  console.error(`라이선스 미상 ${unknowns.length}건 — 확인 없이 통과시키지 않는다:`)
  for (const u of unknowns) console.error(`  ? ${u.name}@${u.version}${u.dev ? ' (dev)' : ''}`)
  console.error('')
}

if (violations.length) {
  failed = true
  console.error(`허용되지 않은 라이선스 ${violations.length}건:`)
  for (const v of violations) {
    console.error(`  x ${v.name}@${v.version} [${v.license}]${v.dev ? ' (dev)' : ''}`)
  }
  console.error('')
  console.error('CLAUDE.md 절대 제약 1 위반. 의존성을 빼거나, 정당한 예외라면')
  console.error('scripts/check-licenses.mjs 의 EXCEPTIONS 에 근거와 제거 경로를 적어 추가하세요.')
}

if (failed) process.exit(1)

console.log(`라이선스 검사 통과 — ${pkgs.length}개 패키지, 허용 라이선스만 사용 중`)
