/**
 * 페이지 본문의 Y.Doc 계약 — F-05-01 · 판결 X-1
 *
 * 정본: 00-canonical-data-model.md §3.7 (`doc_update` · `doc_snapshot`) · 판결 X-1 · C-11
 *       마스터 문서 §6.2 "Yjs + y-prosemirror"
 *
 * ──────────────────────────────────────────────────────────────────────
 * Y.Doc 안의 모양 — ProseMirror 스키마가 곧 저장 포맷이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 페이지 1개 = Y.Doc 1개. 본문은 `getXmlFragment('body')` 하나에, y-prosemirror 가 ProseMirror
 * 문서(`editor/schema.ts`)를 옮긴 모양 그대로 산다 — `blockGroup > blockContainer(blockId) > 내용 노드`.
 * 요소 이름은 노드 이름, 요소 attr 은 노드 attr, 글자의 서식은 `Y.XmlText` 의 attr(마크 이름 → 마크
 * attr)이다. 그래서 **노드 · 마크 · attr 이름을 바꾸는 것은 마이그레이션이다.** 프래그먼트 이름도 같다 —
 * 바꾸면 저장된 모든 본문이 빈 문서로 읽힌다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 빈 페이지도 빈 문단 하나를 담는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 빈 프래그먼트를 받은 참여자는 각자 루트 그룹을 넣고, 둘이 동시에 열면 루트 그룹이 둘이 된다. 그래서
 * Y.Doc 을 **만드는 한 곳**이 빈 문단을 넣어 두고(`createBodyYDoc` — `docToPm` 이 빈 문서를 빈 문단으로
 * 합성한다), 읽을 때는 `pmToDoc` 이 그 한 줄을 빈 문서로 되돌린다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 읽기는 y-prosemirror 의 변환을 쓰지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * y-prosemirror 의 Y.Doc → ProseMirror 변환(`initProseMirrorDoc` · `ySyncPlugin`)은 노드를
 * `Schema.node` — 즉 **`createChecked`** — 로 만들고, 던지면 **그 Y 요소를 지운다**
 * (`createNodeFromYElement` 의 catch). 동시 편집은 스키마를 어기는 모양을 흔하게 만든다(`normalize.ts`
 * 머리말의 표). 타입을 동시에 바꿔 내용 노드가 둘 된 컨테이너 하나가 지워지면 루트 그룹이 비어 또 던지고
 * **루트 그룹까지 지운다.** 진단에서 실제로 본문 전체가 빈 문서로 읽혔다(`ydoc.test.ts` ④).
 *
 * 그래서 `readBodyYDoc` 은 Y 요소를 **검사하지 않는** `NodeType.create` 로 직접 옮기고, 구조 위반은
 * `normalizeBody` 가 고친다. 성질 셋:
 *   - **원본을 바꾸지 않는다** — 읽기만 한다
 *   - **던지지 않는다** — 모르는 노드는 결과에서 빼고(원본에는 남는다), 모르는 마크는 글자는 두고 서식만 뺀다
 *   - **결정론** — 수렴한 두 Y.Doc 은 새로 매긴 id 까지 같은 문서로 읽힌다
 *
 * 바인딩이 쓰는 `collabSchema`(`collab-schema.ts`)로 변환하면 지우지는 않지만, 그 변환은 이 참여자가 만든
 * 이웃 글자 요소를 합치며 Y.Doc 을 고친다(y-prosemirror #160 처리). 읽기는 원본을 바꾸면 안 되므로 여전히 직접 옮긴다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 알고 있는 손실 · 위험 (HANDOFF §7)
 * ──────────────────────────────────────────────────────────────────────
 *
 *   - 위의 연쇄 삭제는 에디터 바인딩(`ySyncPlugin`)에서는 원본 Y.Doc 에서 일어나고 모든 참여자에게 퍼진다 —
 *     **바인딩 · 서버 쓰기 경로는 `collabSchema` 를 넘겨 막는다.** 구조 위반은 로그 저장소가 append 에서
 *     한 번 고친다(`repair.ts`)
 *   - y-prosemirror 는 요소 노드를 옮길 때 attr 만 싣고 **마크를 싣지 않는다**(`createTypeFromElementNode`).
 *     그래서 멘션 · 수식의 서식은 노드 attr `marks` 에 비쳐 싣고, 읽을 때 되살린다(`editor/atom-marks.ts`)
 *   - y-prosemirror 에는 "옮기기"가 없다. 순서를 바꾸면 요소를 제자리에서 고쳐 쓰므로, 둘이 동시에 순서를
 *     바꾸면 blockId 가 겹치거나(정규화가 새 id 를 준다) 글자가 겹칠 수 있다(되돌리지 않는다)
 */

import * as Y from 'yjs'
import { prosemirrorToYXmlFragment } from 'y-prosemirror'
import type { Mark, Node as PmNode } from '@tiptap/pm/model'

import type { EditorDoc } from '../editor/document.ts'
import { ATOM_MARKS_ATTR, INLINE_ATOM_NODES, marksFromAttr } from '../editor/atom-marks.ts'
import { docToPm, pmToDoc } from '../editor/pm-adapter.ts'
import { blockSchema } from '../editor/schema.ts'
import { normalizeBody, type NormalizeFix, type NormalizeOptions } from './normalize.ts'

/** 본문이 사는 `Y.XmlFragment` 의 이름. 저장 포맷의 일부다 — 바꾸지 않는다. */
export const BODY_FRAGMENT = 'body'

/**
 * 문서로 새 Y.Doc 을 만든다. **처음 한 번**만 쓴다 — 기존 Phase 0 페이지를 옮길 때와 새 페이지.
 *
 * 이미 편집이 쌓인 Y.Doc 을 이것으로 다시 만들면 CRDT 이력이 끊겨, 다른 참여자의 update 가 새 문서에
 * 붙지 않는다(y-prosemirror `prosemirrorToYDoc` 주석과 같은 경고).
 */
export function createBodyYDoc(doc: EditorDoc): Y.Doc {
  const ydoc = new Y.Doc()
  prosemirrorToYXmlFragment(docToPm(doc), ydoc.getXmlFragment(BODY_FRAGMENT))
  return ydoc
}

export type BodyRead = {
  readonly doc: EditorDoc
  /** 정규화가 고친 것. 비었으면 Y.Doc 이 이미 스키마에 맞았다. */
  readonly fixes: readonly NormalizeFix[]
}

/** 읽기가 정규화에 더 넘기는 것 — 문서 밖의 사실(`NormalizeOptions`). */
export type BodyReadOptions = Pick<NormalizeOptions, 'pageRefDepth' | 'pageRefs'>

/**
 * Y.Doc → 문서. 원본을 바꾸지 않고, 던지지 않고, 결정론적이다(머리말).
 *
 * @param pageId 이 Y.Doc 의 페이지. 정규화가 새 id 를 만들 때의 씨앗이다(`NormalizeOptions.seed`).
 * @param options 하위 페이지 참조를 행에 맞춘다(놓일 수 있는 깊이 · 둘 수 있는 페이지) — 투영만 넘긴다(`block/body-write.ts`).
 */
export function readBodyYDoc(ydoc: Y.Doc, pageId: string, options: BodyReadOptions = {}): BodyRead {
  const normalized = normalizeBody(readBodyPm(ydoc), { seed: pageId, pageRefDepth: options.pageRefDepth, pageRefs: options.pageRefs })
  return { doc: pmToDoc(normalized.doc), fixes: normalized.fixes }
}

/**
 * Y.Doc → ProseMirror 문서, 고치지 않고. 구조 위반까지 Y.Doc 을 그대로 비춘다 — 스키마에 맞는다고 가정하지 마라.
 * 모르는 노드 · 마크만 빠진다(머리말). 원본을 바꾸지 않고 던지지 않는다.
 */
export function readBodyPm(ydoc: Y.Doc): PmNode {
  return blockSchema.nodes.doc.create(null, childrenToPm(ydoc.getXmlFragment(BODY_FRAGMENT)))
}

/** Y 글자 attr 의 키 → 마크 이름. y-prosemirror 가 겹칠 수 있는 마크에 붙이는 해시를 뗀다. */
export function markNameOf(key: string): string {
  return HASHED_MARK.exec(key)?.[1] ?? key
}

// ── Y 요소 → ProseMirror 노드 (검사하지 않는다) ─────────────────────────

function childrenToPm(parent: Y.XmlFragment | Y.XmlElement): PmNode[] {
  const out: PmNode[] = []
  for (const child of parent.toArray()) {
    if (child instanceof Y.XmlElement) {
      const node = elementToPm(child)
      if (node !== null) out.push(node)
    } else if (child instanceof Y.XmlText) {
      out.push(...textToPm(child))
    }
  }
  return out
}

function elementToPm(element: Y.XmlElement): PmNode | null {
  const type = blockSchema.nodes[element.nodeName]
  // 모르는 노드 이름 — 새 버전 클라이언트가 넣은 블록이다. 읽기 결과에서만 빠지고 원본에는 남는다.
  if (type === undefined || type.isText) return null
  try {
    const attrs = element.getAttributes() as Record<string, unknown>
    // 인라인 원자의 서식은 attr 에 비쳐 있다(`editor/atom-marks.ts`).
    const marks = INLINE_ATOM_NODES.has(type.name) ? marksFromAttr(attrs[ATOM_MARKS_ATTR]) : undefined
    return type.create(attrs, childrenToPm(element), marks)
  } catch {
    return null
  }
}

function textToPm(text: Y.XmlText): PmNode[] {
  const out: PmNode[] = []
  for (const op of text.toDelta() as { insert?: unknown; attributes?: Record<string, unknown> }[]) {
    if (typeof op.insert !== 'string' || op.insert === '') continue
    out.push(blockSchema.text(op.insert, marksOf(op.attributes)))
  }
  return out
}

/** y-prosemirror 가 겹칠 수 있는 마크 이름에 붙이는 해시(`marksToAttributes`). */
const HASHED_MARK = /(.*)(--[a-zA-Z0-9+/=]{8})$/

function marksOf(attributes: Record<string, unknown> | undefined): Mark[] {
  const marks: Mark[] = []
  for (const [key, value] of Object.entries(attributes ?? {})) {
    const type = blockSchema.marks[markNameOf(key)]
    // 모르는 마크 — 글자는 두고 서식만 뺀다. y-prosemirror 는 이때 글자까지 지운다.
    if (type === undefined) continue
    try {
      marks.push(type.create(value as Record<string, unknown> | null))
    } catch {
      // 필수 attr 이 없는 마크(주소 없는 링크 같은 것) — 서식만 뺀다.
    }
  }
  return marks
}
