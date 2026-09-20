/**
 * 복제의 id 재매핑 규칙 — 복제 6a조각 (F-02-09 · F-08-01, DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **안쪽은 사본을, 바깥은 원본을 가리킨다** — 이 조각이 고정하는 규칙이다(마스터 §5.2-6)
 *   ② 블록 id 는 전부 새로 받는다. **하위 페이지 참조만 예외** — 그 id 는 그 페이지의 id 다
 *   ③ 복제하지 않은 하위 페이지의 참조는 **뺀다**(볼 수 없어서 · 상한에 걸려서)
 *   ④ 사람 멘션 · 수식 · 링크 · 그 밖의 프로퍼티는 그대로다 — 복제해도 같은 사람이고 같은 주소다
 *   ⑤ rich text 는 `title` 과 `caption` 둘 다에서 훑는다
 *   ⑥ 사본의 제목에는 꼬리표가 붙고 **서식이 끊기지 않는다**
 *
 * 반사실(HANDOFF §3.3-172): 바깥 참조도 재매핑하면 ①, 하위 페이지 참조에 새 id 를 주면 ②, 복제하지 않은 참조를 남기면 ③,
 * 사람 멘션까지 훑으면 ④ 가 실패한다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { duplicateTitle, remapBody, COPY_SUFFIX } from './duplicate-remap.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { mentionTarget, pageMentionRun, textRun, userMentionRun, type RichTextRun } from '../contracts/rich-text.ts'

const INSIDE = '11111111-1111-4111-8111-111111111111'
const INSIDE_COPY = 'aaaaaaaa-1111-4111-8111-111111111111'
const OUTSIDE = '22222222-2222-4222-8222-222222222222'
const PERSON = '33333333-3333-4333-8333-333333333333'

const pages = new Map([[INSIDE, INSIDE_COPY]])

/** 결정론적인 새 id — 검사가 어느 자리에 무엇이 들어갔는지 말할 수 있게. */
function ids() {
  let n = 0
  return () => `new-${(n += 1)}`
}

const block = (over: Partial<EditorBlock> & { id: string }): EditorBlock => ({
  type: 'paragraph',
  title: [],
  ...over,
})

const doc = (...blocks: EditorBlock[]): EditorDoc => ({ blocks })

describe('① 안쪽은 사본을, 바깥은 원본을', () => {
  test('★ 페이지 멘션 — 서브트리 안이면 사본으로, 밖이면 원본 그대로', () => {
    const body = doc(block({ id: 'b1', title: [textRun('보기 '), pageMentionRun(INSIDE), pageMentionRun(OUTSIDE)] }))
    const out = remapBody(body, pages, ids())
    const runs = out.blocks[0].title
    assert.equal(mentionTarget(runs[1])?.id, INSIDE_COPY, '안쪽은 사본을 가리킨다')
    assert.equal(mentionTarget(runs[2])?.id, OUTSIDE, '바깥은 원본을 가리킨다')
    assert.equal(runs[0].plain_text, '보기 ', '글자는 그대로다')
  })

  test('멘션의 서식은 지킨다 — 굵게 쓴 멘션은 사본에서도 굵다', () => {
    const body = doc(block({ id: 'b1', title: [pageMentionRun(INSIDE, { bold: true, color: 'red' })] }))
    const run = remapBody(body, pages, ids()).blocks[0].title[0]
    assert.equal(mentionTarget(run)?.id, INSIDE_COPY)
    assert.equal(run.annotations.bold, true)
    assert.equal(run.annotations.color, 'red')
  })

  test('★ 사람 멘션은 재매핑하지 않는다 — 복제해도 같은 사람이다', () => {
    // 사람 id 가 우연히 맵에 있어도(있을 수 없지만) 페이지 멘션이 아니면 건드리지 않는다.
    const withPerson = new Map([...pages, [PERSON, 'somebody-else']])
    const body = doc(block({ id: 'b1', title: [userMentionRun(PERSON)] }))
    const run = remapBody(body, withPerson, ids()).blocks[0].title[0]
    assert.equal(mentionTarget(run)?.id, PERSON)
    assert.equal(mentionTarget(run)?.kind, 'user')
  })
})

describe('② · ③ 하위 페이지 참조', () => {
  test('★ 복제한 하위 페이지의 참조는 **사본의 id** 를 받는다 — 새 블록 id 가 아니다', () => {
    const body = doc(block({ id: INSIDE, type: 'page' }))
    const out = remapBody(body, pages, ids())
    assert.equal(out.blocks.length, 1)
    assert.equal(out.blocks[0].id, INSIDE_COPY)
    assert.equal(out.blocks[0].type, 'page')
  })

  test('★ 복제하지 않은 하위 페이지의 참조는 뺀다 — 사본이 남의 페이지를 매달 수 없다', () => {
    const body = doc(block({ id: OUTSIDE, type: 'page' }), block({ id: 'b1', title: [textRun('남는다')] }))
    const out = remapBody(body, pages, ids())
    assert.deepEqual(out.blocks.map((b) => b.type), ['paragraph'])
  })

  test('★ 그 밖의 블록 id 는 전부 새로 받는다 — 원본과 겹치지 않는다', () => {
    const body = doc(
      block({ id: 'b1', children: [block({ id: 'b2' }), block({ id: INSIDE, type: 'page' })] }),
      block({ id: 'b3' }),
    )
    const out = remapBody(body, pages, ids())
    assert.equal(out.blocks[0].id, 'new-1')
    assert.equal(out.blocks[0].children?.[0].id, 'new-2', '자식도 새 id 를 받는다')
    assert.equal(out.blocks[0].children?.[1].id, INSIDE_COPY, '자식 안의 하위 페이지 참조도 사본 id')
    assert.equal(out.blocks[1].id, 'new-3')
  })
})

describe('④ · ⑤ 프로퍼티', () => {
  test('★ caption 의 페이지 멘션도 훑는다', () => {
    const body = doc(
      block({ id: 'b1', type: 'image', properties: { source: { type: 'external', url: 'https://x/y.png' }, caption: [pageMentionRun(INSIDE)] } }),
    )
    const props = remapBody(body, pages, ids()).blocks[0].properties as { caption: RichTextRun[]; source: unknown }
    assert.equal(mentionTarget(props.caption[0])?.id, INSIDE_COPY)
    assert.deepEqual(props.source, { type: 'external', url: 'https://x/y.png' }, '파일 · 주소는 그대로다(참조를 공유한다)')
  })

  test('rich text 가 아닌 프로퍼티는 손대지 않는다 — 보존된 원본(unsupported)도 그대로', () => {
    const original = { checked: true, raw: { type: 'video', url: 'https://v' } }
    const body = doc(block({ id: 'b1', type: 'to_do', properties: original }))
    assert.deepEqual(remapBody(body, pages, ids()).blocks[0].properties, original)
  })

  test('프로퍼티가 없으면 없는 채로 둔다 — 빈 객체를 만들지 않는다', () => {
    const out = remapBody(doc(block({ id: 'b1' })), pages, ids())
    assert.equal('properties' in out.blocks[0], false)
  })
})

describe('⑥ 사본의 제목', () => {
  test('★ 꼬리표를 마지막 런에 이어 붙인다 — 서식이 끊기지 않는다', () => {
    const title = [textRun('기획', { bold: true })]
    const out = duplicateTitle(title)
    assert.equal(out.length, 1, '런을 더하지 않는다')
    // ★ 꼬리표를 **글자 그대로** 본다. `COPY_SUFFIX` 로 비교하면 그 상수를 비워도 검사가 따라 비어 통과한다(반사실이 짚었다).
    assert.equal(COPY_SUFFIX, ' (1)')
    assert.equal(out[0].text?.content, '기획 (1)')
    assert.equal(out[0].plain_text, '기획 (1)')
    assert.equal(out[0].annotations.bold, true)
  })

  test('빈 제목이면 꼬리표만 — 사본임을 말해 주는 유일한 자리다', () => {
    const out = duplicateTitle([])
    assert.equal(out.length, 1)
    assert.equal(out[0].plain_text, ' (1)')
  })

  test('마지막이 글자 런이 아니면(멘션으로 끝나면) 런을 더한다', () => {
    const out = duplicateTitle([pageMentionRun(INSIDE)])
    assert.equal(out.length, 2)
    assert.equal(out[1].text?.content, COPY_SUFFIX)
    assert.equal(mentionTarget(out[0])?.id, INSIDE, '앞의 멘션은 그대로다')
  })

  test('원본 배열을 바꾸지 않는다', () => {
    const title = [textRun('원본')]
    duplicateTitle(title)
    assert.equal(title[0].text?.content, '원본')
  })
})
