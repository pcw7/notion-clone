/**
 * 화면 제목 — 플랫폼 잔여 10d-7a (F-12-13 · 정본 §3.1 [보강] 문서의 언어 · 화면 제목)
 *
 *   ① 틀 — `%s` 가 한 번 · 앱 이름으로 끝난다 · 기본값은 앱 이름
 *   ② 고정 화면의 이름 — 비지 않고 서로 다르다(탭에서 가려진다)
 *   ③ 공개 화면은 틀을 씌우지 않는다(absolute)
 *   ④ 내용의 이름(10d-7b) — 공백을 접고 · 비면 "제목 없음" · 80자에서 자른다(글자 단위) · 템플릿 편집
 *   ⑤ 전체 제목(10d-7b) — 틀의 %s 에 이름
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  APP_NAME,
  MAX_TITLE_CHARS,
  ROOT_TITLE,
  SCREEN_TITLES,
  TITLE_TEMPLATE,
  UNTITLED_TITLE,
  contentTitle,
  fullTitle,
  publicTitle,
  templateTitle,
} from './screen-title.ts'

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

test('④ 내용의 이름 — 공백을 접고 · 비면 "제목 없음" · 80자에서 자른다', () => {
  assert.equal(contentTitle('여행 계획'), '여행 계획')
  assert.equal(contentTitle('  여행\n\t계획  '), '여행 계획', '줄바꿈 · 탭 · 겹친 공백을 접는다')
  assert.equal(contentTitle(''), UNTITLED_TITLE)
  assert.equal(contentTitle('   '), UNTITLED_TITLE)
  const long = '가'.repeat(MAX_TITLE_CHARS + 20)
  const cut = contentTitle(long)
  assert.equal([...cut].length, MAX_TITLE_CHARS)
  assert.ok(cut.endsWith('…'))
  assert.equal(contentTitle('가'.repeat(MAX_TITLE_CHARS)), '가'.repeat(MAX_TITLE_CHARS), '딱 80자는 그대로')
  const emoji = '😀'.repeat(MAX_TITLE_CHARS + 1)
  assert.equal([...contentTitle(emoji)].length, MAX_TITLE_CHARS, '서로게이트 쌍을 가르지 않는다')
  assert.equal(templateTitle('작업'), '템플릿 — 작업')
  assert.equal(templateTitle(''), `템플릿 — ${UNTITLED_TITLE}`)
})

test('⑤ 전체 제목 — 틀의 %s 에 이름', () => {
  assert.equal(fullTitle('여행 계획'), '여행 계획 · notion-clone')
  assert.equal(fullTitle(SCREEN_TITLES.workspaces), `워크스페이스 · ${APP_NAME}`)
  assert.equal(fullTitle('100% 완료'), '100% 완료 · notion-clone', '이름 속의 % 는 그대로')
  assert.equal(fullTitle('$& 비용 $1'), '$& 비용 $1 · notion-clone', '이름 속의 치환 패턴은 그대로')
})
