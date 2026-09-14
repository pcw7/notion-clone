/**
 * 협업 바인딩의 스키마 — CRDT 3조각 (DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **변환은 Y.Doc 을 지우지 않는다** — 동시 편집이 만드는 구조 위반마다 `initProseMirrorDoc(collabSchema)` 가
 *      원본을 한 바이트도 바꾸지 않고 Y.Doc 을 그대로 비춘다
 *   ② **실제 바인딩(`ySyncPlugin`)도 그렇다** — 위반을 원격 update 로 받고 다른 블록을 고쳐도 내용이 남는다.
 *      바인딩은 위반을 고쳐 쓰지 않는다 — 수선은 로그 저장소 한 곳이다(`repair.ts`)
 *   ③ **모르는 것** — 모르는 · 만들 수 없는 마크는 글자를 남긴다. 모르는 노드는 받아도, 이웃을 고쳐도 남는다
 *   ④ **편집 규칙은 그대로다** — `blockSchema` 는 여전히 내용 규칙을 검사한다
 *
 * 편집 스키마를 그대로 넘기면 무엇이 지워지는지는 ② 의 마지막 검사와 `ydoc.test.ts` ④ 가 본다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import * as Y from 'yjs'
import { initProseMirrorDoc } from 'y-prosemirror'

import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { blockSchema } from '../editor/schema.ts'
import { bind, findBlock, peer } from '../testing/collab-peers.ts'
import { mergedPeer, paragraph, violationScenes, type ViolationScene } from '../testing/collab-scenarios.ts'
import { collabSchema } from './collab-schema.ts'
import { BODY_FRAGMENT, createBodyYDoc, readBodyPm, readBodyYDoc } from './ydoc.ts'

const PAGE = randomUUID()
const SCENES = violationScenes()

const bytes = (ydoc: Y.Doc): Buffer => Buffer.from(Y.encodeStateAsUpdate(ydoc))

/** 문서의 모든 블록을 전위 순서로 [id, 타입, 글자]. */
function blocksOf(doc: EditorDoc): [string, string, string][] {
  const out: [string, string, string][] = []
  const walk = (blocks: readonly EditorBlock[]): void => {
    for (const b of blocks) {
      out.push([b.id, b.type, b.title.map((r) => r.plain_text).join('')])
      walk(b.children ?? [])
    }
  }
  walk(doc.blocks)
  return out
}

function sceneOf(fix: ViolationScene['fix']): ViolationScene {
  const found = SCENES.find((s) => s.fix === fix)
  if (found === undefined) throw new Error(`장면이 없다: ${fix}`)
  return found
}

/** 첫 블록의 글자 요소. */
function firstText(ydoc: Y.Doc): Y.XmlText {
  const group = ydoc.getXmlFragment(BODY_FRAGMENT).get(0) as Y.XmlElement
  const content = (group.get(0) as Y.XmlElement).get(0) as Y.XmlElement
  return content.get(0) as Y.XmlText
}

// ── ① 변환 ────────────────────────────────────────────────────────────

describe('① 변환은 Y.Doc 을 지우지 않는다', () => {
  for (const scene of SCENES) {
    test(`★ ${scene.name} — 원본은 그대로이고 문서는 Y.Doc 을 그대로 비춘다`, () => {
      const merged = mergedPeer(scene, 9)
      assert.ok(readBodyYDoc(merged, PAGE).fixes.includes(scene.fix), `전제: 이 장면이 ${scene.fix} 를 만든다`)
      const before = bytes(merged)

      const { doc } = initProseMirrorDoc(merged.getXmlFragment(BODY_FRAGMENT), collabSchema)
      assert.ok(bytes(merged).equals(before), '변환이 Y.Doc 을 바꿨다')
      assert.ok(doc.eq(readBodyPm(merged)), '변환 결과가 Y.Doc 과 다르다')
    })
  }
})

// ── ② 실제 바인딩 ─────────────────────────────────────────────────────

describe('② 실제 바인딩 — ySyncPlugin', () => {
  for (const scene of SCENES) {
    test(`★ ${scene.name} — 원격으로 받고 다른 블록을 고쳐도 내용이 남고, 위반을 고쳐 쓰지 않는다`, () => {
      const expected = readBodyYDoc(mergedPeer(scene, 9), PAGE)
      const local = peer(scene.base, 3)
      const editor = bind(local)
      try {
        assert.ok(editor.state.schema === collabSchema, '바인딩 상태의 스키마가 파사드가 아니다')
        for (const update of scene.updates) Y.applyUpdate(local, update)
        assert.deepEqual(readBodyYDoc(local, PAGE).doc, expected.doc, '받는 동안 바인딩이 Y.Doc 을 바꿨다')
        assert.ok(editor.state.doc.eq(readBodyPm(local)), '에디터 문서가 Y.Doc 을 그대로 비추지 않는다')

        editor.dispatch(editor.state.tr.insertText('!', findBlock(editor.state.doc, scene.bystander).pos + 2))

        const after = readBodyYDoc(local, PAGE)
        assert.deepEqual(
          blocksOf(after.doc),
          blocksOf(expected.doc).map(([id, type, text]) => [id, type, id === scene.bystander ? `!${text}` : text]),
        )
        assert.ok(after.fixes.includes(scene.fix), '바인딩이 위반을 고쳐 썼다 — 수선은 로그 저장소 한 곳이다')
      } finally {
        editor.destroy()
      }
    })
  }

  test('편집 스키마로 만든 상태에 붙이면 바인딩이 타입 충돌 블록을 Y.Doc 에서 지운다 — 파사드가 필요한 이유 (실패하면 y-prosemirror 가 바뀐 것이다)', () => {
    const scene = sceneOf('type_conflict_resolved')
    const local = peer(scene.base, 3)
    const editor = bind(local, blockSchema)
    try {
      for (const update of scene.updates) Y.applyUpdate(local, update)
      assert.deepEqual(
        blocksOf(readBodyYDoc(local, PAGE).doc).map(([id]) => id),
        [scene.bystander],
      )
    } finally {
      editor.destroy()
    }
  })
})

// ── ③ 모르는 것 ───────────────────────────────────────────────────────

describe('③ 모르는 것', () => {
  test('★ 모르는 마크 · 주소 없는 링크 — 변환은 글자를 남기고 Y.Doc 을 바꾸지 않는다', () => {
    const ydoc = createBodyYDoc({ blocks: [paragraph('앞')] })
    const text = firstText(ydoc)
    ydoc.transact(() => {
      text.insert(text.length, '미래', { future_mark_from_newer_client: true })
      text.insert(text.length, '링크', { link: {} })
    })
    const before = bytes(ydoc)

    const { doc } = initProseMirrorDoc(ydoc.getXmlFragment(BODY_FRAGMENT), collabSchema)
    assert.ok(bytes(ydoc).equals(before), '변환이 Y.Doc 을 바꿨다')
    assert.equal(doc.textContent, '앞미래링크')
  })

  test('★ 모르는 노드 — 바인딩이 받아도, 이웃 블록을 고쳐도 Y.Doc 에 남는다', () => {
    const [x, y] = [paragraph('엑스'), paragraph('와이')]
    const ydoc = createBodyYDoc({ blocks: [x, y] })
    const editor = bind(ydoc)
    try {
      const root = ydoc.getXmlFragment(BODY_FRAGMENT).get(0) as Y.XmlElement
      const future = new Y.XmlElement('blockContainer')
      future.setAttribute('blockId', randomUUID())
      future.insert(0, [new Y.XmlElement('future_block_from_newer_client')])
      ydoc.transact(() => root.insert(1, [future]))

      for (const id of [y.id, x.id]) {
        editor.dispatch(editor.state.tr.insertText('!', findBlock(editor.state.doc, id).pos + 2))
      }
      assert.equal(root.length, 3, '모르는 노드의 컨테이너를 지웠다')
      assert.equal(future.length, 1, '모르는 노드를 지웠다')
      assert.deepEqual(blocksOf(readBodyYDoc(ydoc, PAGE).doc).map(([, , text]) => text), ['!엑스', '!와이'])
    } finally {
      editor.destroy()
    }
  })
})

// ── ④ 편집 규칙 ───────────────────────────────────────────────────────

describe('④ 편집 규칙은 그대로다', () => {
  test('blockSchema 는 내용 규칙을 검사하고 collabSchema 는 검사하지 않는다 — 만든 노드는 blockSchema 의 노드다', () => {
    const para = blockSchema.nodes.paragraph.create({ props: {}, format: {} })
    assert.throws(() => blockSchema.node('blockContainer', { blockId: '' }, [para, para]), RangeError)
    const loose = collabSchema.node('blockContainer', { blockId: '' }, [para, para])
    assert.ok(loose.type === blockSchema.nodes.blockContainer, '다른 스키마의 노드를 만들었다')
    assert.ok(collabSchema.nodes === blockSchema.nodes, '노드 타입을 새로 만들었다')
  })
})
