/**
 * 전체 e2e 판의 보고 — 순수 함수 (e2e 도구 2조각 · DB 없음)
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  countsLine,
  databaseOf,
  formatSeconds,
  KNOWN_FAILURES,
  parseDotEnv,
  parseRunSummary,
  rerunGates,
  rerunLine,
  slowest,
  splitFailures,
  thrownDetail,
  unguardedGates,
  withDatabase,
  withRedisDb,
} from './e2e-report.ts'

const ok = (name: string, gate: string | null = 'g') => ({ name, ok: true, gate })
const bad = (name: string, gate: string | null = 'g') => ({ name, ok: false, gate })

test('★ 알려진 실패는 따로 — 새 실패만 남는다 · 통과한 검사는 어느 쪽에도 없다', () => {
  const split = splitFailures([
    ok('세 벌을 싣는다'),
    bad('★ 진짜 클립보드로 붙는다 — 중첩까지 (T · C · t1 이 한 벌 더)', null),
    bad('붙여넣은 것이 서버에 저장된다 — 자식(B)은 그대로', null),
    bad('★ 층이 옆으로 밀리지 않는다', '수식 (2i-3b)'),
  ])
  assert.deepEqual(split.fresh.map((r) => r.name), ['★ 층이 옆으로 밀리지 않는다'])
  assert.deepEqual(split.known.map((k) => k.result.name), [
    '★ 진짜 클립보드로 붙는다 — 중첩까지 (T · C · t1 이 한 벌 더)',
    '붙여넣은 것이 서버에 저장된다 — 자식(B)은 그대로',
  ])
  assert.ok(split.known.every((k) => k.why.startsWith('§7')))
})

test('알려진 실패는 이름의 앞머리로만 — 가운데에 같은 말이 있어도 새 실패다', () => {
  const split = splitFailures([bad('다른 검사 — ★ 진짜 클립보드로 붙는다')])
  assert.equal(split.fresh.length, 1)
  assert.equal(split.known.length, 0)
})

test('알려진 실패 목록의 앞머리는 비지 않고 겹치지 않는다 — 빈 앞머리는 모든 실패를 삼킨다', () => {
  for (const k of KNOWN_FAILURES) assert.ok(k.prefix.length >= 8, k.prefix)
  assert.equal(new Set(KNOWN_FAILURES.map((k) => k.prefix)).size, KNOWN_FAILURES.length)
})

test('다시 돌릴 게이트 — 처음 나온 차례 · 겹치지 않게 · 게이트 밖은 수만 센다', () => {
  const r = rerunGates([bad('a', '표 (1a)'), bad('b', null), bad('c', '수식 (2i-3b)'), bad('d', '표 (1a)')])
  assert.deepEqual(r.gates, ['표 (1a)', '수식 (2i-3b)'])
  assert.equal(r.outside, 1)
  assert.equal(rerunLine(r.gates), '다시 돌리기: E2E_ONLY="표 (1a),수식 (2i-3b)"')
})

test('게이트 제목에 쉼표가 있으면 다시 돌리기 줄을 만들지 않는다 — E2E_ONLY 가 쉼표로 가른다', () => {
  assert.throws(() => rerunLine(['a, b']), /쉼표/)
})

test('느린 절 — 오래 걸린 차례 · 같으면 먼저 돈 것', () => {
  const t = [
    { title: 'a', ms: 10 },
    { title: 'b', ms: 30 },
    { title: 'c', ms: 30 },
    { title: 'd', ms: 20 },
  ]
  assert.deepEqual(slowest(t, 3).map((x) => x.title), ['b', 'c', 'd'])
  assert.deepEqual(slowest(t, 10).length, 4)
})

test('시간 표기 — 1분 아래는 초 · 넘으면 분과 두 자리 초', () => {
  assert.equal(formatSeconds(12_345), '12.3초')
  assert.equal(formatSeconds(185_000), '3분 05초')
  assert.equal(formatSeconds(59_960), '60.0초')
})

const LOG = [
  '[전체]',
  '  o 서버에서 오류가 나지 않았다',
  '',
  countsLine(1, 2),
  rerunLine(['수식 (2i-3b)']),
  '',
  '1891 / 1894 통과',
].join('\n')

test('★ 판의 끝 줄을 읽는다 — 통과 수 · 새 실패 · 알려진 실패 · 다시 돌릴 게이트', () => {
  assert.deepEqual(parseRunSummary(LOG), { passed: 1891, total: 1894, fresh: 1, known: 2, rerun: '수식 (2i-3b)' })
})

test('끝 줄이 없으면 판이 끝나지 않은 것 — null', () => {
  assert.equal(parseRunSummary(LOG.replace('1891 / 1894 통과', '')), null)
})

test('옛 로그(가르는 줄 없음) · CRLF 로그도 읽는다', () => {
  assert.deepEqual(parseRunSummary('  X 무엇\r\n\r\n1892 / 1894 통과\r\n'), { passed: 1892, total: 1894, fresh: null, known: null, rerun: null })
})

test('.env 는 e2e 와 같은 규칙 — 둘레의 따옴표를 벗긴다 · 주석은 건너뛴다', () => {
  const env = parseDotEnv('# 주석\nDATABASE_URL="postgresql://u:p@localhost:5432/notion"\r\nREDIS_URL=redis://localhost:6379\n')
  assert.deepEqual(env, { DATABASE_URL: 'postgresql://u:p@localhost:5432/notion', REDIS_URL: 'redis://localhost:6379' })
})

test('★ 복사본 판의 주소 — 같은 서버의 다른 DB · 같은 Valkey 의 다른 번호 · 계정은 그대로', () => {
  const db = withDatabase('postgresql://u:p%40s@localhost:5432/notion?sslmode=disable', 'notion_e2e')
  assert.equal(db, 'postgresql://u:p%40s@localhost:5432/notion_e2e?sslmode=disable')
  assert.equal(databaseOf(db), 'notion_e2e')
  assert.equal(withRedisDb('redis://localhost:6379', 1), 'redis://localhost:6379/1')
  assert.equal(withRedisDb('redis://localhost:6379/0', 1), 'redis://localhost:6379/1')
})

test('DB 이름은 SQL 에 따옴표 없이 들어가므로 소문자 · 숫자 · 밑줄만 · Valkey 번호는 0~15', () => {
  assert.throws(() => withDatabase('postgresql://localhost/notion', 'x; DROP DATABASE notion'), /DB 이름/)
  assert.throws(() => withDatabase('postgresql://localhost/notion', 'Notion'), /DB 이름/)
  assert.throws(() => withRedisDb('redis://localhost:6379', 16), /0~15/)
})

test('★ 절을 끝낸 예외 한 줄 — 메시지(여러 줄은 편다)와 스크립트 안의 자리', () => {
  const thrown = new Error('evaluate: TypeError: Cannot read properties of null\n    at <anonymous>:3:45 — 그때 문서 {"readyState":"loading"}')
  thrown.stack = [
    'Error: evaluate: …',
    '    at evaluate (file:///C:/VibeCoding/notion/scripts/e2e-editor.mjs:472:13)',
    '    at async Object.waitFor (file:///C:/VibeCoding/notion/scripts/e2e-editor.mjs:481:13)',
    '    at async main (file:///C:/VibeCoding/notion/scripts/e2e-editor.mjs:18175:11)',
    '    at async file:///C:/VibeCoding/notion/scripts/e2e-editor.mjs:21087:3',
  ].join('\n')
  assert.equal(
    thrownDetail(thrown),
    'evaluate: TypeError: Cannot read properties of null ⏎ at <anonymous>:3:45 — 그때 문서 {"readyState":"loading"} (e2e-editor.mjs:18175)',
    '도우미 안의 던진 줄이 아니라 게이트가 사는 main 의 줄',
  )
  const helperOnly = new Error('도우미 밖 없음')
  helperOnly.stack = 'Error\n    at evaluate (file:///C:/x/scripts/e2e-editor.mjs:472:13)\n    at other (file:///C:/x/scripts/other.mjs:9:1)'
  assert.equal(thrownDetail(helperOnly), '도우미 밖 없음 (e2e-editor.mjs:472)', 'main 의 프레임이 없으면 스크립트의 첫 프레임')
  assert.equal(thrownDetail(new Error('스택 없음')).startsWith('스택 없음'), true)
  assert.equal(thrownDetail('문자열'), '문자열')
})

test('★ 몸을 `{ try {` 로 열지 않는 게이트를 찾는다', () => {
  const source = [
    `if (sectionIf('감싼 절 (1a)')) { try {`,
    '  check()',
    '} catch (thrown) { await sectionThrew(thrown) } }',
    `if (sectionIf('맨 절 (1b)')) {`,
    '}',
    `function sectionIf(title) {`,
  ].join('\n')
  assert.deepEqual(unguardedGates(source), ['맨 절 (1b)'])
})

test('★ 실제 e2e 스크립트의 게이트는 모두 감쌌다 — 한 절의 예외가 판 전체를 끝내지 않게(도구-5)', () => {
  const source = readFileSync(new URL('../../../scripts/e2e-editor.mjs', import.meta.url), 'utf8')
  const gates = [...source.matchAll(/sectionIf\(\s*'([^']+)'/g)].length
  assert.ok(gates > 200, `게이트 ${gates}개`)
  assert.deepEqual(unguardedGates(source), [])
  const closings = source.split('\n').filter((line) => line.trim() === '} catch (thrown) { await sectionThrew(thrown) } }').length
  assert.equal(closings, gates, '닫는 줄도 게이트마다 하나')
})
