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
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import * as Y from 'yjs'

import type { EditorBlock } from '../editor/document.ts'
import { edit, exchange, findBlock } from '../testing/collab-peers.ts'
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
