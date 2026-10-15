/**
 * 페이지 안 찾기 — 문서 모델에서 찾기 · 데코레이션 (플랫폼 잔여 10b · F-07-05)
 *
 *   ① 블록마다 · 서식을 넘어(한 블록 안의 텍스트 노드는 이어진다) · 대소문자를 가리지 않는다 · 한글
 *   ② ★ 블록을 넘지 않는다 · 원자(멘션)를 넘지 않는다 — 자리는 그 원자 뒤로 맞는다
 *   ③ 겹치지 않게 · 상한 · 빈 말 · 자리표시 글자로는 찾지 않는다 · 길이가 달라지는 소문자
 *   ④ ★ 접힌 조상 — 자식 묶음 안이면 숨겨졌다(토글의 제목 줄은 아니다) · 바깥에서 안쪽 순
 *   ⑤ ★ 플러그인 — 캐럿 뒤의 첫 매칭 · 다음 · 이전(돌아 감는다) · 지금 것만 진하게 · 문서가 바뀌면 지금 매칭이 자리를 따라간다 · 빈 말이면 끝
 *   ⑥ 카운터
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'

import { textRun, userMentionRun, type RichTextRun } from '../contracts/rich-text.ts'
import type { BlockType } from '../block/types.ts'
import { docToPm } from './pm-adapter.ts'
import { blockSchema } from './schema.ts'
import type { EditorBlock } from './document.ts'
import {
  FIND_CURRENT_CLASS,
  MAX_FIND_MATCHES,
  collapsedAncestorsAt,
  findCounter,
  findMatches,
  findPlugin,
  findStateOf,
  matchIndexFrom,
  setFindQuery,
  stepFind,
  stepIndex,
} from './find-in-page.ts'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

function blk(id: string, type: BlockType, title: RichTextRun[] | string, children: EditorBlock[] = []): EditorBlock {
  return { id, type, title: typeof title === 'string' ? (title === '' ? [] : [textRun(title)]) : title, properties: {}, format: {}, children }
}
const para = (title: RichTextRun[] | string, children: EditorBlock[] = []) => blk(nextId(), 'paragraph', title, children)
const docOf = (...blocks: EditorBlock[]) => docToPm({ blocks })
const texts = (doc: PmNode, query: string) => findMatches(doc, query).map((m) => doc.textBetween(m.from, m.to))

test('① 블록마다 · 서식을 넘어 · 대소문자 · 한글', () => {
  const doc = docOf(para([textRun('사과 '), textRun('Apple', { bold: true }), textRun('pie')]), para('APPLE 사과'))
  assert.deepEqual(texts(doc, 'apple'), ['Apple', 'APPLE'])
  assert.deepEqual(texts(doc, 'applepie'), ['Applepie'], '한 블록의 텍스트 노드는 이어진다(서식이 갈라도)')
  assert.deepEqual(texts(doc, '사과'), ['사과', '사과'])
  assert.deepEqual(texts(doc, 'e 사'), ['E 사'], '공백도 찾는 말이다')
})

test('② ★ 블록을 넘지 않는다 · 원자를 넘지 않는다', () => {
  const doc = docOf(para('xab'), para('cdx'))
  assert.deepEqual(findMatches(doc, 'abcd'), [], '블록을 넘는 매칭은 없다')
  const person = '0190a3f1-1111-7000-8000-000000000001'
  const withMention = docOf(para([textRun('가'), userMentionRun(person), textRun('나다')]))
  assert.deepEqual(findMatches(withMention, '가나'), [], '멘션을 건너 이어 붙이지 않는다')
  assert.deepEqual(texts(withMention, '나다'), ['나다'], '원자 뒤의 자리가 맞다')
})

test('③ 겹치지 않게 · 상한 · 빈 말 · 자리표시 · 길이가 달라지는 소문자', () => {
  assert.equal(findMatches(docOf(para('aaaa')), 'aa').length, 2, '겹치지 않게')
  assert.equal(findMatches(docOf(para('a'.repeat(MAX_FIND_MATCHES + 200))), 'a').length, MAX_FIND_MATCHES)
  assert.deepEqual(findMatches(docOf(para('abc')), ''), [])
  assert.deepEqual(findMatches(docOf(para([textRun('가'), userMentionRun('0190a3f1-1111-7000-8000-000000000001')])), '￼'), [], '원자의 자리표시로는 찾지 않는다')
  // 'İ'.toLowerCase() 는 두 글자다 — 그 블록은 그대로 비교한다(자리가 어긋나지 않게)
  const turkish = docOf(para('İstanbul ist'))
  assert.deepEqual(texts(turkish, 'ist'), ['ist'])
  assert.deepEqual(texts(turkish, 'İst'), ['İst'])
})

test('④ ★ 접힌 조상 — 자식 묶음 안이면 숨겨졌다', () => {
  const [outer, inner] = [nextId(), nextId()]
  const doc = docOf(blk(outer, 'toggle', '열쇠 바깥', [blk(inner, 'toggle', '열쇠 안쪽', [para('열쇠 끝')])]))
  const [inOuterTitle, inInnerTitle, inLeaf] = findMatches(doc, '열쇠')
  const collapsed = (ids: string[]) => (id: string) => ids.includes(id)
  assert.deepEqual(collapsedAncestorsAt(doc, inOuterTitle!.from, collapsed([outer, inner])), [], '토글의 제목 줄은 숨겨지지 않았다')
  assert.deepEqual(collapsedAncestorsAt(doc, inInnerTitle!.from, collapsed([outer, inner])), [outer])
  assert.deepEqual(collapsedAncestorsAt(doc, inLeaf!.from, collapsed([outer, inner])), [outer, inner], '바깥에서 안쪽 순')
  assert.deepEqual(collapsedAncestorsAt(doc, inLeaf!.from, collapsed([inner])), [inner], '접힌 것만')
  assert.deepEqual(collapsedAncestorsAt(doc, inLeaf!.from, collapsed([])), [])
})

test('⑤ ★ 플러그인 — 캐럿 뒤 · 다음 · 이전 · 지금 것만 진하게 · 자리를 따라간다 · 끝', () => {
  let state = EditorState.create({ schema: blockSchema, doc: docOf(para('사과 하나'), para('사과 둘'), para('사과 셋')), plugins: [findPlugin()] })
  const apply = (tr: ReturnType<typeof state.tr.setMeta>) => {
    state = state.apply(tr)
    return findStateOf(state)
  }
  const all = findMatches(state.doc, '사과')
  assert.equal(all.length, 3)

  // 캐럿 뒤의 첫 매칭 — 둘째 블록에서 찾으면 둘째
  let find = apply(setFindQuery(state.tr, '사과', all[1]!.from))
  assert.equal(find.current, 1)
  assert.equal(find.decorations.find().length, 3)
  const classOf = (from: number) =>
    (find.decorations.find(from, from + 1)[0] as unknown as { type: { attrs: { class: string } } } | undefined)?.type.attrs.class ?? ''
  assert.ok(classOf(all[1]!.from).includes(FIND_CURRENT_CLASS), '지금 것은 진하게')
  assert.ok(!classOf(all[0]!.from).includes(FIND_CURRENT_CLASS))

  find = apply(stepFind(state.tr, 1))
  assert.equal(find.current, 2)
  find = apply(stepFind(state.tr, 1))
  assert.equal(find.current, 0, '끝에서 처음으로 돌아 감는다')
  find = apply(stepFind(state.tr, -1))
  assert.equal(find.current, 2, '처음에서 끝으로')

  // 문서가 바뀌면 다시 찾고 지금 매칭은 자리를 따라간다 — 앞에 글자를 넣어도 같은 매칭(셋째)
  find = apply(state.tr.insertText('사과 ', all[0]!.from))
  assert.equal(find.matches.length, 4, '새로 친 글자도 찾는다(서버를 묻지 않는다)')
  assert.equal(state.doc.textBetween(find.matches[find.current]!.from, find.matches[find.current]!.to + 2), '사과 셋', '지금 매칭이 셋째를 따라갔다')
  // 앞을 지워도 따라간다 — 자리가 앞으로 당겨진다(옛 자리 그대로 찾으면 그 뒤에 매칭이 없어 처음으로 돌아간다)
  find = apply(state.tr.delete(find.matches[0]!.from, find.matches[1]!.from))
  assert.equal(find.matches.length, 3)
  assert.equal(state.doc.textBetween(find.matches[find.current]!.from, find.matches[find.current]!.to + 2), '사과 셋', '앞을 지워도 셋째')
  // 지금 매칭을 지우면 그 뒤의 첫 매칭(없으면 처음)
  const current = find.matches[find.current]!
  find = apply(state.tr.delete(current.from, current.to))
  assert.equal(find.matches.length, 2)
  assert.equal(find.current, 0, '뒤에 없으면 처음으로')

  find = apply(setFindQuery(state.tr, ''))
  assert.deepEqual([find.query, find.matches.length, find.current, find.decorations.find().length], ['', 0, -1, 0], '빈 말이면 끝')
  find = apply(state.tr.insertText('사과', 1))
  assert.equal(find.matches.length, 0, '끝난 뒤에는 찾지 않는다')
})

test('⑥ 카운터 · 번호', () => {
  assert.equal(findCounter({ query: '', matches: [], current: -1 }), '')
  assert.equal(findCounter({ query: 'x', matches: [], current: -1 }), '0/0')
  assert.equal(findCounter({ query: 'x', matches: [{ from: 1, to: 2 }, { from: 3, to: 4 }], current: 1 }), '2/2')
  assert.equal(findCounter({ query: 'x', matches: Array.from({ length: MAX_FIND_MATCHES }, (_, i) => ({ from: i, to: i + 1 })), current: 0 }), `1/${MAX_FIND_MATCHES}+`)
  assert.equal(matchIndexFrom([], 5), -1)
  assert.equal(matchIndexFrom([{ from: 1, to: 2 }, { from: 9, to: 10 }], 5), 1)
  assert.equal(matchIndexFrom([{ from: 1, to: 2 }], 5), 0, '뒤에 없으면 처음')
  assert.equal(stepIndex(-1, 3, 1), 0)
  assert.equal(stepIndex(-1, 3, -1), 2)
  assert.equal(stepIndex(0, 0, 1), -1)
})
