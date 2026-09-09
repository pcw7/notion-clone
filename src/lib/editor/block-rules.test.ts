/**
 * Enter 분할 · Backspace 병합 규칙 — F-01-19
 *
 * §7-4 가 "자식이 사라지는 것이 최빈 버그"라고 못박았으므로 **자식이 어떻게
 * 되는가**를 거의 모든 케이스에서 확인한다. 규칙 표(정본 F-01-19)의 행 하나에
 * 테스트 하나씩 대응시켰다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { textRun, type RichTextRun } from '../contracts/rich-text.ts'
import type { BlockType } from '../block/types.ts'
import { planMerge, planSplit, type RuleBlock } from './block-rules.ts'

function blk(type: BlockType, text = '', extra: Partial<RuleBlock> = {}): RuleBlock {
  return {
    type,
    title: text === '' ? [] : [textRun(text)],
    hasChildren: false,
    collapsed: false,
    ...extra,
  }
}

// ── 분할 ──────────────────────────────────────────────────────────────

describe('planSplit — 새 블록의 타입 (정본 규칙 표 1행)', () => {
  test('리스트는 타입을 이어간다 — Enter 로 리스트가 계속된다', () => {
    for (const type of ['bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle'] as const) {
      const plan = planSplit(blk(type, '항목'), 2)
      assert.equal(plan.kind, 'split')
      if (plan.kind === 'split') assert.equal(plan.newType, type)
    }
  })

  test('heading · quote · callout 은 paragraph 가 된다', () => {
    for (const type of ['heading_1', 'heading_2', 'heading_3', 'quote', 'callout'] as const) {
      const plan = planSplit(blk(type, '제목'), 2)
      assert.equal(plan.kind, 'split')
      if (plan.kind === 'split') assert.equal(plan.newType, 'paragraph')
    }
  })

  test('to_do 를 쪼개면 새 블록은 checked=false 다 — 완료 표시를 복제하지 않는다', () => {
    const done = blk('to_do', '완료한 일', { properties: { checked: true } })
    const plan = planSplit(done, 2)
    assert.equal(plan.kind, 'split')
    if (plan.kind === 'split') {
      assert.equal(plan.newType, 'to_do')
      assert.equal(plan.newProperties.checked, false)
    }
  })

  test('block_color 는 상속하고, 색을 지원하지 않는 타입으로 바뀌면 버린다', () => {
    const colored = blk('bulleted_list_item', '색깔', { format: { block_color: 'red_background' } })
    const kept = planSplit(colored, 2)
    assert.equal(kept.kind, 'split')
    if (kept.kind === 'split') assert.equal(kept.newFormat.block_color, 'red_background')

    // callout → paragraph 는 둘 다 색을 지원하므로 유지된다.
    const callout = blk('callout', '안내', { format: { block_color: 'blue' } })
    const converted = planSplit(callout, 2)
    if (converted.kind === 'split') assert.equal(converted.newFormat.block_color, 'blue')
  })
})

describe('planSplit — 자식의 귀속 (정본 규칙 표 2행 · §7-4 최빈 버그)', () => {
  test('자식을 절대 옮기지 않는다', () => {
    const parent = blk('bulleted_list_item', '부모', { hasChildren: true })
    for (let offset = 0; offset <= 2; offset += 1) {
      const plan = planSplit(parent, offset)
      assert.equal(plan.kind, 'split')
      if (plan.kind === 'split') {
        assert.equal(plan.movesChildren, false, `offset=${offset} 에서 자식을 옮기려 했다`)
      }
    }
  })

  test('자식이 없으면 새 블록은 형제다', () => {
    const plan = planSplit(blk('paragraph', '문단'), 2)
    if (plan.kind === 'split') assert.equal(plan.newPlacement, 'sibling_after')
  })

  test('펼쳐진 자식이 있으면 새 블록은 첫 자식이다 — 자식들 아래로 밀리지 않게', () => {
    const parent = blk('bulleted_list_item', '부모', { hasChildren: true, collapsed: false })
    const plan = planSplit(parent, 2)
    if (plan.kind === 'split') assert.equal(plan.newPlacement, 'first_child')
  })

  test('접힌 자식이 있으면 형제다 — 자식이 화면에 없으므로 형제가 곧 다음 줄이다', () => {
    const parent = blk('toggle', '접힌 토글', { hasChildren: true, collapsed: true })
    const plan = planSplit(parent, 2)
    if (plan.kind === 'split') assert.equal(plan.newPlacement, 'sibling_after')
  })

  test('자식을 가질 수 없는 타입은 자식이 있다고 표시돼도 형제로 넣는다', () => {
    // heading 은 canHaveChildren=false 다. 방어적으로 형제를 고른다 —
    // first_child 를 돌려주면 호출자가 만들 수 없는 구조를 만들려 한다.
    const heading = blk('heading_1', '제목', { hasChildren: true, collapsed: false })
    const plan = planSplit(heading, 2)
    if (plan.kind === 'split') assert.equal(plan.newPlacement, 'sibling_after')
  })
})

describe('planSplit — 빈 블록에서 Enter (정본 엣지 케이스 1행)', () => {
  test('빈 리스트 · 투두 · 토글 · 인용 · 콜아웃은 paragraph 로 탈출한다', () => {
    for (const type of [
      'bulleted_list_item',
      'numbered_list_item',
      'to_do',
      'toggle',
      'quote',
      'callout',
    ] as const) {
      assert.equal(planSplit(blk(type), 0).kind, 'escape_to_paragraph', type)
    }
  })

  test('빈 paragraph 는 새 빈 블록을 만든다 — 탈출할 곳이 없다', () => {
    const plan = planSplit(blk('paragraph'), 0)
    assert.equal(plan.kind, 'split')
    if (plan.kind === 'split') {
      assert.deepEqual(plan.head, [])
      assert.deepEqual(plan.tail, [])
      assert.equal(plan.newType, 'paragraph')
    }
  })

  test('빈 heading 은 탈출이 아니라 분할이다 — 타입 규칙이 이미 paragraph 를 만든다', () => {
    const plan = planSplit(blk('heading_2'), 0)
    assert.equal(plan.kind, 'split')
    if (plan.kind === 'split') assert.equal(plan.newType, 'paragraph')
  })

  test('빈 컨테이너라도 자식이 있으면 탈출하지 않는다 — 컨테이너였다는 사실이 사라진다', () => {
    const plan = planSplit(blk('toggle', '', { hasChildren: true }), 0)
    assert.equal(plan.kind, 'split')
  })
})

describe('planSplit — 텍스트를 담지 않는 블록', () => {
  test('divider · image 는 뒤에 빈 문단을 넣는다', () => {
    assert.equal(planSplit(blk('divider'), 0).kind, 'insert_paragraph_after')
    assert.equal(planSplit(blk('image'), 0).kind, 'insert_paragraph_after')
  })
})

describe('planSplit — 텍스트 분배', () => {
  test('캐럿 앞은 원본에, 뒤는 새 블록에 간다', () => {
    const plan = planSplit(blk('paragraph', '안녕하세요'), 2)
    assert.equal(plan.kind, 'split')
    if (plan.kind === 'split') {
      assert.equal(plan.head[0]?.plain_text, '안녕')
      assert.equal(plan.tail[0]?.plain_text, '하세요')
    }
  })
})

// ── 병합 ──────────────────────────────────────────────────────────────

describe('planMerge — 타입 승계 (정본 규칙 표 1행)', () => {
  test('앞 블록의 타입이 이긴다', () => {
    const plan = planMerge(blk('paragraph', '뒤'), blk('heading_1', '앞'))
    assert.equal(plan.kind, 'merge')
    if (plan.kind === 'merge') {
      assert.equal(plan.resultType, 'heading_1')
      assert.equal(plan.resultTitle[0]?.plain_text, '앞뒤')
    }
  })

  test('캐럿은 이어붙인 경계에 남는다', () => {
    const plan = planMerge(blk('paragraph', '뒤쪽'), blk('paragraph', '앞쪽입니다'))
    if (plan.kind === 'merge') assert.equal(plan.caretOffset, 5)
  })

  test('빈 앞 블록에 병합하면 캐럿은 0 이다', () => {
    const plan = planMerge(blk('paragraph', '뒤'), blk('paragraph', ''))
    if (plan.kind === 'merge') assert.equal(plan.caretOffset, 0)
  })
})

describe('planMerge — 자식 이관 (정본 규칙 표 2행)', () => {
  test('뒤 블록의 자식은 앞 블록의 자식 끝으로 간다', () => {
    const source = blk('paragraph', '뒤', { hasChildren: true })
    const plan = planMerge(source, blk('bulleted_list_item', '앞'))
    assert.equal(plan.kind, 'merge')
    if (plan.kind === 'merge') assert.equal(plan.movesChildren, true)
  })

  test('앞 블록이 자식을 가질 수 없으면 병합을 차단한다', () => {
    const source = blk('paragraph', '뒤', { hasChildren: true })
    const plan = planMerge(source, blk('heading_1', '앞')) // heading 은 자식 불가
    assert.equal(plan.kind, 'blocked')
    if (plan.kind === 'blocked') assert.equal(plan.reason, 'target_cannot_have_children')
  })

  test('차단 조건이라도 빈 블록이면 삭제로 폴백한다 (정본이 지정한 폴백)', () => {
    const source = blk('paragraph', '', { hasChildren: true })
    const plan = planMerge(source, blk('heading_1', '앞'))
    assert.equal(plan.kind, 'merge')
    if (plan.kind === 'merge') {
      assert.equal(plan.movesChildren, false, '자식을 heading 밑으로 옮기면 안 된다')
      assert.equal(plan.resultTitle[0]?.plain_text, '앞')
    }
  })

  test('앞 블록이 접혀 있는데 자식이 들어오면 펼친다 — 접힌 곳으로 들어가면 삭제로 보인다', () => {
    const source = blk('paragraph', '뒤', { hasChildren: true })
    const collapsed = blk('toggle', '앞', { hasChildren: true, collapsed: true })
    const plan = planMerge(source, collapsed)
    assert.equal(plan.kind, 'merge')
    if (plan.kind === 'merge') {
      assert.equal(plan.movesChildren, true)
      assert.equal(plan.expandTarget, true)
    }
  })

  test('자식이 없으면 접힌 앞 블록을 펼치지 않는다 — 불필요하게 열지 않는다', () => {
    const plan = planMerge(blk('paragraph', '뒤'), blk('toggle', '앞', { hasChildren: true, collapsed: true }))
    if (plan.kind === 'merge') assert.equal(plan.expandTarget, false)
  })
})

describe('planMerge — 앞 블록이 텍스트를 담지 않음 (정본 규칙 표 3행)', () => {
  test('divider · image 앞에서는 병합 대신 그 블록을 선택한다', () => {
    for (const type of ['divider', 'image'] as const) {
      assert.equal(planMerge(blk('paragraph', '뒤'), blk(type)).kind, 'select_target', type)
    }
  })

  test('빈 문단이어도 마찬가지다 — 삭제 대기 상태로 만든다', () => {
    assert.equal(planMerge(blk('paragraph', ''), blk('divider')).kind, 'select_target')
  })
})

describe('planMerge — 빈 블록에서 Backspace (정본 엣지 케이스 2행)', () => {
  test('타입이 paragraph 가 아니면 먼저 타입을 되돌린다', () => {
    for (const type of ['bulleted_list_item', 'to_do', 'heading_1', 'quote', 'toggle'] as const) {
      assert.equal(planMerge(blk(type), blk('paragraph', '앞')).kind, 'revert_type_to_paragraph', type)
    }
  })

  test('이미 paragraph 면 삭제하고 캐럿을 이전 블록 끝으로 보낸다', () => {
    const plan = planMerge(blk('paragraph'), blk('paragraph', '앞쪽'))
    assert.equal(plan.kind, 'merge')
    if (plan.kind === 'merge') {
      assert.equal(plan.resultTitle[0]?.plain_text, '앞쪽')
      assert.equal(plan.caretOffset, 2)
    }
  })

  test('자식이 있는 빈 컨테이너는 타입을 되돌리지 않는다 — 자식이 딸려 있다', () => {
    const plan = planMerge(blk('toggle', '', { hasChildren: true }), blk('paragraph', '앞'))
    assert.notEqual(plan.kind, 'revert_type_to_paragraph')
  })
})

describe('planMerge — 이전 블록이 없음 (정본 엣지 케이스 "삭제된 참조")', () => {
  test('앞 블록이 null 이면 무동작이다', () => {
    assert.equal(planMerge(blk('paragraph', '문서 첫 블록'), null).kind, 'noop')
  })

  test('빈 리스트가 첫 블록이면 타입 되돌림이 먼저다', () => {
    // 이전 블록이 없어도 "리스트에서 빠져나온다"는 여전히 유효한 동작이다.
    assert.equal(planMerge(blk('bulleted_list_item'), null).kind, 'revert_type_to_paragraph')
  })
})

describe('planMerge — 상한 (정본 엣지 케이스 "100 요소 초과")', () => {
  test('정규화 후에도 100 요소를 넘으면 병합을 거부한다 — 잘라내지 않는다', () => {
    const many = (n: number, p: string): RichTextRun[] =>
      Array.from({ length: n }, (_, i) =>
        i % 2 === 0 ? textRun(`${p}${i}`) : textRun(`${p}${i}`, { bold: true }),
      )

    const source: RuleBlock = { ...blk('paragraph'), title: many(60, 'S') }
    const target: RuleBlock = { ...blk('paragraph'), title: many(60, 'T') }

    const plan = planMerge(source, target)
    assert.equal(plan.kind, 'blocked')
    if (plan.kind === 'blocked') {
      assert.equal(plan.reason, 'too_many_runs')
      assert.match(plan.detail, /잘라내지 않기 위해/)
    }
  })
})
