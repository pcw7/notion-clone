/**
 * 사이드바 페이지 트리 조립 — F-02-03 / F-07-16 (DB 없음)
 *
 * 이 파일의 핵심은 하나다: **트리의 부모는 `parent_id` 가 아니라 가장 가까운
 * 페이지 조상이다.** 본문 블록 안에 중첩된 하위 페이지(PR #23)를 `parent_id`
 * 로 엮으면 부모를 못 찾아 **사이드바에서 통째로 사라진다.**
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { buildPageTree, groupSidebarRoots, type PageTreeNode, type PageTreeRow } from './page-tree.ts'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

function row(
  id: string,
  title: string,
  ancestorPath: string[] = [],
  orderKey = 'a0',
): PageTreeRow {
  // 픽스처의 기본은 공용 최상위다 — 개인 · 남의 개인은 검사에서 rootKind 를 덮는다(7c-7).
  return { id, title, kind: 'page', ancestorPath, orderKey, teamspaceId: null, teamspaceOpen: false, rootKind: 'workspace' as const }
}

/** [제목, [자식…]] 로 납작하게. */
function shape(nodes: readonly PageTreeNode[]): unknown[] {
  return nodes.map((n) => [n.title, shape(n.children)])
}

describe('buildPageTree — 기본', () => {
  test('빈 목록은 빈 트리다', () => {
    assert.deepEqual(buildPageTree([]), [])
  })

  test('조상이 없으면 최상위다', () => {
    const tree = buildPageTree([row(nextId(), 'A'), row(nextId(), 'B', [], 'a1')])
    assert.deepEqual(shape(tree), [
      ['A', []],
      ['B', []],
    ])
  })

  test('부모-자식-손자가 중첩된다', () => {
    const a = nextId()
    const b = nextId()
    const c = nextId()
    const tree = buildPageTree([
      row(a, 'A'),
      row(b, 'B', [a]),
      row(c, 'C', [a, b]),
    ])
    assert.deepEqual(shape(tree), [['A', [['B', [['C', []]]]]]])
  })

  test('hasChildren 이 자식 유무를 반영한다', () => {
    const a = nextId()
    const tree = buildPageTree([row(a, 'A'), row(nextId(), 'B', [a])])
    assert.equal(tree[0].hasChildren, true)
    assert.equal(tree[0].children[0].hasChildren, false)
  })

  test('parentId 는 트리상의 부모다', () => {
    const a = nextId()
    const b = nextId()
    const tree = buildPageTree([row(a, 'A'), row(b, 'B', [a])])
    assert.equal(tree[0].parentId, null)
    assert.equal(tree[0].children[0].parentId, a)
  })
})

describe('buildPageTree — 본문 안에 중첩된 하위 페이지 (PR #23)', () => {
  test('조상 경로에 본문 블록이 끼어 있어도 페이지 부모를 찾는다', () => {
    // 토글 안의 하위 페이지: ancestor_path = [부모페이지, 토글]
    // `parent_id` 로 엮으면 토글이 페이지 집합에 없어 부모를 못 찾는다.
    const parent = nextId()
    const toggle = nextId() // 페이지가 아니다 — 목록에 넣지 않는다
    const child = nextId()

    const tree = buildPageTree([row(parent, '부모'), row(child, '자식', [parent, toggle])])

    assert.deepEqual(shape(tree), [['부모', [['자식', []]]]], '자식이 사이드바에서 사라졌다')
    assert.equal(tree[0].children[0].parentId, parent)
  })

  test('여러 겹 본문 블록을 건너뛴다', () => {
    const parent = nextId()
    const t1 = nextId()
    const t2 = nextId()
    const child = nextId()

    const tree = buildPageTree([row(parent, '부모'), row(child, '자식', [parent, t1, t2])])
    assert.deepEqual(shape(tree), [['부모', [['자식', []]]]])
  })

  test('페이지 조상이 여럿이면 가장 가까운 쪽에 붙는다', () => {
    const root = nextId()
    const toggle = nextId()
    const mid = nextId()
    const leaf = nextId()

    const tree = buildPageTree([
      row(root, '루트'),
      row(mid, '중간', [root, toggle]),
      // 손자의 경로에는 루트·토글·중간이 다 있다. 중간에 붙어야 한다.
      row(leaf, '잎', [root, toggle, mid]),
    ])

    assert.deepEqual(shape(tree), [['루트', [['중간', [['잎', []]]]]]])
  })
})

describe('buildPageTree — 정렬', () => {
  test('형제는 order_key 순이다 (B7)', () => {
    const parent = nextId()
    const tree = buildPageTree([
      row(parent, '부모'),
      row(nextId(), '셋째', [parent], 'a2'),
      row(nextId(), '첫째', [parent], 'a0'),
      row(nextId(), '둘째', [parent], 'a1'),
    ])
    assert.deepEqual(
      tree[0].children.map((c) => c.title),
      ['첫째', '둘째', '셋째'],
    )
  })

  test('order_key 가 같으면 id 로 결정적으로 정렬한다', () => {
    // 본문 안에 중첩된 하위 페이지는 다른 형제 이름공간의 키를 갖고 있어
    // 같은 키가 실제로 나올 수 있다. 그때 순서가 흔들리면 사이드바가
    // 새로고침마다 달라 보인다.
    const parent = nextId()
    const ids = [nextId(), nextId()].sort()
    const tree = buildPageTree([
      row(parent, '부모'),
      row(ids[1], '나중', [parent], 'a0'),
      row(ids[0], '먼저', [parent], 'a0'),
    ])
    assert.deepEqual(tree[0].children.map((c) => c.id), ids)
  })

  test('깊은 곳의 형제도 정렬된다', () => {
    const a = nextId()
    const b = nextId()
    const tree = buildPageTree([
      row(a, 'A'),
      row(b, 'B', [a]),
      row(nextId(), '뒤', [a, b], 'a1'),
      row(nextId(), '앞', [a, b], 'a0'),
    ])
    assert.deepEqual(
      tree[0].children[0].children.map((c) => c.title),
      ['앞', '뒤'],
    )
  })
})

describe('buildPageTree — 데이터베이스 (W8)', () => {
  test('데이터베이스도 노드가 되고 종류를 싣는다 — 화면이 링크를 고른다', () => {
    const db = nextId()
    const tree = buildPageTree([row(nextId(), '페이지'), { ...row(db, '할 일', [], 'a1'), kind: 'database' }])
    assert.deepEqual(
      tree.map((n) => [n.title, n.kind]),
      [
        ['페이지', 'page'],
        ['할 일', 'database'],
      ],
    )
  })
})

describe('buildPageTree — teamspace (7c-2)', () => {
  test('노드가 자기 teamspace 를 싣는다 — 화면이 루트를 teamspace 별로 가른다', () => {
    const team = nextId()
    const top = nextId()
    const tree = buildPageTree([
      row(nextId(), '워크스페이스 페이지'),
      { ...row(top, '로드맵', [], 'a1'), teamspaceId: team },
      { ...row(nextId(), '분기 계획', [top]), teamspaceId: team },
    ])
    assert.deepEqual(
      tree.map((n) => [n.title, n.teamspaceId, n.children.map((c) => c.teamspaceId)]),
      [
        ['워크스페이스 페이지', null, []],
        ['로드맵', team, [team]],
      ],
    )
  })

  test('루트를 내 teamspace 별로 가른다 — 그 순서대로 · 페이지가 없어도 선다 · 남의 팀 것은 공유됨', () => {
    const [mine, empty, notMine] = [nextId(), nextId(), nextId()]
    const tree = buildPageTree([
      row(nextId(), '직속'),
      { ...row(nextId(), '로드맵', [], 'a1'), teamspaceId: mine },
      { ...row(nextId(), '남의 팀에서 공유받은 것', [], 'a2'), teamspaceId: notMine },
      { ...row(nextId(), '회의록', [], 'a3'), teamspaceId: mine },
    ])
    const split = groupSidebarRoots(tree, [
      { id: empty, name: '가' },
      { id: mine, name: '나' },
    ])
    assert.deepEqual(
      split.teamspaces.map((s) => [s.teamspace.name, s.pages.map((p) => p.title)]),
      [
        ['가', []],
        ['나', ['로드맵', '회의록']],
      ],
    )
    // 멤버가 아닌 teamspace 로 묶지 않는다 — 묶으면 그 teamspace 가 있다는 것이 드러난다. 낱개로 공유됨에 선다.
    assert.deepEqual(split.workspacePages.map((p) => p.title), ['직속'])
    assert.deepEqual(split.shared.map((p) => p.title), ['남의 팀에서 공유받은 것'])
  })

  test('teamspace 가 하나도 없으면 공용 최상위는 워크스페이스 페이지 · 남의 팀 것은 공유됨이다', () => {
    const tree = buildPageTree([{ ...row(nextId(), '공유받은 것'), teamspaceId: nextId() }, row(nextId(), '직속', [], 'a1')])
    const split = groupSidebarRoots(tree, [])
    assert.deepEqual(
      [split.teamspaces, split.shared.map((p) => p.title), split.workspacePages.map((p) => p.title), split.privatePages],
      [[], ['공유받은 것'], ['직속'], []],
    )
  })

  test('★ 멤버가 아닌 open teamspace 의 뿌리는 세우지 않는다 · closed 는 공유됨 · 내 open 은 그 섹션 (7c-9)', () => {
    const [mineOpen, otherOpen, otherClosed] = [nextId(), nextId(), nextId()]
    const tree = buildPageTree([
      { ...row(nextId(), '내 공개팀 문서', [], 'a1'), teamspaceId: mineOpen, teamspaceOpen: true },
      { ...row(nextId(), '남의 공개팀 문서', [], 'a2'), teamspaceId: otherOpen, teamspaceOpen: true },
      { ...row(nextId(), '남의 닫힌팀에서 받은 것', [], 'a3'), teamspaceId: otherClosed, teamspaceOpen: false },
    ])
    const split = groupSidebarRoots(tree, [{ id: mineOpen, name: '내 팀' }])
    assert.deepEqual(split.teamspaces[0]?.pages.map((p) => p.title), ['내 공개팀 문서'])
    assert.deepEqual(split.shared.map((p) => p.title), ['남의 닫힌팀에서 받은 것'])
    const everywhere = [...split.workspacePages, ...split.privatePages, ...split.shared, ...split.teamspaces.flatMap((t) => t.pages)]
    assert.ok(!everywhere.some((p) => p.title === '남의 공개팀 문서'), '멤버가 아닌 open 뿌리가 어딘가에 섰다')
  })

  test('★ 개인 · 남의 개인 · 조각 — 내 것은 개인 페이지 · 남의 것과 트리 중간 루트는 공유됨 (7c-7)', () => {
    const tree = buildPageTree([
      row(nextId(), '공용'),
      { ...row(nextId(), '내 개인', [], 'a1'), rootKind: 'private_mine' as const },
      { ...row(nextId(), '남의 개인인데 나에게 공유', [], 'a2'), rootKind: 'private_other' as const },
      // 조상이 보이지 않아 트리 중간에서 루트가 된 노드 — 진짜 루트는 공용이어도 내 눈에는 조각이다.
      { ...row(nextId(), '따로 공유받은 하위', [nextId()], 'a3'), rootKind: 'workspace' as const },
    ])
    const split = groupSidebarRoots(tree, [])
    assert.deepEqual(
      [split.privatePages.map((p) => p.title), split.shared.map((p) => p.title), split.workspacePages.map((p) => p.title)],
      [['내 개인'], ['남의 개인인데 나에게 공유', '따로 공유받은 하위'], ['공용']],
    )
  })
})

describe('buildPageTree — 방어', () => {
  test('조상이 목록에 없으면 최상위로 올린다 — 사라지지 않는다', () => {
    // 권한 필터(W6)로 조상이 걸러졌을 때 이렇게 된다. 자식을 숨기는 것보다
    // 최상위에 보여주는 편이 낫다 — 안 보이면 영영 도달할 수 없다.
    const missing = nextId()
    const tree = buildPageTree([row(nextId(), '고아', [missing])])
    assert.deepEqual(shape(tree), [['고아', []]])
  })

  test('제목이 비어 있어도 노드는 남는다', () => {
    const tree = buildPageTree([row(nextId(), '')])
    assert.equal(tree.length, 1)
    assert.equal(tree[0].title, '')
  })
})
