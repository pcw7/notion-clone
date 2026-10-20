/**
 * 전체 e2e 판의 보고 — 알려진 실패 가르기 · 느린 절 · 다시 돌릴 게이트 · 복사본 판의 주소 (e2e 도구 2조각 ·
 * `scripts/e2e-editor.mjs` · `scripts/e2e-full.mjs` 가 쓴다)
 *
 * 전체 판(약 1900개 · 30~40분)은 머지된 main 을 따로 빌드한 복사본에서 뒤로 돈다(2026-10-18 사용자와 정함 · HANDOFF §4) —
 * 그동안 다음 조각을 한다. 판이 끝나면 사람이 하던 일이 둘 있었다. 실패를 HANDOFF §7 의 알려진 실패와 하나씩 대조하기,
 * 새 실패의 게이트를 홀로 다시 돌리기. 둘 다 판이 스스로 한다 — 알려진 실패는 따로 적고 종료 코드에 넣지 않는다 · 새 실패의
 * 게이트는 `E2E_ONLY` 한 줄로 찍는다(복사본 판은 그 줄로 한 번 더 돈다).
 *
 * 검사 하나만 다시 돌리지는 못한다 — 검사는 앞의 동작이 만든 값을 보는 단언이라 다시 돌리는 단위는 게이트다.
 * 순수 함수만 둔다 — 파일 · 프로세스는 스크립트가 다룬다.
 */
import { onlyValue } from './e2e-affected.ts'

export interface CheckResult {
  readonly name: string
  readonly ok: boolean
  /** 검사가 난 게이트(`sectionIf` 제목). 게이트 밖(앞의 늘 도는 절 · [전체])이면 null */
  readonly gate: string | null
}

export interface KnownFailure {
  /** 검사 이름의 앞머리 */
  readonly prefix: string
  /** 왜 알려졌는가 — HANDOFF §7 의 어느 줄인가 */
  readonly why: string
}

/**
 * 이 PC 에서 늘 떨어지는 검사 — HANDOFF §7 "e2e 환경 · 흔들림". 판마다 손으로 대조하던 것을 여기에 둔다.
 * 넣는 조건은 **홀로 돌려도 늘 떨어지는 환경의 실패**다 — 가끔 떨어지는 흔들림은 넣지 않는다(그것은 다시 돌리기가 가린다 ·
 * 넣으면 진짜 회귀를 함께 삼킨다). 넣을 때는 §7 에 그 줄이 먼저 있어야 한다.
 */
export const KNOWN_FAILURES: readonly KnownFailure[] = [
  { prefix: '★ 진짜 클립보드로 붙는다', why: '§7 e2e 환경 — 이 PC 의 헤드리스 브라우저는 시스템 클립보드로 붙이지 못한다' },
  { prefix: '붙여넣은 것이 서버에 저장된다 — 자식(B)은 그대로', why: '§7 e2e 환경 — 위 클립보드 검사의 뒤따름(붙지 않았으니 저장된 것도 다르다)' },
]

export interface FailureSplit {
  readonly fresh: readonly CheckResult[]
  readonly known: readonly { readonly result: CheckResult; readonly why: string }[]
}

/** 떨어진 검사를 새 실패와 알려진 실패로 가른다. 통과한 검사는 어느 쪽에도 없다. */
export function splitFailures(results: readonly CheckResult[], known: readonly KnownFailure[] = KNOWN_FAILURES): FailureSplit {
  const fresh: CheckResult[] = []
  const knownOut: { result: CheckResult; why: string }[] = []
  for (const result of results) {
    if (result.ok) continue
    const hit = known.find((k) => result.name.startsWith(k.prefix))
    if (hit === undefined) fresh.push(result)
    else knownOut.push({ result, why: hit.why })
  }
  return { fresh, known: knownOut }
}

/** 새 실패를 다시 돌릴 게이트(처음 나온 차례 · 겹치지 않게)와 게이트 밖 실패의 수 — 게이트 밖은 늘 돌므로 고를 것이 없다. */
export function rerunGates(fresh: readonly CheckResult[]): { readonly gates: readonly string[]; readonly outside: number } {
  const gates: string[] = []
  let outside = 0
  for (const r of fresh) {
    if (r.gate === null) outside += 1
    else if (!gates.includes(r.gate)) gates.push(r.gate)
  }
  return { gates, outside }
}

// ── 예외로 끝난 절 — 판을 멈추지 않고 그 절의 실패 하나로 센다(도구-5) ──

/** 예외로 끝난 절이 남기는 검사의 이름 — 그 게이트의 실패로 세어 `다시 돌리기` 줄에 선다. */
export const SECTION_THREW = '절이 예외로 끝났다 — 이 절의 남은 검사는 돌지 않았다'

/**
 * 절을 끝낸 예외 한 줄 — 메시지와 스크립트 안의 자리(`e2e-editor.mjs:줄`). 자리는 게이트가 사는 `main` 의 프레임을 먼저 고른다 —
 * 평가 · 기다림 도우미 안의 던진 줄은 어느 검사였는지 말하지 않는다. 평가의 예외는 페이지의 스택(`at <anonymous>:3:45`)을 여러 줄로
 * 싣는다 — 보고의 들여쓴 한 줄로 편다.
 */
export function thrownDetail(thrown: unknown, script = 'e2e-editor.mjs'): string {
  if (!(thrown instanceof Error)) return String(thrown)
  const message = thrown.message.replace(/\s*\n\s*/g, ' ⏎ ')
  const frames = (thrown.stack ?? '')
    .split('\n')
    .map((line) => ({ line, m: line.match(/([\w.-]+\.m?[jt]s):(\d+):\d+\)?\s*$/) }))
    .filter((f) => f.m !== null && f.m[1] === script)
  const at = frames.find((f) => /\bmain \(/.test(f.line)) ?? frames[0]
  return at ? `${message} (${script}:${at.m![2]})` : message
}

/**
 * 몸을 `{ try {` 로 열지 않는 게이트 — 예외가 판 전체를 끝낸다. 게이트는 늘 이렇게 연다:
 *
 *   if (sectionIf('제목')) { try {
 *     …
 *   } catch (thrown) { await sectionThrew(thrown) } }
 *
 * 새 게이트도 감싸게 검사(`e2e-report.test.ts`)가 실제 스크립트를 읽어 지킨다.
 */
export function unguardedGates(source: string): string[] {
  const out: string[] = []
  for (const m of source.matchAll(/sectionIf\(\s*'([^']+)'([^\n]*)/g)) {
    if (m[2].trim() !== ')) { try {') out.push(m[1])
  }
  return out
}

export interface SectionTiming {
  readonly title: string
  readonly ms: number
}

/** 느린 절 n 개 — 오래 걸린 차례 · 같으면 먼저 돈 것. */
export function slowest(timings: readonly SectionTiming[], n: number): SectionTiming[] {
  return timings
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.ms - a.t.ms || a.i - b.i)
    .slice(0, n)
    .map(({ t }) => t)
}

/** 12.3초 · 3분 05초 */
export function formatSeconds(ms: number): string {
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}초`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}분 ${String(whole % 60).padStart(2, '0')}초`
}

// ── 판의 끝 줄 — e2e 가 찍고 복사본 판이 읽는다 ──

export const RERUN_PREFIX = '다시 돌리기: E2E_ONLY='

export function rerunLine(gates: readonly string[]): string {
  return `${RERUN_PREFIX}"${onlyValue(gates)}"`
}

export function countsLine(fresh: number, known: number): string {
  return `새 실패 ${fresh}개 · 알려진 실패 ${known}개`
}

export interface RunSummary {
  readonly passed: number
  readonly total: number
  /** 이 판이 새 실패 · 알려진 실패를 갈랐는가 — 옛 e2e 의 로그에는 그 줄이 없다 */
  readonly fresh: number | null
  readonly known: number | null
  /** 새 실패의 게이트로 만든 E2E_ONLY — 없으면 null */
  readonly rerun: string | null
}

function lastMatch(log: string, re: RegExp): RegExpMatchArray | null {
  let last: RegExpMatchArray | null = null
  for (const m of log.matchAll(re)) last = m
  return last
}

/** 판의 로그에서 끝 줄들을 읽는다. 끝 줄(`N / M 통과`)이 없으면 판이 끝나지 않은 것이다 — null. */
export function parseRunSummary(log: string): RunSummary | null {
  const totals = lastMatch(log, /^(\d+) \/ (\d+) 통과\r?$/gm)
  if (totals === null) return null
  const counts = lastMatch(log, /^새 실패 (\d+)개 · 알려진 실패 (\d+)개\r?$/gm)
  const rerun = lastMatch(log, /^다시 돌리기: E2E_ONLY="([^"]*)"\r?$/gm)
  return {
    passed: Number(totals[1]),
    total: Number(totals[2]),
    fresh: counts === null ? null : Number(counts[1]),
    known: counts === null ? null : Number(counts[2]),
    rerun: rerun === null || rerun[1] === '' ? null : rerun[1],
  }
}

// ── 복사본 판의 주소 — 따로 DB · 따로 Valkey 번호 ──

/** `.env` 를 e2e · migrate 와 같은 규칙으로 읽는다 — `KEY=값` · 둘레의 따옴표를 벗긴다. CRLF 줄도 읽는다(`.` 은 `\r` 을 받지 않는다). */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const DB_NAME = /^[a-z_][a-z0-9_]*$/

/** 접속 주소의 DB 이름 */
export function databaseOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''))
}

/** 같은 서버 · 같은 계정의 다른 DB. 이름은 따옴표 없이 SQL 에 들어가므로 소문자 · 숫자 · 밑줄만 받는다. */
export function withDatabase(url: string, name: string): string {
  if (!DB_NAME.test(name)) throw new Error(`DB 이름은 소문자 · 숫자 · 밑줄만: ${name}`)
  const u = new URL(url)
  u.pathname = `/${name}`
  return u.toString()
}

/** 같은 Valkey 의 다른 번호(`redis://host:port/N`) */
export function withRedisDb(url: string, n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 15) throw new Error(`Valkey 번호는 0~15: ${n}`)
  const u = new URL(url)
  u.pathname = `/${n}`
  return u.toString()
}
