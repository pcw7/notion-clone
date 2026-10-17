/**
 * 클라이언트 번들이 서버 모듈을 끌어오지 않는가 — 정적 검사 (DB 없음)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 타입체크와 린트는 이것을 못 본다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `'use client'` 컴포넌트가 `lib/database/view.ts` 에서 **타입만** 가져오는 동안은 멀쩡하다 — `import type` 은 지워진다.
 * 같은 파일에서 술어 하나(`isCellColumn`)를 값으로 가져오는 순간 `view.ts → db/tx.ts → db/pool.ts → pg` 가 브라우저 번들에
 * 들어오고 `next build` 가 *"Module not found: Can't resolve 'dns'"* 로 죽는다. `tsc` 도 `eslint` 도 조용하다. 두 번 겪었다
 * (보드 4b 의 `isGroupableType` · relation 5b-1 의 `isCellColumn`) — 둘 다 빌드에서야 알았다.
 *
 * 그래서 import 그래프를 직접 따라간다: `'use client'` 파일에서 시작해 **값 import** 만 타고 가서 `db/pool.ts` 에 닿으면
 * 실패하고, **어느 길로 닿았는지**를 말한다. 고치는 법은 둘 중 하나다 — 타입만 필요하면 `import type`, 값이 필요하면 그
 * 함수를 DB 를 모르는 모듈(`property-types.ts` · `view-columns.ts`)로 옮긴다.
 *
 * 반사실: `view-columns.ts` 를 쓰지 않고 `view.ts` 에서 `isCellColumn` 을 가져오면 이 검사가 그 경로를 짚으며 실패한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveImport as resolveFrom, valueImports, walkSources as walk } from './import-graph.ts'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
/** 브라우저에 들어가면 안 되는 모듈. 여기에 닿는 값 import 경로가 있으면 실패다. */
const SERVER_ONLY = [join(SRC, 'lib', 'db', 'pool.ts')]

const resolveImport = (from: string, spec: string): string | null => resolveFrom(SRC, from, spec)

const show = (file: string): string => relative(SRC, file).split(sep).join('/')

test('★ use client 파일에서 값 import 만 따라가면 db/pool.ts 에 닿지 않는다', () => {
  const clientRoots = walk(join(SRC, 'app')).filter((file) => /^\s*(\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(readFileSync(file, 'utf8')))
  assert.ok(clientRoots.length > 10, `클라이언트 컴포넌트를 찾지 못했다(${clientRoots.length}개) — 검사가 아무것도 안 보고 있다`)

  const cache = new Map<string, string[]>()
  const importsOf = (file: string): string[] => {
    let found = cache.get(file)
    if (found === undefined) {
      found = valueImports(readFileSync(file, 'utf8'))
        .map((spec) => resolveImport(file, spec))
        .filter((f): f is string => f !== null)
      cache.set(file, found)
    }
    return found
  }

  const leaks: string[] = []
  for (const root of clientRoots) {
    // 너비 우선 — 가장 짧은 길을 말해 준다.
    const cameFrom = new Map<string, string | null>([[root, null]])
    const queue = [root]
    while (queue.length > 0) {
      const file = queue.shift() as string
      if (SERVER_ONLY.includes(file)) {
        const path: string[] = []
        for (let at: string | null = file; at !== null; at = cameFrom.get(at) ?? null) path.unshift(show(at))
        leaks.push(path.join('\n      → '))
        break
      }
      for (const next of importsOf(file)) {
        if (!cameFrom.has(next)) {
          cameFrom.set(next, file)
          queue.push(next)
        }
      }
    }
  }

  assert.deepEqual(
    leaks,
    [],
    `클라이언트 번들이 DB 모듈을 끌어온다 — 타입만 필요하면 \`import type\`, 값이 필요하면 그 함수를 DB 를 모르는 모듈로 옮겨라:\n\n    ${leaks.join('\n\n    ')}\n`,
  )
})

test('값 import 가르기 — import type 과 전부 type 인 묶음은 지워진다', () => {
  const source = [
    `import type { A } from './a'`,
    `import { type B, type C } from './b'`,
    `import { d, type E } from './d'`,
    `import * as f from './f'`,
    `import g from './g'`,
    `import './h'`,
    `export { i } from './i'`,
    `export type { J } from './j'`,
    `import {`,
    `  k,`,
    `  type L,`,
    `} from './k'`,
  ].join('\n')
  assert.deepEqual(valueImports(source), ['./d', './f', './g', './h', './i', './k'])
})
