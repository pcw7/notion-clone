/**
 * 동시 편집이 만드는 구조 위반 장면 — 테스트 재료 (`collab/normalize.ts` 머리말의 표)
 *
 * 각 장면은 참여자들이 따로는 올바른 편집을 해서 보낸 update 들이다. 전부 받으면 `fix` 가 고치는 위반이 생긴다.
 * client id 를 고정해 동시 삽입 순서가 결정론이다.
 */

import { randomUUID } from 'node:crypto'

import * as Y from 'yjs'
import { prosemirrorToYXmlFragment } from 'y-prosemirror'
import type { Transaction } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'

import type { NormalizeFix } from '../collab/normalize.ts'
import { BODY_FRAGMENT, createBodyYDoc } from '../collab/ydoc.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { EditorBlock } from '../editor/document.ts'
import { docToPm } from '../editor/pm-adapter.ts'
import { blockSchema } from '../editor/schema.ts'
import { changesSince, edit, findBlock, peer } from './collab-peers.ts'

export type ViolationScene = {
  readonly name: string
  /** 전부 받으면 `normalizeBody` 가 이것을 보고한다. */
  readonly fix: NormalizeFix
  /** 편집 전의 공통 상태. */
  readonly base: Y.Doc
  /** 참여자마다 보낸 update(`base` 이후). */
  readonly updates: readonly Uint8Array[]
  /** 위반과 상관없는 문단의 id — 바인딩 · 수선이 건드리지 않아야 한다. */
  readonly bystander: string
}

export function paragraph(text: string, extra: Partial<EditorBlock> = {}): EditorBlock {
  return { id: randomUUID(), type: 'paragraph', title: text === '' ? [] : [textRun(text)], ...extra }
}

/** `base` 에서 시작해 장면의 update 를 전부 받은 참여자. */
export function mergedPeer(scene: ViolationScene, clientId: number): Y.Doc {
  const ydoc = peer(scene.base, clientId)
  for (const update of scene.updates) Y.applyUpdate(ydoc, update)
  return ydoc
}

type Change = (tr: Transaction, doc: PmNode) => void

const setType =
  (blockId: string, type: string, props: Record<string, unknown> = {}): Change =>
  (tr, doc) => {
    tr.setNodeMarkup(findBlock(doc, blockId).pos + 1, blockSchema.nodes[type], { props, format: {} })
  }

const remove =
  (blockId: string): Change =>
  (tr, doc) => {
    const { pos, node } = findBlock(doc, blockId)
    tr.delete(pos, pos + node.nodeSize)
  }

/** 자식이 없는 `parentId`(앞) 밑으로 `childId`(뒤)를 옮긴다 — 그룹을 새로 만든다. */
const nestUnder =
  (parentId: string, childId: string): Change =>
  (tr, doc) => {
    const child = findBlock(doc, childId)
    const parent = findBlock(doc, parentId)
    tr.delete(child.pos, child.pos + child.node.nodeSize)
    tr.insert(parent.pos + 1 + parent.node.child(0).nodeSize, blockSchema.nodes.blockGroup.create(null, [child.node]))
  }

function editScene(name: string, fix: NormalizeFix, blocks: EditorBlock[], bystander: string, changes: Change[]): ViolationScene {
  const base = createBodyYDoc({ blocks })
  const updates = changes.map((change, i) => {
    const participant = peer(base, i + 1)
    edit(participant, change)
    return changesSince(participant, base)
  })
  return { name, fix, base, updates, bystander }
}

export function violationScenes(): ViolationScene[] {
  const scenes: ViolationScene[] = []
  {
    const [x, by] = [paragraph('원문'), paragraph('옆 문단')]
    scenes.push(
      editScene('같은 블록을 동시에 다른 타입으로 바꾼다', 'type_conflict_resolved', [x, by], by.id, [
        setType(x.id, 'heading_2'),
        setType(x.id, 'to_do', { checked: false }),
      ]),
    )
  }
  {
    const [c1, c2, by] = [paragraph('하나'), paragraph('둘'), paragraph('옆 문단')]
    const parent = paragraph('부모', { children: [c1, c2] })
    scenes.push(
      editScene('한 그룹의 남은 자식을 하나씩 동시에 지운다', 'empty_group_removed', [parent, by], by.id, [remove(c1.id), remove(c2.id)]),
    )
  }
  {
    const [x, s, t, by] = [paragraph('부모'), paragraph('에스'), paragraph('티'), paragraph('옆 문단')]
    scenes.push(
      editScene('같은 블록 밑으로 동시에 처음 들여쓴다', 'groups_merged', [x, s, t, by], by.id, [nestUnder(x.id, s.id), nestUnder(x.id, t.id)]),
    )
  }
  {
    const [x, s, by] = [paragraph('토글', { type: 'toggle' }), paragraph('자식'), paragraph('옆 문단')]
    scenes.push(
      editScene('토글을 제목으로 바꾸는 동안 자식을 넣는다', 'children_lifted', [x, s, by], by.id, [
        setType(x.id, 'heading_1'),
        nestUnder(x.id, s.id),
      ]),
    )
  }
  {
    // 동시 순서 변경의 attr LWW 가 만드는 결과를 직접 만든다(`collab/ydoc.test.ts` ② 와 같은 방법).
    const [x, y, by] = [paragraph('엑스'), paragraph('와이'), paragraph('옆 문단')]
    const base = createBodyYDoc({ blocks: [x, y, by] })
    const participant = peer(base, 1)
    const root = participant.getXmlFragment(BODY_FRAGMENT).get(0) as Y.XmlElement
    participant.transact(() => (root.get(1) as Y.XmlElement).setAttribute('blockId', x.id))
    scenes.push({ name: '두 블록이 같은 blockId 를 갖는다', fix: 'duplicate_id', base, updates: [changesSince(participant, base)], bystander: by.id })
  }
  {
    // 빈 프래그먼트를 둘이 동시에 처음 채운다. Y.Doc 을 만드는 곳이 하나라 정상 경로에서는 생기지 않는다(`ydoc.ts` 머리말).
    const [x, by] = [paragraph('첫 그룹'), paragraph('옆 문단')]
    const filled = (clientId: number, block: EditorBlock): Uint8Array => {
      const ydoc = new Y.Doc()
      ydoc.clientID = clientId
      prosemirrorToYXmlFragment(docToPm({ blocks: [block] }), ydoc.getXmlFragment(BODY_FRAGMENT))
      return Y.encodeStateAsUpdate(ydoc)
    }
    scenes.push({
      name: '빈 본문을 둘이 동시에 처음 채워 루트 그룹이 둘이다',
      fix: 'groups_merged',
      base: new Y.Doc(),
      updates: [filled(1, x), filled(2, by)],
      bystander: by.id,
    })
  }
  return scenes
}
