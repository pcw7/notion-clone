/**
 * 화면 제목 — 플랫폼 잔여 10d-7a (F-12-13 · 정본 §3.1 [보강] 문서의 언어 · 화면 제목)
 *
 *   ① 틀 — `%s` 가 한 번 · 앱 이름으로 끝난다 · 기본값은 앱 이름
 *   ② 고정 화면의 이름 — 비지 않고 서로 다르다(탭에서 가려진다)
 *   ③ 공개 화면은 틀을 씌우지 않는다(absolute)
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { APP_NAME, ROOT_TITLE, SCREEN_TITLES, TITLE_TEMPLATE, publicTitle } from './screen-title.ts'

test('① 틀 — %s 가 한 번 · 앱 이름으로 끝난다 · 기본값은 앱 이름', () => {
  assert.equal(TITLE_TEMPLATE.split('%s').length, 2)
  assert.ok(TITLE_TEMPLATE.startsWith('%s') && TITLE_TEMPLATE.endsWith(APP_NAME), '화면의 이름이 먼저 — 탭이 좁으면 뒤가 잘린다')
  assert.deepEqual(ROOT_TITLE, { default: APP_NAME, template: TITLE_TEMPLATE })
})

test('② 고정 화면의 이름 — 비지 않고 서로 다르다', () => {
  const names = Object.values(SCREEN_TITLES)
  for (const name of names) assert.ok(name.trim().length > 0 && name === name.trim(), JSON.stringify(name))
  assert.equal(new Set(names).size, names.length)
  assert.ok(!names.includes(APP_NAME), '앱 이름과 같은 화면 이름은 기본값과 가려지지 않는다')
})

test('③ 공개 화면은 틀을 씌우지 않는다', () => {
  assert.deepEqual(publicTitle('여행 계획'), { absolute: '여행 계획' })
})
