/**
 * 접힘 데코레이션 — F-01-13
 *
 * 이 테스트가 확인하는 것은 "어느 노드에 데코레이션이 붙는가"다. 그 데코레이션이
 * 실제로 자식을 숨기는가는 CSS 와 브라우저의 일이라 여기서 볼 수 없다 — 그건
 * `scripts/e2e-editor.mjs` 가 실제 브라우저로 확인한다. 예전 방식(DOM 속성 직접
 * 달기)이 헤드리스 테스트를 전부 통과하면서도 브라우저에서는 동작하지 않았던
 * 것이 그 분업의 이유다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { textRun } from '../contracts/rich-text.ts'
import type { BlockType } from '../block/types.ts'
import { docToPm } from './pm-adapter.ts'
import { findContainerById } from './pm-blocks.ts'
import { decorateCollapsed } from './collapse-plugin.ts'
import type { EditorBlock } from './document.ts'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

function blk(id: string, type: BlockType = 'paragraph', text = '', children: EditorBlock[] = []): EditorBlock {
  return { id, type, title: text === '' ? [] : [textRun(text)], properties: {}, format: {}, children }
}

/** 데코레이션을 [from, to] 쌍으로. */
function ranges(set: ReturnType<typeof decorateCollapsed>): Array<[number, number]> {
  return set.find().map((d) => [d.from, d.to] as [number, number]).sort((a, b) => a[0] - b[0])
}

describe('decorateCollapsed — 어디에 붙는가', () => {
  test('접힌 것이 없으면 아무 것도 없다', () => {
    const doc = docToPm({ blocks: [blk(nextId(), 'toggle', 'T', [blk(nextId())])] })
    assert.equal(decorateCollapsed(doc, () => false).find().length, 0)
  })

  test('★ 컨테이너와 내용 노드 둘 다 — 내용 노드에도 달아야 화살표가 따라 바뀐다', () => {
    const [t, t1] = [nextId(), nextId()]
    const doc = docToPm({ blocks: [blk(t, 'toggle', 'T', [blk(t1)])] })
    const info = findContainerById(doc, t)
    assert.ok(info)

    assert.deepEqual(ranges(decorateCollapsed(doc, (id) => id === t)), [
      [info.pos, info.pos + info.node.nodeSize],
      [info.contentPos, info.contentPos + info.contentNode.nodeSize],
    ])
  })

  test('자식이 없으면 접을 것이 없다 — 접힘 집합에 남아 있어도 그리지 않는다', () => {
    const t = nextId()
    const doc = docToPm({ blocks: [blk(t, 'toggle', 'T')] })
    assert.equal(decorateCollapsed(doc, () => true).find().length, 0)
  })

  test('접힌 토글 안의 접힌 토글도 그린다 — 바깥을 펼쳤을 때 안쪽이 멋대로 펼쳐지지 않게', () => {
    const [outer, inner, leaf] = [nextId(), nextId(), nextId()]
    const doc = docToPm({ blocks: [blk(outer, 'toggle', 'O', [blk(inner, 'toggle', 'I', [blk(leaf)])])] })
    const collapsed = new Set([outer, inner])
    // 바깥 둘 + 안쪽 둘.
    assert.equal(decorateCollapsed(doc, (id) => collapsed.has(id)).find().length, 4)
  })

  test('문서에 없는 id 가 접힘 집합에 있어도 조용하다', () => {
    const doc = docToPm({ blocks: [blk(nextId())] })
    const ghost = nextId()
    assert.equal(decorateCollapsed(doc, (id) => id === ghost).find().length, 0)
  })
})
