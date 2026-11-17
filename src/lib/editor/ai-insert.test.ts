/**
 * AI 의 답을 본문에 넣기 · 빈 줄의 입구 (AI-2 · F-10-01 · DOM 없음)
 *
 *   ① 마크다운의 부분집합 → 블록(가져오기와 같은 변환 · 첫 `#` 도 헤딩)
 *   ② 받아들이기는 빈 줄을 바꾸고 · 아래에 넣기는 줄을 둔다 · 그 사이에 글이 생겼으면 지우지 않는다 · 자리가 사라졌으면 넣지 않는다 · 한 트랜잭션
 *   ③ 입구 — 빈 문단의 스페이스만 · 안내는 쓸 수 있을 때만
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'

import { textRun, toPlainText } from '../contracts/rich-text.ts'
import { FAKE_AI_MARKDOWN } from '../testing/fake-ai-provider.ts'
import { aiAnswerBlocks, insertAiBlocksCommand } from './ai-insert.ts'
import { aiHintKey, aiHintPlugin, aiSpaceCommand, emptyParagraphAt } from './ai-trigger.ts'
import type { EditorBlock } from './document.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { findContainerById } from './pm-blocks.ts'
import { blockSchema } from './schema.ts'

const blk = (type: EditorBlock['type'], text: string, children: EditorBlock[] = []): EditorBlock => ({
  id: randomUUID(),
  type,
  title: text === '' ? [] : [textRun(text)],
  properties: {},
  format: {},
  children,
})

const stateOf = (blocks: EditorBlock[], plugins = [aiHintPlugin(() => true)]) => EditorState.create({ schema: blockSchema, doc: docToPm({ blocks }), plugins })

/** 그 블록의 글 끝에 캐럿. */
function caretIn(state: EditorState, id: string): EditorState {
  const info = findContainerById(state.doc, id)!
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, info.contentPos + 1 + info.contentNode.content.size)))
}

const shape = (state: EditorState) => pmToDoc(state.doc).blocks.map((b) => `${b.type}:${toPlainText(b.title ?? [])}${b.type === 'to_do' ? `:${(b.properties as { checked?: boolean }).checked === true}` : ''}`)

describe('① 답 → 블록', () => {
  test('★ 헤딩 · 문단 · 글머리표 · 할 일 — 가져오기의 변환 그대로 · 첫 # 도 헤딩으로 둔다', () => {
    const blocks = aiAnswerBlocks(FAKE_AI_MARKDOWN)
    assert.deepEqual(blocks.map((b) => `${b.type}:${toPlainText(b.title ?? [])}`), [
      'heading_2:회의 요약',
      'paragraph:오늘 정한 것입니다.',
      'bulleted_list_item:첫째 안건',
      'bulleted_list_item:둘째 안건',
      'paragraph:다음 할 일:',
      'to_do:다음 회의 잡기',
    ])
    const h1 = aiAnswerBlocks('# 큰 제목\n\n- [x] 끝낸 일\n\n> 인용\n\n```js\nlet a = 1\n```\n\n1. 하나\n\n**굵게** 와 [링크](https://example.com)')
    assert.deepEqual(h1.map((b) => b.type), ['heading_1', 'to_do', 'quote', 'code', 'numbered_list_item', 'paragraph'])
    assert.equal((h1[1]!.properties as { checked?: boolean }).checked, true)
    const runs = h1[5]!.title ?? []
    assert.ok(runs.some((r) => r.annotations?.bold) && runs.some((r) => r.type === 'text' && r.text?.link?.url === 'https://example.com'))
    assert.deepEqual(aiAnswerBlocks('  \n'), [])
  })
})

describe('② 넣기', () => {
  const answer = aiAnswerBlocks('## 제목\n\n- 하나\n- 둘')

  test('★ 받아들이기 — 빈 줄을 블록들로 바꾼다 · 한 트랜잭션 · 캐럿은 넣은 끝 · 새 id', () => {
    const anchor = blk('paragraph', '')
    const state = caretIn(stateOf([blk('paragraph', '앞'), anchor, blk('paragraph', '뒤')]), anchor.id)
    const trs: Transaction[] = []
    assert.ok(insertAiBlocksCommand(anchor.id, answer, 'replace')(state, (tr) => trs.push(tr)))
    assert.equal(trs.length, 1, '되돌리기 한 번에 다 빠진다')
    const next = state.apply(trs[0]!)
    assert.deepEqual(shape(next), ['paragraph:앞', 'heading_2:제목', 'bulleted_list_item:하나', 'bulleted_list_item:둘', 'paragraph:뒤'])
    assert.equal(next.selection.$from.parent.textContent, '둘', '캐럿은 넣은 마지막 블록')
    const ids = pmToDoc(next.doc).blocks.map((b) => b.id)
    assert.ok(!ids.includes(anchor.id) && !answer.some((b) => ids.includes(b.id)), '넣은 블록은 새 id')
  })

  test('★ 아래에 넣기 — 줄을 두고 아래에 · 그 사이에 글이 생긴 줄은 받아들여도 지우지 않는다 · 자리가 사라지면 넣지 않는다', () => {
    const anchor = blk('paragraph', '')
    const state = stateOf([anchor, blk('paragraph', '뒤')])
    let next = state
    assert.ok(insertAiBlocksCommand(anchor.id, answer, 'below')(state, (tr) => (next = state.apply(tr))))
    assert.deepEqual(shape(next), ['paragraph:', 'heading_2:제목', 'bulleted_list_item:하나', 'bulleted_list_item:둘', 'paragraph:뒤'])

    const typed = blk('paragraph', '누가 쓴 글')
    const s2 = stateOf([typed])
    let n2 = s2
    assert.ok(insertAiBlocksCommand(typed.id, answer, 'replace')(s2, (tr) => (n2 = s2.apply(tr))))
    assert.deepEqual(shape(n2).slice(0, 2), ['paragraph:누가 쓴 글', 'heading_2:제목'])

    assert.equal(insertAiBlocksCommand(randomUUID(), answer, 'replace')(s2, () => assert.fail('넣지 않는다')), false)
    assert.equal(insertAiBlocksCommand(typed.id, [], 'replace')(s2), false)
  })
})

describe('③ 입구', () => {
  test('★ 스페이스 — 빈 문단에서만 묻고 · 열지 않으면 키를 넘긴다 · 안내는 쓸 수 있을 때 캐럿의 빈 문단에만', () => {
    const empty = blk('paragraph', '')
    const full = blk('paragraph', '글')
    const heading = blk('heading_1', '')
    const base = stateOf([full, empty, heading])
    const asked: string[] = []
    const open = (id: string) => (asked.push(id), true)

    const onEmpty = caretIn(base, empty.id)
    assert.equal(emptyParagraphAt(onEmpty), empty.id)
    assert.equal(aiSpaceCommand(open)(onEmpty), true)
    assert.equal(aiSpaceCommand(() => false)(onEmpty), false, '열 수 없으면 스페이스는 글자다')
    assert.equal(aiSpaceCommand(open)(caretIn(base, full.id)), false)
    assert.equal(aiSpaceCommand(open)(caretIn(base, heading.id)), false, '빈 헤딩은 아니다')
    assert.deepEqual(asked, [empty.id])

    const deco = (s: EditorState) => aiHintKey.get(s)!.props.decorations!.call(aiHintKey.get(s)!, s)
    assert.ok(deco(onEmpty), '빈 문단에 안내')
    assert.equal(deco(caretIn(base, full.id)), null)
    const hidden = caretIn(stateOf([empty], [aiHintPlugin(() => false)]), empty.id)
    assert.equal(aiHintKey.get(hidden)!.props.decorations!.call(aiHintKey.get(hidden)!, hidden), null, 'AI 를 쓸 수 없으면 안내가 없다')
  })
})
