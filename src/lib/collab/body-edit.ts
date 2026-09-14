/**
 * ProseMirror 변경을 Y.Doc 본문에 쓴다 — 서버 명령 경로 ②(판결 V-5)의 편집 단위 · F-05-01 · CRDT 4a조각
 *
 * 정본: 판결 V-5(서버가 Y.Doc 을 로드 → 한 트랜잭션 안에서 전부 적용 → update 1개) · X-1
 *
 * 에디터 바인딩(`ySyncPlugin`)이 하는 쓰기를 에디터 없이 한다.
 *
 *   ① Y.Doc 을 `collabSchema` 로 읽는다 — 구조 위반이 있어도 Y 요소를 지우지 않는다(`collab-schema.ts`)
 *   ② 그 문서에 ProseMirror 트랜잭션을 만든다
 *   ③ 서식 거울을 맞춘다(`editor/atom-marks.ts`) — y-prosemirror 는 원자 노드의 마크를 attr 로만 싣는다
 *   ④ `updateYFragment` 로 바뀐 부분을 Y.Doc 에 옮긴다
 *
 * 테스트의 참여자 흉내(`testing/collab-peers.ts` 의 `edit`)도 이 함수를 쓴다 — 서버와 테스트가 같은 한 벌이다.
 *
 * ⚠ 읽은 문서는 Y.Doc 을 그대로 비춘다 — 스키마를 어길 수 있다. 위반 자리를 건드리는 스텝은 ProseMirror 가
 *   거부한다(던진다). 구조 위반을 고치는 것은 이 함수가 아니라 로그 저장소의 수선이다(`repair.ts`).
 */

import type * as Y from 'yjs'
import { initProseMirrorDoc, updateYFragment } from 'y-prosemirror'
import { EditorState, type Transaction } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'

import { atomMarksPlugin } from '../editor/atom-marks.ts'
import { blockSchema } from '../editor/schema.ts'
import { collabSchema } from './collab-schema.ts'
import { BODY_FRAGMENT } from './ydoc.ts'

/** 본문 문서에 대한 ProseMirror 변경. `doc` 은 변경 전 문서다. */
export type EditorChange = (tr: Transaction, doc: PmNode) => void

/**
 * `change` 를 `ydoc` 의 본문에 쓴다. 문서가 바뀌지 않았으면 Y.Doc 을 건드리지 않는다.
 *
 * @param origin Y 트랜잭션의 origin. 참여자의 UndoManager 가 무엇을 되돌릴지 고르는 기준이다(F-05-15).
 */
export function writeEditorChange(ydoc: Y.Doc, change: EditorChange, origin: unknown): void {
  const fragment = ydoc.getXmlFragment(BODY_FRAGMENT)
  const { doc, meta } = initProseMirrorDoc(fragment, collabSchema)
  const state = EditorState.create({ schema: blockSchema, doc, plugins: [atomMarksPlugin()] })
  const tr = state.tr
  change(tr, doc)
  // 빠른 길일 뿐이다 — 없어도 같다. `updateYFragment` 는 같은 문서에서 아무것도 쓰지 않는다(이 줄을 빼는 반사실에서
  // "바뀌지 않으면 건드리지 않는다" 검사가 통과했다).
  if (!tr.docChanged) return
  // 플러그인의 appendTransaction 까지 적용된 문서를 옮긴다 — 에디터가 옮기는 것과 같다.
  const next = state.apply(tr).doc
  ydoc.transact(() => updateYFragment(ydoc, fragment, next, meta), origin)
}
