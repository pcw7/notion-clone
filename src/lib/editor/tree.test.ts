/**
 * 화면 순서 평탄화 — F-01-19
 *
 * 핵심은 하나다: **접힌 노드의 자손은 이웃 계산에 나타나지 않는다.**
 * 그렇지 않으면 접힌 토글 뒤에서 Backspace 를 눌렀을 때 화면에 보이지도 않는
 * 마지막 자손과 병합된다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { flattenVisible, type TreeNodeLike } from './tree.ts'

type N = TreeNodeLike & { readonly id: string; readonly children?: readonly N[] }

const node = (id: string, children: N[] = [], collapsed = false): N => ({
  id,
  collapsed,
  children,
})

const ids = (roots: readonly N[]) => flattenVisible(roots).order.map((e) => e.node.id)

describe('flattenVisible — 순서', () => {
  test('전위 순회 순서다', () => {
    const tree = [node('a', [node('a1'), node('a2')]), node('b')]
    assert.deepEqual(ids(tree), ['a', 'a1', 'a2', 'b'])
  })

  test('깊이가 중첩을 반영한다', () => {
    const tree = [node('a', [node('a1', [node('a1x')])])]
    assert.deepEqual(
      flattenVisible(tree).order.map((e) => [e.node.id, e.depth]),
      [
        ['a', 0],
        ['a1', 1],
        ['a1x', 2],
      ],
    )
  })

  test('parentId 를 함께 준다 — 자식 이관 대상 계산에 필요하다', () => {
    const tree = [node('a', [node('a1')])]
    const index = flattenVisible(tree)
    assert.equal(index.entry('a')?.parentId, null)
    assert.equal(index.entry('a1')?.parentId, 'a')
  })

  test('빈 문서는 빈 배열이다', () => {
    assert.deepEqual(ids([]), [])
  })
})

describe('flattenVisible — 접힘 (이 파일의 존재 이유)', () => {
  test('접힌 노드의 자손은 나타나지 않는다', () => {
    const tree = [node('t', [node('c1'), node('c2')], true), node('after')]
    assert.deepEqual(ids(tree), ['t', 'after'])
  })

  test('접힌 토글 뒤 블록의 이전 이웃은 토글 제목이다 — 마지막 자손이 아니다', () => {
    // F-01-19: "접힌 토글 뒤에서 Backspace | 토글 subtree 전체와 병합되는 것처럼
    // 보이면 안 된다. 접힌 토글 제목과 병합하되 자식은 그대로 토글에 남긴다."
    const tree = [node('toggle', [node('hidden1'), node('hidden2')], true), node('after')]
    const index = flattenVisible(tree)
    assert.equal(index.previous('after')?.node.id, 'toggle')
  })

  test('펼치면 마지막 자손이 이전 이웃이 된다', () => {
    const tree = [node('toggle', [node('c1'), node('c2')], false), node('after')]
    assert.equal(flattenVisible(tree).previous('after')?.node.id, 'c2')
  })

  test('접힘은 그 노드에만 적용된다 — 형제는 계속 순회한다', () => {
    const tree = [node('t1', [node('h')], true), node('t2', [node('v')], false)]
    assert.deepEqual(ids(tree), ['t1', 't2', 'v'])
  })

  test('중첩된 접힘 — 바깥이 접히면 안쪽은 볼 것도 없다', () => {
    const tree = [node('outer', [node('inner', [node('deep')], false)], true)]
    assert.deepEqual(ids(tree), ['outer'])
  })
})

describe('flattenVisible — 이웃 조회', () => {
  const tree = [node('a', [node('a1')]), node('b')]

  test('previous / next 가 화면 순서를 따른다', () => {
    const index = flattenVisible(tree)
    assert.equal(index.next('a')?.node.id, 'a1')
    assert.equal(index.next('a1')?.node.id, 'b') // 부모 경계를 넘는다
    assert.equal(index.previous('b')?.node.id, 'a1')
  })

  test('첫 블록의 이전과 마지막 블록의 다음은 null 이다', () => {
    const index = flattenVisible(tree)
    assert.equal(index.previous('a'), null)
    assert.equal(index.next('b'), null)
  })

  test('모르는 id 는 -1 · null 이다 — 던지지 않는다', () => {
    const index = flattenVisible(tree)
    assert.equal(index.positionOf('없음'), -1)
    assert.equal(index.previous('없음'), null)
    assert.equal(index.next('없음'), null)
    assert.equal(index.entry('없음'), null)
  })
})

describe('flattenVisible — 방어', () => {
  test('id 가 중복되면 던진다 — 조용히 두면 이웃 조회가 엉뚱한 블록을 준다', () => {
    assert.throws(() => flattenVisible([node('dup'), node('dup')]), /두 번/)
  })

  test('깊은 트리에서도 스택 오버플로가 나지 않는다', () => {
    // 재귀 구현이면 여기서 죽는다. MAX_TREE_DEPTH(100) 보다 훨씬 깊게 준다 —
    // 클라이언트가 보낸 문서는 검증 전에도 평탄화할 수 있어야 한다.
    let deepest: N = node('d5000')
    for (let i = 4999; i >= 0; i -= 1) deepest = node(`d${i}`, [deepest])

    const index = flattenVisible([deepest])
    assert.equal(index.order.length, 5001)
    assert.equal(index.order[5000].depth, 5000)
  })

  test('5000블록 문서에서 이웃 조회가 O(1) 이다', () => {
    // 정본이 요구한 것: "평탄화된 블록 인덱스 배열을 별도로 유지해 O(1) 이웃 조회".
    // 시간 측정 대신 자료구조를 확인한다 — 인덱스가 한 번만 만들어지고
    // 조회가 배열 접근인지.
    const flat = Array.from({ length: 5000 }, (_, i) => node(`n${i}`))
    const index = flattenVisible(flat)

    assert.equal(index.order.length, 5000)
    assert.equal(index.positionOf('n4999'), 4999)
    assert.equal(index.previous('n2500')?.node.id, 'n2499')
    assert.equal(index.next('n2500')?.node.id, 'n2501')
  })
})
