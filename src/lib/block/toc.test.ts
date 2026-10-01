/**
 * 목차의 규칙 — 잔여 묶음 8b-1 (F-01-16 · 순수 · DOM · DB 없음)
 *
 * 이 파일이 지키는 것(`toc.ts` 머리말의 규칙).
 *
 *   ① ★ 모든 헤딩 — 토글 · 목록 · 콜아웃 안까지 문서 순서로(앞에서부터 깊이 우선)
 *   ② ★ 글자가 없는 헤딩은 빼고, 멘션 · 수식만 있는 헤딩은 남긴다
 *   ③ ★ 들여쓰기는 쓰인 수준의 순위 — 제목 3 만 있으면 맨 왼쪽 · 제목 1 · 3 이면 3 은 한 칸
 *   ④ 같은 제목이 여럿이어도 블록 id 로 갈린다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_ANNOTATIONS, textRun, type RichTextRun } from '../contracts/rich-text.ts'
import { headingLevelOf, headingsOfBlocks, hasTocLabel, tocEntries, type TocHeading } from './toc.ts'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

type Block = { id: string; type: string; title?: RichTextRun[]; children?: Block[] }
const blk = (type: string, text = '', children: Block[] = []): Block => ({ id: nextId(), type, title: text === '' ? [] : [textRun(text)], children })
const mentionRun: RichTextRun = {
  type: 'mention',
  annotations: { ...DEFAULT_ANNOTATIONS },
  plain_text: '',
  href: null,
  mention: { type: 'page', page: { id: '00000000-0000-4000-8000-00000000abcd' } },
}
const equationRun: RichTextRun = {
  type: 'equation',
  annotations: { ...DEFAULT_ANNOTATIONS },
  plain_text: 'x^2',
  href: null,
  equation: { expression: 'x^2' },
}
const heading = (level: 1 | 2 | 3, text: string): TocHeading => ({ id: nextId(), level, title: text === '' ? [] : [textRun(text)] })

describe('① 모으기', () => {
  test('★ 토글 · 목록 · 콜아웃 안의 헤딩까지 문서 순서로 — 앞에서부터 깊이 우선', () => {
    const blocks: Block[] = [
      blk('heading_1', 'A'),
      blk('toggle', '토글', [blk('heading_2', 'B'), blk('paragraph', '문단', [blk('heading_3', 'C')])]),
      blk('bulleted_list_item', '항목', [blk('heading_2', 'D')]),
      blk('callout', '콜아웃', [blk('heading_3', 'E')]),
      blk('heading_1', 'F'),
      blk('page', ''),
    ]
    assert.deepEqual(
      headingsOfBlocks(blocks).map((h) => [h.level, h.title.map((r) => r.plain_text).join('')]),
      [[1, 'A'], [2, 'B'], [3, 'C'], [2, 'D'], [3, 'E'], [1, 'F']],
    )
  })

  test('헤딩 수준 — 제목 1~3 만, 나머지는 null', () => {
    assert.equal(headingLevelOf('heading_1'), 1)
    assert.equal(headingLevelOf('heading_3'), 3)
    for (const type of ['paragraph', 'heading_4', 'toggle', 'table_of_contents', '__proto__', 'constructor']) assert.equal(headingLevelOf(type), null, type)
  })
})

describe('② 이름 없는 헤딩', () => {
  test('★ 비었거나 공백뿐인 헤딩은 빼고 · 멘션 · 수식만 있는 헤딩은 남긴다', () => {
    const empty = heading(1, '')
    const blank = heading(2, '  \n ')
    const onlyMention: TocHeading = { id: nextId(), level: 2, title: [mentionRun] }
    const onlyEquation: TocHeading = { id: nextId(), level: 2, title: [equationRun] }
    const kept = tocEntries([empty, blank, onlyMention, onlyEquation])
    assert.deepEqual(kept.map((e) => e.id), [onlyMention.id, onlyEquation.id])
    assert.equal(hasTocLabel([]), false)
    assert.equal(hasTocLabel([textRun(' ')]), false)
    assert.equal(hasTocLabel([textRun(' a ')]), true)
  })
})

describe('③ 들여쓰기', () => {
  test('★ 쓰인 수준의 순위 — 제목 3 만 있으면 맨 왼쪽', () => {
    assert.deepEqual(tocEntries([heading(3, 'a'), heading(3, 'b')]).map((e) => e.depth), [0, 0])
  })

  test('★ 제목 1 · 3 만 있으면 3 은 한 칸 · 셋 다 있으면 두 칸', () => {
    assert.deepEqual(tocEntries([heading(1, 'a'), heading(3, 'b')]).map((e) => e.depth), [0, 1])
    assert.deepEqual(tocEntries([heading(1, 'a'), heading(2, 'b'), heading(3, 'c')]).map((e) => e.depth), [0, 1, 2])
    assert.deepEqual(tocEntries([heading(2, 'a'), heading(1, 'b'), heading(3, 'c')]).map((e) => e.depth), [1, 0, 2])
  })

  test('순위는 이름이 있는 헤딩으로만 센다 — 빈 제목 1 이 제목 2 를 밀지 않는다', () => {
    assert.deepEqual(tocEntries([heading(1, ''), heading(2, 'a')]).map((e) => e.depth), [0])
  })
})

describe('④ 자리', () => {
  test('같은 제목이 여럿이어도 블록 id 로 갈린다', () => {
    const a = heading(1, '같은 제목')
    const b = heading(1, '같은 제목')
    assert.deepEqual(tocEntries([a, b]).map((e) => e.id), [a.id, b.id])
  })
})
