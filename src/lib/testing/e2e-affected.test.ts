/**
 * 영향 기반 e2e 고르기 — 순수 함수 (e2e 도구 1조각 · DB 없음)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  changedLines,
  gatesAtLines,
  gatesUsingIds,
  gatesUsingRoute,
  isGlobalChange,
  nearestCarriers,
  onlyValue,
  parseGates,
  routePattern,
  staticTestIds,
} from './e2e-affected.ts'

const E2E = [
  `// 머리`, // 1
  `if (sectionIf('열 메뉴 (1a)')) {`, // 2
  `  await click('[data-testid="db-column-menu"]')`, // 3
  `  await send('Page.navigate', { url: \`\${BASE}/w/\${workspaceId}/db/\${db.id}\` })`, // 4
  `}`, // 5
  `if (sectionIf('메뉴 판 (1b)')) {`, // 6
  `  await waitFor('[data-testid="db-column-menu-panel"]')`, // 7
  `  await api('POST', \`/views/\${view}/rows\`, {})`, // 8
  `  await send('Page.navigate', { url: \`\${BASE}/w/\${workspaceId}\` })`, // 9
  `}`, // 10
].join('\n')

test('게이트 — sectionIf 제목마다 · 다음 게이트 앞까지', () => {
  const gates = parseGates(E2E)
  assert.deepEqual(gates.map((g) => g.title), ['열 메뉴 (1a)', '메뉴 판 (1b)'])
  assert.equal(gates[0].end, gates[1].start)
  assert.equal(gates[1].end, E2E.length)
})

test('정적 testid — 큰따옴표 · 중괄호 안 문자열 · testId 속성 · 식으로 만든 것은 못 본다', () => {
  const source = [
    `<div data-testid="db-a" />`,
    `<Item testId="db-b" />`,
    `<span data-testid={'db-c'} />`,
    `<span data-testid={"db-d"} />`,
    `<div data-testid={testId} />`,
    `<div data-testid={\`db-\${kind}\`} />`,
    `<div data-testid="db-a" />`,
  ].join('\n')
  assert.deepEqual(staticTestIds(source), ['db-a', 'db-b', 'db-c', 'db-d'])
})

test('★ testid 는 온전히만 — db-column-menu 는 db-column-menu-panel 에 걸리지 않는다', () => {
  const gates = parseGates(E2E)
  assert.deepEqual([...gatesUsingIds(E2E, gates, ['db-column-menu']).keys()], ['열 메뉴 (1a)'])
  assert.deepEqual([...gatesUsingIds(E2E, gates, ['db-column-menu-panel']).keys()], ['메뉴 판 (1b)'])
  assert.deepEqual([...gatesUsingIds(E2E, gates, ['db-column']).keys()], [])
})

test('★ 주소 — 동적 조각은 템플릿 자리에 · 페이지는 거기서 끝나야 · 레이아웃은 그 아래 전부', () => {
  const gates = parseGates(E2E)
  const page = (p: string) => [...gatesUsingRoute(E2E, gates, p).keys()]
  assert.deepEqual(page('w/[workspaceId]/db/[databaseId]/page.tsx'), ['열 메뉴 (1a)'])
  // 워크스페이스 첫 화면은 /w/x 로 끝나는 곳만 — /w/x/db/y 는 아니다
  assert.deepEqual(page('w/[workspaceId]/page.tsx'), ['메뉴 판 (1b)'])
  // 레이아웃은 그 아래 주소 전부
  assert.deepEqual(page('w/[workspaceId]/layout.tsx'), ['열 메뉴 (1a)', '메뉴 판 (1b)'])
  // API 는 워크스페이스 접두 뒤만
  assert.deepEqual(page('api/workspaces/[workspaceId]/views/[viewId]/rows/route.ts'), ['메뉴 판 (1b)'])
  assert.deepEqual(page('api/workspaces/[workspaceId]/views/[viewId]/route.ts'), [])
})

test('주소 모양 — 묶음 · 슬롯은 주소에 없다 · 나머지 조각 · 남는 조각이 없으면 null', () => {
  assert.ok(routePattern('(auth)/login/page.tsx')?.test(`goto(\`\${BASE}/login\`)`))
  assert.ok(routePattern('docs/[...slug]/page.tsx')?.test(`'/docs/a/b'`))
  assert.ok(routePattern('w/[workspaceId]/@modal/page.tsx')?.test(`\`/w/\${id}\``))
  assert.equal(routePattern('page.tsx'), null)
  assert.equal(routePattern('api/workspaces/[workspaceId]/route.ts'), null)
})

test('e2e 에서 바뀐 줄 — diff 머리의 새 쪽 줄 → 그 줄을 품은 게이트', () => {
  const diff = ['@@ -3 +3 @@', '-a', '+b', '@@ -20,0 +21,2 @@', '+c', '+d', '@@ -30,2 +32,0 @@', '-e', '-f'].join('\n')
  assert.deepEqual(changedLines(diff), [3, 21, 22, 32])
  const gates = parseGates(E2E)
  const found = gatesAtLines(E2E, gates, [1, 3, 8, 99])
  assert.deepEqual([...found.reasons.keys()], ['열 메뉴 (1a)', '메뉴 판 (1b)'])
  // 1번 줄은 첫 게이트 앞이지만 주석이다 — 아무 절도 다르게 돌지 않는다 · 없는 줄(99)은 버린다
  assert.deepEqual(found.outside, [])
  // 첫 게이트 앞의 코드(모든 절이 쓰는 도우미)는 따로 돌려준다 — 주석 · 빈 줄 · 블록 주석의 줄은 빼고
  const head = [`/**`, ` * 머리`, ` */`, ``, `const click = () => {}`, `// 끝`, E2E].join('\n')
  assert.deepEqual(gatesAtLines(head, parseGates(head), [1, 2, 3, 4, 5, 6]).outside, [5])
})

test('★ 거슬러 올라가기 — testid 를 가진 가장 가까운 파일에서 멈추고 · 지나며 만난 페이지를 모은다', () => {
  // lib → layer(testid 없음) → menu(testid) → table(testid) → page
  const importers: Record<string, string[]> = {
    lib: ['layer', 'server'],
    layer: ['menu', 'picker'],
    menu: ['table'],
    picker: ['table'],
    table: ['page'],
    server: ['route'],
  }
  const ids = new Set(['menu', 'picker', 'table'])
  const routes = new Set(['page', 'route'])
  const found = nearestCarriers(['lib'], (f) => importers[f] ?? [], (f) => ids.has(f), (f) => routes.has(f))
  assert.deepEqual([...found.carriers].sort(), ['menu', 'picker'])
  assert.deepEqual([...found.routes], ['route'])
  // 바꾼 파일이 testid 를 가졌으면 그 자리에서 멈춘다
  const direct = nearestCarriers(['table'], (f) => importers[f] ?? [], (f) => ids.has(f), (f) => routes.has(f))
  assert.deepEqual([...direct.carriers], ['table'])
  assert.deepEqual([...direct.routes], [])
})

test('전역 바꿈 — 마이그레이션 · 협업 서버 · 의존성(잠금 파일) · 뿌리 레이아웃 · 뿌리 CSS', () => {
  for (const p of ['db/migrations/0107_x.sql', 'scripts/collab-server.mjs', 'package-lock.json', 'next.config.ts', 'src/app/layout.tsx', 'src/app/globals.css']) {
    assert.ok(isGlobalChange(p), p)
  }
  // package.json 은 스크립트 한 줄로도 바뀐다 — 의존성은 잠금 파일이 말한다
  for (const p of ['package.json', 'src/app/w/[workspaceId]/layout.tsx', 'src/lib/ui/anchor-position.ts', 'docs/HANDOFF.md', 'scripts/e2e-editor.mjs']) {
    assert.ok(!isGlobalChange(p), p)
  }
})

test('E2E_ONLY 값 — 제목을 쉼표로 · 쉼표가 든 제목은 던진다', () => {
  assert.equal(onlyValue(['가 (1a)', '나 (1b)']), '가 (1a),나 (1b)')
  assert.throws(() => onlyValue(['가, 나']), /쉼표/)
})
