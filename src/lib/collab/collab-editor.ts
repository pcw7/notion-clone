/**
 * 협업 편집기의 상태 — 편집 플러그인을 본문 Y.Doc 에 붙인다 (F-05-01 · F-05-15 · CRDT 6a조각)
 *
 * 정본: 판결 X-1(본문의 정본은 Y.Doc) · HANDOFF §3.2-14(변환에 넘기는 스키마) · §3.2-15(서식 거울 · 기록)
 *
 * Phase 0 편집기(`editor/create-editor.ts` `createDocumentState`)와 **같은 편집 플러그인 목록**(`editingPlugins`)을 쓰고,
 * 바뀌는 것은 셋이다.
 *
 *   ① 문서가 받은 문서가 아니라 **Y.Doc 의 본문 프래그먼트**다 — `ySyncPlugin` 이 Y.Doc 을 비추고 편집을 Y.Doc 에 쓴다.
 *     상태의 스키마는 `collabSchema`(파사드)이고 **`doc` 을 넘기지 않는다** — 넘기면 `state.schema` 가 `blockSchema` 가 되어
 *     바인딩이 Y 요소를 만들다 던진 것을 원본 Y.Doc 에서 지운다(§3.2-14)
 *   ② 되돌리기가 ProseMirror history 가 아니라 **`yUndoPlugin`** 이다 — 이 참여자가 쓴 편집만 되돌리고 다른 참여자의 편집은
 *     남긴다(F-05-15). 키맵의 Mod-z · Mod-Shift-z 도 그 짝으로 바꾼다(`EditorKeymapDeps.history`)
 *   ③ 명령이 던지면 **키를 삼킨다**(`swallowCommandErrors`) — 수선이 도착하기 전까지 문서가 스키마를 어길 수 있다(HANDOFF §7).
 *     구조 위반을 여기서 고치지 않는다 — 고치는 곳은 로그 저장소 한 곳이다(§3.2-14, 둘이 고치면 옮긴 블록이 복제된다)
 *
 * 연결(provider) · 닫힘 처리 · 오프라인 보존은 이 파일이 아니다 — 상태만 만든다. 그래서 EditorView 없이 검사한다
 * (`testing/collab-peers.ts` `headless`).
 */

import type * as Y from 'yjs'
import { redoCommand, undoCommand, ySyncPlugin, yUndoPlugin } from 'y-prosemirror'
import { EditorState, type Plugin } from '@tiptap/pm/state'

import { cursorPlugins, editingPlugins, type EditorDeps } from '../editor/create-editor.ts'
import { collabSchema } from './collab-schema.ts'

export type CollabEditor = {
  readonly state: EditorState
  /** `createEditor` 에 넘길 것 — 받은 것에 되돌리기 짝과 던진 명령 삼키기를 더했다. */
  readonly deps: EditorDeps
}

/**
 * 본문 프래그먼트(`ydoc.getXmlFragment(BODY_FRAGMENT)`)에 붙은 편집기 상태.
 *
 * @param extra 편집 규칙이 아닌 플러그인 — 코멘트 하이라이트처럼 **본문을 바꾸지 않고 그리기만** 하는 것들.
 *   맨 뒤에 둔다: 키맵은 먼저 등록된 플러그인이 이기고, 이것들은 키를 잡지 않는다.
 */
export function createCollabEditorState(
  fragment: Y.XmlFragment,
  deps: EditorDeps,
  extra: readonly Plugin[] = [],
): CollabEditor {
  const collabDeps: EditorDeps = {
    ...deps,
    history: { undo: undoCommand, redo: redoCommand },
    swallowCommandErrors: true,
  }
  const state = EditorState.create({
    schema: collabSchema,
    plugins: [
      ySyncPlugin(fragment) as Plugin,
      ...editingPlugins(collabDeps),
      yUndoPlugin() as Plugin,
      ...cursorPlugins(),
      ...extra,
    ],
  })
  return { state, deps: collabDeps }
}
