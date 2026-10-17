/**
 * import 그래프 — 소스 파일을 모으고 · 값 import 를 가르고 · 경로를 푼다
 *
 * 클라이언트 번들 검사(`client-bundle.test.ts` — 브라우저 파일에서 내려가며 DB 모듈에 닿는가)와 영향 기반 e2e 고르기
 * (`scripts/e2e-affected.mjs` — 바꾼 파일에서 가져다 쓰는 쪽으로 올라간다)가 함께 쓴다. 정규식으로 읽는다 — 동적 import 는 보지 않는다.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** 디렉터리 아래의 `.ts` · `.tsx`(테스트 파일은 뺀다). */
export function walkSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walkSources(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full)
  }
  return out
}

/** 파일의 **값** import 들(지워지는 `import type` · 전부 `type` 인 묶음은 뺀다). 동적 import 는 보지 않는다. */
export function valueImports(source: string): string[] {
  const out: string[] = []
  const pattern = /^\s*(import|export)\s+(type\s+)?([^'"]*?)\s*from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm
  for (const m of source.matchAll(pattern)) {
    if (m[5] !== undefined) {
      out.push(m[5])
      continue
    }
    if (m[2] !== undefined) continue // import type … / export type …
    const clause = m[3]
    const braces = /\{([^}]*)\}/.exec(clause)
    const outside = clause.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim()
    const named = braces === null ? [] : braces[1].split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    const hasValue = outside.length > 0 || named.some((s) => !s.startsWith('type '))
    if (hasValue) out.push(m[4])
  }
  return out
}

/** `@/…` · 상대 경로를 파일로 푼다. 패키지 · `node:` 내장은 그래프 밖이다(null). */
export function resolveImport(srcRoot: string, from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(srcRoot, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null
  if (base === null) return null
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}
