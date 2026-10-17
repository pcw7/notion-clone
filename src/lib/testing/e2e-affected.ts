/**
 * 영향 기반 e2e 고르기 — 바꾼 파일이 닿는 e2e 게이트를 찾는다 (e2e 도구 1조각 · `scripts/e2e-affected.mjs` 가 쓴다)
 *
 * 전체 판(약 1900개 · 30~40분)은 4조각마다 · 트랙 끝에만 돈다(2026-10-17 사용자와 정함 · HANDOFF §4). 그 사이 조각마다는 **바꾼 것을
 * 쓰는 절**만 돌린다. 조각 이름으로 고르면 놓친다 — 10j-3b 가 바꾼 팝오버 일곱을 212개 절 중 31개가 썼는데, 이름으로 고른 판은 그중
 * 몇 개만 돌려 결함 셋을 전체 판에서야 봤다.
 *
 * 바꾼 것과 게이트를 잇는 끈은 셋이다.
 *   ① testid — 바꾼 파일의 정적 `data-testid` · `testId`. 없으면 그 파일을 가져다 쓰는 쪽으로 거슬러 올라가 **testid 를 가진 가장
 *      가까운 파일**들의 것(층 `anchored-layer.tsx` 를 바꾸면 그것을 쓰는 팝오버들의 testid)
 *   ② 주소 — 바꾼(또는 거슬러 올라가다 닿은) `page.tsx` · `route.ts` 의 주소 모양. 레이아웃은 그 아래 주소 전부
 *   ③ e2e 자체 — `scripts/e2e-editor.mjs` 에서 바뀐 줄을 품은 게이트
 *
 * 게이트는 `sectionIf('제목')` 이다 — 데이터베이스 안쪽 절은 우산 게이트 하나로 묶여 있다(필터가 거기에만 있다). 순수 함수만 둔다 —
 * 파일 · git 은 스크립트가 읽는다.
 */

export interface Gate {
  readonly title: string
  /** e2e 원문에서 그 게이트가 차지하는 글자 범위 [start, end) */
  readonly start: number
  readonly end: number
}

/** `sectionIf('제목')` 들 — 다음 게이트가 시작하기 전까지가 그 게이트다. */
export function parseGates(source: string): Gate[] {
  const starts = [...source.matchAll(/sectionIf\(\s*'([^']+)'/g)].map((m) => ({ title: m[1], start: m.index }))
  return starts.map((g, i) => ({ ...g, end: i + 1 < starts.length ? starts[i + 1].start : source.length }))
}

function gateAt(gates: readonly Gate[], offset: number): Gate | null {
  for (const gate of gates) if (offset >= gate.start && offset < gate.end) return gate
  return null
}

const ID = '[a-z0-9][a-z0-9-]*'

/** 파일에 적힌 정적 testid — `data-testid="x"` · `testId="x"` · `data-testid={'x'}`. 식으로 만든 것(`{testId}` · 템플릿)은 못 본다. */
export function staticTestIds(source: string): string[] {
  const pattern = new RegExp(`\\b(?:data-testid|testId)=(?:"(${ID})"|\\{\\s*'(${ID})'\\s*\\}|\\{\\s*"(${ID})"\\s*\\})`, 'g')
  const out = new Set<string>()
  for (const m of source.matchAll(pattern)) out.add(m[1] ?? m[2] ?? m[3])
  return [...out].sort()
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 게이트 제목 → 그 게이트를 고른 까닭들. */
export type Reasons = Map<string, Set<string>>

function add(reasons: Reasons, title: string, why: string): void {
  let set = reasons.get(title)
  if (set === undefined) reasons.set(title, (set = new Set()))
  set.add(why)
}

/** e2e 에서 그 testid 를 **온전히** 쓰는 게이트 — 앞뒤가 testid 글자가 아니어야 한다(`db-column-menu` 는 `db-column-menu-panel` 에 걸리지 않는다). */
export function gatesUsingIds(source: string, gates: readonly Gate[], ids: Iterable<string>, reasons: Reasons = new Map()): Reasons {
  for (const id of ids) {
    for (const m of source.matchAll(new RegExp(`(?<![a-z0-9-])${escapeRegExp(id)}(?![a-z0-9-])`, 'g'))) {
      const gate = gateAt(gates, m.index)
      if (gate !== null) add(reasons, gate.title, `testid ${id}`)
    }
  }
  return reasons
}

/** 주소의 한 조각 — 글자 그대로이거나 e2e 의 템플릿 자리(`${db.id}`). 글자 그대로에는 `$ { }` 가 없다 — 있으면 템플릿 자리 중간에서 끊겨 걸린다. */
const SEGMENT = String.raw`(?:\$\{[^}]+\}|[^/'"\x60\s?#{}$]+)`

/**
 * `src/app` 아래의 경로(`w/[workspaceId]/db/[databaseId]/page.tsx`) → e2e 가 그 주소를 쓰는 자리를 찾는 정규식.
 *
 * - 동적 조각 `[x]` 는 아무 조각 · `[...x]` · `[[...x]]` 는 하나 이상의 조각 · 묶음 `(x)` 와 슬롯 `@x` 는 주소에 없다
 * - API 는 워크스페이스 접두(`api/workspaces/[workspaceId]`) 뒤만 본다 — e2e 의 `api()` 도우미가 그 접두를 붙인다
 * - 페이지 · 라우트는 주소가 거기서 끝나야 한다(`/w/x` 는 `/w/x/db/y` 에 걸리지 않는다). 레이아웃 · 로딩 · 오류는 그 아래 전부(`prefix`)
 * - 남는 조각이 없으면(워크스페이스 접두 그 자체 · 뿌리) null — 모든 판이 걸려 고르는 뜻이 없다
 */
export function routePattern(appPath: string): RegExp | null {
  const parts = appPath.split('/')
  const file = parts.pop() ?? ''
  const prefix = /^(layout|template|loading|error|not-found)\.(tsx|ts|jsx|js)$/.test(file)
  let segments = parts.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@'))
  if (segments[0] === 'api' && segments[1] === 'workspaces' && /^\[[^.]+\]$/.test(segments[2] ?? '')) segments = segments.slice(3)
  if (segments.length === 0) return null
  const body = segments
    .map((s) => (/^\[\[?\.\.\./.test(s) ? `${SEGMENT}(?:/${SEGMENT})*` : /^\[.+\]$/.test(s) ? SEGMENT : escapeRegExp(s)))
    .join('/')
  return new RegExp(`/${body}${prefix ? '(?![a-zA-Z0-9_-])' : '(?![a-zA-Z0-9_/-])'}`, 'g')
}

/** 그 주소를 쓰는 게이트. */
export function gatesUsingRoute(source: string, gates: readonly Gate[], appPath: string, reasons: Reasons = new Map()): Reasons {
  const pattern = routePattern(appPath)
  if (pattern === null) return reasons
  for (const m of source.matchAll(pattern)) {
    const gate = gateAt(gates, m.index)
    if (gate !== null) add(reasons, gate.title, `주소 ${appPath}`)
  }
  return reasons
}

/**
 * e2e 원문의 줄 번호들(1부터) → 그 줄을 품은 게이트. 게이트 밖의 줄(첫 게이트 앞 — 모든 절이 쓰는 도우미 · 브라우저 띄우기)은
 * `outside` 로 따로 돌려준다 — 그것이 바뀌면 모든 절이 걸린다.
 */
export function gatesAtLines(
  source: string,
  gates: readonly Gate[],
  lines: Iterable<number>,
  reasons: Reasons = new Map(),
): { readonly reasons: Reasons; readonly outside: readonly number[] } {
  const lineStarts = [0]
  for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1)) lineStarts.push(i + 1)
  const outside: number[] = []
  for (const line of lines) {
    const offset = lineStarts[line - 1]
    if (offset === undefined) continue
    const gate = gateAt(gates, offset)
    if (gate !== null) add(reasons, gate.title, 'e2e 에서 바뀐 줄')
    else if (!isCommentOrBlank(source.slice(offset, lineStarts[line] ?? source.length))) outside.push(line)
  }
  return { reasons, outside }
}

/** 주석 · 빈 줄 — 게이트 밖에서 바뀌어도 아무 절도 다르게 돌지 않는다(머리 주석을 고친 판이 전체 판을 부르지 않게). */
const isCommentOrBlank = (text: string): boolean => /^\s*(\/\/.*|\/\*.*|\*.*)?\s*$/.test(text)

/** `git diff -U0` 의 `@@ -a,b +c,d @@` 머리 → 새 쪽에서 바뀐(더해진) 줄 번호. 지우기만 한 덩이는 그 자리의 줄 하나. */
export function changedLines(unifiedDiff: string): number[] {
  const out: number[] = []
  for (const m of unifiedDiff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1])
    const count = m[2] === undefined ? 1 : Number(m[2])
    if (count === 0) out.push(Math.max(1, start))
    for (let i = 0; i < count; i += 1) out.push(start + i)
  }
  return out
}

/**
 * 바꾼 파일에서 가져다 쓰는 쪽(importer)으로 거슬러 올라가 **testid 를 가진 가장 가까운 파일**에서 멈춘다. 바꾼 파일이 testid 를
 * 가졌으면 그 파일에서 멈춘다. 지나는 길에 만난 page · route · layout 은 주소로 모은다(그 위로는 가져다 쓰는 쪽이 없다).
 */
export function nearestCarriers(
  changed: readonly string[],
  importersOf: (file: string) => readonly string[],
  hasIds: (file: string) => boolean,
  isRoute: (file: string) => boolean,
): { readonly carriers: ReadonlySet<string>; readonly routes: ReadonlySet<string> } {
  const carriers = new Set<string>()
  const routes = new Set<string>()
  const seen = new Set<string>(changed)
  const queue = [...changed]
  while (queue.length > 0) {
    const file = queue.shift() as string
    if (isRoute(file)) routes.add(file)
    if (hasIds(file)) {
      carriers.add(file)
      continue
    }
    for (const next of importersOf(file)) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return { carriers, routes }
}

/**
 * 고를 수 없는 바꿈 — 모든 화면이 함께 쓰는 곳. 닿으면 전체 판을 권한다. 의존성은 잠금 파일로 본다 — `package.json` 은 스크립트
 * 한 줄로도 바뀌지만, 의존성이 바뀌면 잠금 파일이 늘 함께 바뀐다.
 */
export const GLOBAL_CHANGES: readonly RegExp[] = [
  /^db\/migrations\//,
  /^scripts\/collab-server\.mjs$/,
  /^package-lock\.json$/,
  /^next\.config\.ts$/,
  /^src\/app\/layout\.tsx$/,
  /^src\/app\/[^/]+\.css$/,
]

export const isGlobalChange = (repoPath: string): boolean => GLOBAL_CHANGES.some((p) => p.test(repoPath))

/** `E2E_ONLY` 값 — 게이트 제목을 쉼표로 잇는다(제목에 쉼표가 있으면 그 게이트를 고를 수 없다 — 던진다). */
export function onlyValue(titles: Iterable<string>): string {
  const list = [...titles]
  const bad = list.find((t) => t.includes(','))
  if (bad !== undefined) throw new Error(`게이트 제목에 쉼표가 있어 E2E_ONLY 로 고를 수 없다: ${bad}`)
  return list.join(',')
}
