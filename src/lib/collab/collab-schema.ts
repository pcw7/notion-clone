/**
 * 협업 바인딩의 스키마 — y-prosemirror 변환이 Y.Doc 을 지우지 못하게 한다 (F-05-01 · CRDT 3조각)
 *
 * 정본: 판결 X-1 · HANDOFF §3.2-14(이 판결)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 무엇을 막는가
 * ──────────────────────────────────────────────────────────────────────
 *
 * y-prosemirror 의 Y.Doc → ProseMirror 변환(`ySyncPlugin` 의 `_forceRerender` · `_typeChanged`,
 * `initProseMirrorDoc`)은 Y 요소를 `schema.node(…)` 로 만들고, 던지면 **그 Y 요소를 원본 Y.Doc 에서 지운다**
 * (`createNodeFromYElement` 의 catch). 글자도 같다 — `schema.mark(…)` 가 던지면 그 `Y.XmlText` 를 통째로
 * 지운다. `Schema.node` 는 `createChecked` 라서, 동시 편집이 흔하게 만드는 구조 위반(`normalize.ts` 머리말의
 * 표) 하나가 컨테이너를 지우고, 그래서 빈 그룹이 또 던져 루트 그룹까지 지운다 — 본문 전체다. 그 삭제는
 * 보통의 Yjs 편집이라 모든 참여자에게 퍼진다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 어떻게 막는가 — 변환에 넘기는 스키마만 관대하다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `blockSchema` 를 원형으로 둔 파사드에서 변환이 부르는 세 메서드만 바꾼다. 노드 타입 · 마크 타입은
 * `blockSchema` 의 것 그대로라 만든 노드는 `blockSchema` 의 노드다.
 *
 *   - `node` — 내용 규칙을 검사하지 않는다(`NodeType.create`). 모르는 노드 이름은 null — 변환이 건너뛴다.
 *     멘션 · 수식은 attr `marks` 에서 서식을 되살린다 — 변환은 마크를 넘기지 않는다(`editor/atom-marks.ts`)
 *   - `mark` — 모르는 이름이거나 만들 수 없는 마크(필수 attr 이 없는 링크)는 표식을 돌려준다
 *   - `text` — 그 표식을 빼고 만든다. 글자는 남고 서식만 빠진다(`ydoc.ts` 의 읽기와 같은 규칙)
 *
 * 결과 문서는 Y.Doc 을 **그대로** 비춘다 — 구조 위반까지. 고치는 것은 이 파일의 일이 아니다. 여러 참여자가
 * 각자 고쳐 쓰면 옮기기(지우고 다시 넣기)가 참여자 수만큼 겹쳐 내용이 **복제된다** — 고치는 곳은 로그
 * 저장소 한 곳이다(`repair.ts`).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 편집 스키마는 바꾸지 않았다 — 루트 하나만 예외
 * ──────────────────────────────────────────────────────────────────────
 *
 * HANDOFF §7 의 후보 ⓐ(카디널리티를 풀어 변환이 던지지 않게 한다)는 편집 명령 전부의 전제를 바꾼다 —
 * ProseMirror 가 내용을 채우고 닫고 잇는 동작(Fitter · `createAndFill` · split · join)이 그 규칙에서 나온다.
 * 파사드는 **변환에만** 관대하고 편집은 지금의 규칙 그대로다.
 *
 * 예외는 루트다(`schema.ts` 의 `doc: blockGroup+`). 바인딩은 루트를 `schema.node` 가 아니라
 * `tr.replace(0, size, …)` 로 채우고, `doc: blockGroup` 이면 그 교체가 Fitter 를 거쳐 **둘째 루트 그룹을
 * 버린다.** 버린 채로 다음 로컬 편집이 문서를 Y.Doc 에 옮기면 그 그룹이 Y.Doc 에서 지워진다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 쓰는 법
 * ──────────────────────────────────────────────────────────────────────
 *
 * 바인딩의 에디터 상태는 `EditorState.create({ schema: collabSchema, plugins: [ySyncPlugin(…)] })` 로 만들고
 * **`doc` 을 넘기지 않는다.** `EditorState.create` 는 `doc` 이 있으면 그 문서의 스키마(`blockSchema`)를
 * `state.schema` 로 쓰는데, 바인딩은 `state.schema` 를 변환에 넘긴다 — 그러면 파사드를 거치지 않는다.
 *
 * ⚠ y-prosemirror 가 변환에서 `schema.node` · `schema.mark` · `schema.text` 를 부른다는 **내부 구현**에
 *   기댄다(1.3.7 — package-lock 고정). 올리면 `collab-schema.test.ts` 의 실제 바인딩 검사가 먼저 알려준다.
 */

import type { Fragment, Mark, MarkType, Node as PmNode, NodeType, Schema } from '@tiptap/pm/model'

import { ATOM_MARKS_ATTR, INLINE_ATOM_NODES, marksFromAttr } from '../editor/atom-marks.ts'
import { blockSchema } from '../editor/schema.ts'

/** 만들 수 없는 마크의 자리. `text` 가 걸러내므로 문서에 들어가지 않는다. */
const DROPPED_MARK = Object.freeze({}) as unknown as Mark

/** `schema` 를 원형으로, 변환이 부르는 `node` · `mark` · `text` 만 던지지 않게 바꾼 파사드. */
export function tolerantSchema(schema: Schema): Schema {
  const node = (
    type: string | NodeType,
    attrs?: Record<string, unknown> | null,
    content?: Fragment | PmNode | readonly PmNode[],
    marks?: readonly Mark[],
  ): PmNode | null => {
    const nodeType = typeof type === 'string' ? schema.nodes[type] : type
    if (nodeType === undefined || nodeType.isText) return null
    try {
      // 인라인 원자의 서식은 attr 에 비쳐 있다 — y-prosemirror 는 마크를 넘기지 않는다(`editor/atom-marks.ts`).
      const restored = INLINE_ATOM_NODES.has(nodeType.name) && marks === undefined ? marksFromAttr(attrs?.[ATOM_MARKS_ATTR]) : marks
      return nodeType.create(attrs ?? null, content, restored)
    } catch {
      return null
    }
  }

  const mark = (type: string | MarkType, attrs?: Record<string, unknown> | null): Mark => {
    const markType = typeof type === 'string' ? schema.marks[type] : type
    if (markType === undefined) return DROPPED_MARK
    try {
      return markType.create(attrs ?? null)
    } catch {
      return DROPPED_MARK
    }
  }

  const text = (value: string, marks?: readonly Mark[] | null): PmNode | null => {
    // 빈 글자는 ProseMirror 가 거부한다. 변환은 null 을 건너뛴다.
    if (typeof value !== 'string' || value === '') return null
    return schema.text(value, marks?.filter((m) => m !== DROPPED_MARK))
  }

  return Object.create(schema, {
    node: { value: node },
    mark: { value: mark },
    text: { value: text },
  }) as Schema
}

/** 협업 바인딩 · 서버 쓰기 경로가 y-prosemirror 에 넘기는 스키마. 편집 규칙은 `blockSchema` 그대로다. */
export const collabSchema: Schema = tolerantSchema(blockSchema)
