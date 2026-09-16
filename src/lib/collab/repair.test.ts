/**
 * 본문 Y.Doc 수선 — CRDT 3조각 (DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **고칠 것이 남지 않고 프로젝션은 그대로다** — 동시 편집이 만드는 위반마다. 수선 update 를 받은 참여자도
 *      같고, 고친 뒤의 두 번째 수선은 쓰지 않는다
 *   ② **작성자는 한 곳이다** — 한 곳이 고치면 옮긴 블록이 하나다. 둘이 각자 고치면 복제된다 — 작성자를 로그
 *      저장소 하나로 둔 근거다(저장소 쪽은 `doc-store.db.test.ts` ⑥)
 *   ③ **고칠 곳만 건드린다** — 수선과 동시에 다른 블록에 친 글자가 남는다
 *   ④ **모르는 것이 있으면 고치지 않는다** — Y.Doc 을 한 바이트도 바꾸지 않는다
 *   ⑤ **받은 깊이보다 깊은 하위 페이지 참조를 올린다** — 그 뒤에는 깊이 없이 읽어도 같은 문서이고, 올리기와 동시에 담은 블록 ·
 *      이웃 블록에 친 글자가 남는다(옮기는 것은 글자 없는 참조 요소뿐이다)
 *   ⑥ **본문에 둘 수 없는 하위 페이지 참조를 뺀다** — 같은 참조를 둘이 동시에 옮긴 문서에서 하나만 남고, 그 뒤에는 집합 없이 읽어도
 *      같은 문서다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import * as Y from 'yjs'

import type { EditorBlock } from '../editor/document.ts'
import { docToPm } from '../editor/pm-adapter.ts'
import { edit, exchange, findBlock, peer } from '../testing/collab-peers.ts'
import { mergedPeer, paragraph, violationScenes, type ViolationScene } from '../testing/collab-scenarios.ts'
import { repairBodyYDoc } from './repair.ts'
import { BODY_FRAGMENT, createBodyYDoc, readBodyYDoc } from './ydoc.ts'

const PAGE = randomUUID()
const SCENES = violationScenes()

const bytes = (ydoc: Y.Doc): Buffer => Buffer.from(Y.encodeStateAsUpdate(ydoc))

/** 읽은 문서의 모든 블록 글자, 전위 순서. */
function textsOf(ydoc: Y.Doc): string[] {
  const out: string[] = []
  const walk = (blocks: readonly EditorBlock[]): void => {
    for (const b of blocks) {
      out.push(b.title.map((r) => r.plain_text).join(''))
      walk(b.children ?? [])
    }
  }
  walk(readBodyYDoc(ydoc, PAGE).doc.blocks)
  return out
}

function sceneOf(fix: ViolationScene['fix']): ViolationScene {
  const found = SCENES.find((s) => s.fix === fix)
  if (found === undefined) throw new Error(`장면이 없다: ${fix}`)
  return found
}

/** 위반 장면에 이 스키마가 모르는 노드를 하나 더한다. */
function withUnknownNode(ydoc: Y.Doc): void {
  const root = ydoc.getXmlFragment(BODY_FRAGMENT).get(0) as Y.XmlElement
  const future = new Y.XmlElement('blockContainer')
  future.setAttribute('blockId', randomUUID())
  future.insert(0, [new Y.XmlElement('future_block_from_newer_client')])
  ydoc.transact(() => root.insert(root.length, [future]))
}

// ── ① 수선 ────────────────────────────────────────────────────────────

describe('① 수선', () => {
  for (const scene of SCENES) {
    test(`★ ${scene.name} — 고칠 것이 남지 않고 프로젝션은 그대로다 · 수선을 받은 참여자도 같다`, () => {
      const [server, other] = [mergedPeer(scene, 9), mergedPeer(scene, 10)]
      const before = readBodyYDoc(server, PAGE)
      assert.ok(before.fixes.includes(scene.fix), `전제: 이 장면이 ${scene.fix} 를 만든다`)

      const result = repairBodyYDoc(server, PAGE)
      assert.ok(result.kind === 'repaired', `고치지 않았다: ${result.kind}`)
      assert.deepEqual(result.fixes, before.fixes)
      const after = readBodyYDoc(server, PAGE)
      assert.deepEqual(after.fixes, [], '고칠 것이 남았다')
      assert.deepEqual(after.doc, before.doc, '수선이 프로젝션을 바꿨다')

      Y.applyUpdate(other, result.update)
      assert.deepEqual(readBodyYDoc(other, PAGE), after)
      assert.deepEqual(repairBodyYDoc(server, PAGE), { kind: 'clean' }, '고친 뒤에 또 썼다')
    })
  }

  test('고칠 것이 없으면 아무것도 쓰지 않는다', () => {
    const ydoc = createBodyYDoc({ blocks: [paragraph('멀쩡한 문단', { children: [paragraph('자식')] })] })
    const before = bytes(ydoc)
    assert.deepEqual(repairBodyYDoc(ydoc, PAGE), { kind: 'clean' })
    assert.ok(bytes(ydoc).equals(before))
  })
})

// ── ② 작성자 ──────────────────────────────────────────────────────────

describe('② 작성자는 한 곳', () => {
  test('★ 한 곳이 고치면 옮긴 블록이 하나다 — 둘이 각자 고치면 복제된다 (수선을 로그 저장소 한 곳에 두는 근거)', () => {
    const scene = sceneOf('groups_merged')
    const expected = textsOf(mergedPeer(scene, 9))

    const [server, other] = [mergedPeer(scene, 9), mergedPeer(scene, 10)]
    assert.equal(repairBodyYDoc(server, PAGE).kind, 'repaired')
    exchange(server, other)
    assert.deepEqual(textsOf(other), expected)
    assert.deepEqual(readBodyYDoc(other, PAGE).fixes, [])

    const [a, b] = [mergedPeer(scene, 9), mergedPeer(scene, 10)]
    assert.equal(repairBodyYDoc(a, PAGE).kind, 'repaired')
    assert.equal(repairBodyYDoc(b, PAGE).kind, 'repaired')
    exchange(a, b)
    assert.ok(
      textsOf(a).length > expected.length,
      `둘이 각자 고쳤는데 복제되지 않았다(${JSON.stringify(textsOf(a))}) — 작성자를 한 곳으로 둔 근거가 사라졌다. repair.ts 머리말 · HANDOFF §3.2-14 를 다시 본다`,
    )
  })
})

// ── ③ 고칠 곳만 ───────────────────────────────────────────────────────

describe('③ 고칠 곳만 건드린다', () => {
  test('★ 수선과 동시에 다른 블록에 친 글자가 남는다', () => {
    const scene = sceneOf('type_conflict_resolved')
    const [server, typist] = [mergedPeer(scene, 9), mergedPeer(scene, 11)]
    edit(typist, (tr, doc) => tr.insertText('!', findBlock(doc, scene.bystander).pos + 2))

    assert.equal(repairBodyYDoc(server, PAGE).kind, 'repaired')
    exchange(server, typist)

    const read = readBodyYDoc(server, PAGE)
    assert.deepEqual(read.fixes, [])
    assert.deepEqual(textsOf(server), ['원문', '!옆 문단'])
    assert.deepEqual(readBodyYDoc(typist, PAGE), read)
  })
})

// ── ④ 고치지 않는 경우 ────────────────────────────────────────────────

describe('④ 모르는 것이 있으면 고치지 않는다', () => {
  test('★ 모르는 노드 — Y.Doc 을 한 바이트도 바꾸지 않는다', () => {
    const server = mergedPeer(sceneOf('type_conflict_resolved'), 9)
    withUnknownNode(server)
    const before = bytes(server)

    const result = repairBodyYDoc(server, PAGE)
    assert.ok(result.kind === 'skipped' && result.reason === 'unknown_content', `결과: ${result.kind}`)
    assert.ok(bytes(server).equals(before), '고치지 않는다면서 Y.Doc 을 바꿨다')
  })

  test('★ 모르는 마크 — Y.Doc 을 한 바이트도 바꾸지 않는다', () => {
    const scene = sceneOf('type_conflict_resolved')
    const server = mergedPeer(scene, 9)
    const root = server.getXmlFragment(BODY_FRAGMENT).get(0) as Y.XmlElement
    const bystanderText = ((root.get(1) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlText
    server.transact(() => bystanderText.format(0, 1, { future_mark_from_newer_client: true }))
    const before = bytes(server)

    const result = repairBodyYDoc(server, PAGE)
    assert.ok(result.kind === 'skipped' && result.reason === 'unknown_content', `결과: ${result.kind}`)
    assert.ok(bytes(server).equals(before), '고치지 않는다면서 Y.Doc 을 바꿨다')
  })
})

// ── ⑤ 하위 페이지 참조 올리기 ─────────────────────────────────────────

describe('⑤ 받은 깊이보다 깊은 하위 페이지 참조를 올린다', () => {
  const [holder, ref, elder, younger, neighbor] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()]
  // 담은 토글(형 · 참조 · 동생) · 이웃 — 참조는 깊이 2 다.
  const source = (): Y.Doc =>
    createBodyYDoc({
      blocks: [
        paragraph('담은', {
          id: holder,
          type: 'toggle',
          children: [paragraph('형', { id: elder }), { id: ref, type: 'page', title: [] }, paragraph('동생', { id: younger })],
        }),
        paragraph('이웃', { id: neighbor }),
      ],
    })
  const topLevel = new Map([[ref, 1]])
  const idsOf = (ydoc: Y.Doc): unknown =>
    readBodyYDoc(ydoc, PAGE).doc.blocks.map((b) => [b.id, (b.children ?? []).map((c) => c.id)])

  test('★ 올린 수선을 쓴다 — 그 뒤에는 깊이 없이 읽어도 같은 문서이고 수선을 받은 참여자도 같다', () => {
    const base = source()
    const [server, other] = [peer(base, 9), peer(base, 10)]
    const expected = readBodyYDoc(server, PAGE, { pageRefDepth: topLevel })
    assert.deepEqual(expected.fixes, ['page_ref_lifted'], '전제: 받은 깊이로 읽으면 올린다')
    assert.deepEqual(readBodyYDoc(server, PAGE).fixes, [], '전제: 깊이 없이 읽으면 고칠 것이 없다')

    const result = repairBodyYDoc(server, PAGE, { pageRefDepth: topLevel })
    assert.ok(result.kind === 'repaired', `올리지 않았다: ${result.kind}`)
    assert.deepEqual(readBodyYDoc(server, PAGE), { doc: expected.doc, fixes: [] }, '깊이 없이 읽은 문서가 투영이 읽은 것과 다르다')
    assert.deepEqual(idsOf(server), [[holder, [elder, younger]], [ref, []], [neighbor, []]])

    Y.applyUpdate(other, result.update)
    assert.deepEqual(readBodyYDoc(other, PAGE), readBodyYDoc(server, PAGE))
    assert.deepEqual(repairBodyYDoc(server, PAGE, { pageRefDepth: topLevel }), { kind: 'clean' }, '올린 뒤에 또 썼다')
  })

  test('★ 올리기와 동시에 담은 블록 · 형제 · 이웃 블록에 친 글자가 남는다', () => {
    const base = source()
    const [server, typist] = [peer(base, 9), peer(base, 11)]
    edit(typist, (tr) => {
      for (const id of [neighbor, younger, elder, holder]) tr.insertText('!', findBlock(tr.doc, id).pos + 2)
    })
    assert.equal(repairBodyYDoc(server, PAGE, { pageRefDepth: topLevel }).kind, 'repaired')
    exchange(server, typist)

    assert.deepEqual(textsOf(server), ['!담은', '!형', '!동생', '', '!이웃'])
    assert.deepEqual(idsOf(server), [[holder, [elder, younger]], [ref, []], [neighbor, []]])
    assert.deepEqual(readBodyYDoc(server, PAGE).fixes, [])
    assert.deepEqual(readBodyYDoc(typist, PAGE), readBodyYDoc(server, PAGE))
  })
})

// ── ⑥ 본문에 둘 수 없는 하위 페이지 참조 ──────────────────────────────

describe('⑥ 본문에 둘 수 없는 하위 페이지 참조를 뺀다', () => {
  test('★ 같은 참조를 둘이 동시에 옮긴 문서에서 하나만 남기는 수선을 쓴다 — 그 뒤에는 집합 없이 읽어도 같고 수선을 받은 참여자도 같다', () => {
    const [ref, first, second] = [randomUUID(), randomUUID(), randomUUID()]
    const toggle = (id: string, children: EditorBlock[] = []): EditorBlock => ({ ...paragraph('토글', { id }), type: 'toggle', children })
    const pageRef: EditorBlock = { id: ref, type: 'page', title: [] }
    const base = createBodyYDoc({ blocks: [toggle(first), toggle(second), pageRef] })
    const rewrite = (ydoc: Y.Doc, blocks: EditorBlock[]): void => {
      const next = docToPm({ blocks })
      edit(ydoc, (tr) => {
        tr.replaceWith(0, tr.doc.content.size, next.content)
      })
    }
    const [server, other] = [peer(base, 21), peer(base, 22)]
    rewrite(server, [toggle(first, [pageRef]), toggle(second)])
    rewrite(other, [toggle(first), toggle(second, [pageRef])])
    exchange(server, other)

    const pageRefs = new Set([ref])
    const pageRefCount = (ydoc: Y.Doc, options = {}) =>
      JSON.stringify(readBodyYDoc(ydoc, PAGE, options).doc).split('"type":"page"').length - 1
    assert.equal(pageRefCount(server), 2, '전제: 집합 없이 읽으면 참조가 둘이다')
    const expected = readBodyYDoc(server, PAGE, { pageRefs })
    assert.ok(expected.fixes.includes('page_ref_dropped'), '전제: 받은 집합으로 읽으면 뺀다')

    const result = repairBodyYDoc(server, PAGE, { pageRefs })
    assert.ok(result.kind === 'repaired', `빼지 않았다: ${result.kind}`)
    assert.deepEqual(readBodyYDoc(server, PAGE), { doc: expected.doc, fixes: [] }, '집합 없이 읽은 문서가 투영이 읽은 것과 다르다')
    assert.equal(pageRefCount(server), 1)

    Y.applyUpdate(other, result.update)
    assert.deepEqual(readBodyYDoc(other, PAGE), readBodyYDoc(server, PAGE))
    assert.deepEqual(repairBodyYDoc(server, PAGE, { pageRefs }), { kind: 'clean' }, '뺀 뒤에 또 썼다')
  })
})
