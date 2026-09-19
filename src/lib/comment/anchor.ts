/**
 * 인라인 코멘트의 앵커 — 글자 범위를 동시 편집 위에서 가리킨다 (F-05-07 · 코멘트 2조각)
 *
 * 정본: 00-canonical-data-model.md §3.9 `discussion.anchor` — *"RelativePosition 범위 + quoted_text 폴백"*
 *       05-collaboration-sync.md F-05-07 엣지 케이스 표
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 오프셋이 아니라 RelativePosition 인가
 * ──────────────────────────────────────────────────────────────────────
 *
 * "12번째 글자부터 30번째까지"는 **다른 사람이 앞에 한 글자만 쳐도 틀린 곳을 가리킨다.** Yjs 의 상대 위치는 글자
 * 자체(항목 id)를 가리키므로 앞뒤가 바뀌어도 같은 글자를 따라간다. 정본이 그래서 이 표현을 골랐다.
 *
 * 실제로 재 보고 정한 것(진단 스크립트로 측정, HANDOFF §3.3-128):
 *
 *   · 범위 **앞**에 넣은 글자 — 범위는 밀리고 내용은 그대로
 *   · 범위 **안**에 넣은 글자 — 범위가 늘어난다(하이라이트가 자란다)
 *   · 범위 **바로 뒤**에 이어 친 글자 — **범위 안으로 들어온다.** 처음에는 반대로 적었다가 재 보고 고쳤다. 끝 위치의
 *     `assoc` 을 -1 로 바꿔도 오히려 한 글자를 더 먹는다 — y-prosemirror 의 위치 변환이 `assoc` 을 보지 않는다.
 *     명세(05 F-05-07)가 요구한 것은 "가운데만 지우면 축소"이고 오른쪽 끝의 자람은 명세에 없다. 끝을 **마지막 글자**에
 *     묶으면 오른쪽은 고쳐지지만 그 글자를 지울 때 다음 글자를 먹는다 — 명세에 있는 쪽을 지켰다(HANDOFF §3.3-129)
 *   · 범위의 글자를 전부 지움 — 시작과 끝이 같아진다(길이 0) → 고아
 *   · 블록을 통째로 지움 — 풀리지 않는다(null) → 고아
 *   · **아직 서버에 도착하지 않은 글자를 가리키면 풀리지 않는다.** 그 update 가 도착하면 스스로 풀린다
 *
 * 마지막 것이 이 모듈의 설계를 정했다. **앵커는 Y.Doc 을 가진 쪽이 만든다** — 편집기가 자기 문서에서 만들어 보내고,
 * 서버는 풀리지 않아도 받아 둔다. 서버가 오프셋을 받아 자기 문서에서 만들면, 보낸 사람이 방금 친 글자를 서버가 아직
 * 모르는 동안 **엉뚱한 글자**에 코멘트가 붙는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 자리는 ProseMirror 위치로 센다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 한 블록의 글자가 Y.XmlText 하나에 들어 있지 않다 — 멘션 · 수식 같은 인라인 원자가 사이에 있으면 `XmlText("앞")
 * <mention/> XmlText("뒤")` 로 쪼개진다(측정). 그래서 "블록 안 몇 번째 글자"를 Y 타입 하나의 인덱스로 표현할 수 없다.
 *
 * y-prosemirror 가 커서를 옮길 때 쓰는 변환(`absolutePositionToRelativePosition`)이 정확히 그 일을 한다 — 문서 전체의
 * ProseMirror 위치 ↔ 상대 위치. 그 변환에 필요한 `mapping` 은 `initProseMirrorDoc` 이 준다. **그 함수는 Y.Doc 을 바꾸지
 * 않는다**(update 이벤트 0 · 바이트 동일, 측정). `collabSchema` 를 넘기는 것은 다른 변환과 같은 이유다 — `blockSchema` 를
 * 넘기면 구조 위반을 만난 Y 요소를 지운다(§3.2-14).
 *
 * 밖으로 내보내는 범위는 **블록 안 오프셋**이다(0 = 블록의 첫 글자 앞). 문서 전체 위치는 그 문서의 것이라 화면 · 행 ·
 * 다른 세션 사이에서 뜻이 달라진다.
 */

import * as Y from 'yjs'
import { absolutePositionToRelativePosition, initProseMirrorDoc, relativePositionToAbsolutePosition } from 'y-prosemirror'
import type { Node as PmNode } from '@tiptap/pm/model'

import { collabSchema } from '../collab/collab-schema.ts'
import { BODY_FRAGMENT } from '../collab/ydoc.ts'

/**
 * 표시용 원문 스냅샷의 길이 상한.
 *
 * 05 F-05-07 은 *"`quoted_text` 는 앵커 유실 시 표시용 fallback 으로 반드시 저장한다"* 고 했다. 내용이 아니라 미리보기이므로
 * 넘치면 **자른다** — 긴 문단을 통째로 긁어 코멘트를 달았다고 거부하면 쓸 수 없다.
 */
export const MAX_QUOTED_TEXT = 300

export const ANCHOR_KIND = 'text_range'

export type TextRangeAnchor = {
  readonly kind: typeof ANCHOR_KIND
  /** Y.RelativePosition 을 base64 로. */
  readonly start: string
  readonly end: string
  /** 앵커를 풀 수 없을 때 보여줄 원문(만들 때의 스냅샷). */
  readonly quotedText: string
}

export type AnchorRange = {
  /** 블록 안 오프셋. 시작 ≤ 끝이고, 같으면 범위가 지워진 것이다(고아). */
  readonly start: number
  readonly end: number
  /** 지금 그 범위의 글자 — 가운데가 지워졌으면 줄어들어 있다. */
  readonly text: string
}

// ── Y.Doc 을 ProseMirror 로 (바꾸지 않는다) ───────────────────────────

type BodyView = {
  readonly doc: PmNode
  readonly fragment: Y.XmlFragment
  readonly mapping: Map<unknown, unknown>
}

/** 읽기 전용 변환. 같은 Y.Doc 을 여러 번 풀 때는 한 번 만들어 돌려 쓴다. */
export function bodyView(ydoc: Y.Doc): BodyView {
  const fragment = ydoc.getXmlFragment(BODY_FRAGMENT)
  const { doc, mapping } = initProseMirrorDoc(fragment, collabSchema)
  return { doc, fragment, mapping: mapping as Map<unknown, unknown> }
}

type BlockBounds = {
  /** 블록의 첫 글자 **앞** 위치. */
  readonly from: number
  /** 블록의 마지막 글자 **뒤** 위치. */
  readonly to: number
}

/** 이 블록의 글자가 놓인 문서 위치 범위. 블록이 없으면 null. */
function boundsOf(doc: PmNode, blockId: string): BlockBounds | null {
  let bounds: BlockBounds | null = null
  doc.descendants((node, pos) => {
    if (bounds !== null) return false
    if (node.type.name !== 'blockContainer' || String(node.attrs.blockId ?? '') !== blockId) return true
    const content = node.child(0)
    // 컨테이너 앞이 `pos` → 내용 노드 앞이 `pos + 1` → 글자의 시작이 `pos + 2`(`testing/collab-peers.ts` 와 같은 셈).
    bounds = { from: pos + 2, to: pos + 1 + content.nodeSize - 1 }
    return false
  })
  return bounds
}

// ── 만들기 ────────────────────────────────────────────────────────────

/**
 * 블록 안 오프셋으로 앵커를 만든다 — **Y.Doc 을 가진 쪽**이 부른다(편집기 · 검사).
 *
 * 범위가 블록 밖으로 나가거나 비어 있으면 null 이다. 빈 범위에는 코멘트를 달 수 없다 — 만드는 순간 이미 고아다.
 */
export function textRangeAnchor(ydoc: Y.Doc, blockId: string, start: number, end: number): TextRangeAnchor | null {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start >= end || start < 0) return null
  const view = bodyView(ydoc)
  const bounds = boundsOf(view.doc, blockId)
  if (bounds === null) return null
  const from = bounds.from + start
  const to = bounds.from + end
  if (to > bounds.to) return null

  const relStart = absolutePositionToRelativePosition(from, view.fragment, view.mapping as never)
  const relEnd = absolutePositionToRelativePosition(to, view.fragment, view.mapping as never)
  return {
    kind: ANCHOR_KIND,
    start: encode(relStart),
    end: encode(relEnd),
    quotedText: view.doc.textBetween(from, to).slice(0, MAX_QUOTED_TEXT),
  }
}

const encode = (relative: unknown): string => Buffer.from(Y.encodeRelativePosition(relative as never)).toString('base64')

/**
 * 상대 위치 바이트를 읽는다. 읽히지 않거나 **아무것도 가리키지 않으면** null.
 *
 * 망가진 바이트가 늘 던지지는 않는다 — `[9,9,9,9]` 는 `{assoc: 9}` 가 된다(측정). 항목도 타입도 없는 위치는 영원히
 * 풀리지 않으므로 받아 두지 않는다.
 */
function decode(value: unknown): Y.RelativePosition | null {
  if (typeof value !== 'string' || value === '' || value.length > 512) return null
  try {
    const relative = Y.decodeRelativePosition(new Uint8Array(Buffer.from(value, 'base64')))
    const parts = relative as unknown as { item: unknown | null; type: unknown | null; tname: unknown | null }
    if (parts.item === null && parts.type === null && parts.tname === null) return null
    return relative
  } catch {
    return null
  }
}

/**
 * 밖에서 들어온 앵커를 받을 수 있는 모양으로 — 아니면 null.
 *
 * **풀리는지는 보지 않는다.** 보낸 쪽이 방금 친 글자를 가리키면 그 update 가 도착하기 전까지 풀리지 않는데(측정),
 * 그때 거부하면 "방금 고른 글에 코멘트 달기"가 끊긴다. 자리가 맞는지는 풀릴 때 본다.
 */
export function acceptAnchor(raw: unknown): TextRangeAnchor | null {
  if (typeof raw !== 'object' || raw === null) return null
  const input = raw as { start?: unknown; end?: unknown; quotedText?: unknown }
  if (decode(input.start) === null || decode(input.end) === null) return null
  if (typeof input.quotedText !== 'string' || input.quotedText === '') return null
  return {
    kind: ANCHOR_KIND,
    start: input.start as string,
    end: input.end as string,
    quotedText: input.quotedText.slice(0, MAX_QUOTED_TEXT),
  }
}

// ── 풀기 ──────────────────────────────────────────────────────────────

/**
 * 지금 본문에서 앵커가 가리키는 범위. 풀리지 않거나 그 블록 밖이면 null 이다.
 *
 * 길이 0 은 null 이 아니라 **빈 범위**로 돌려준다 — "가운데가 다 지워졌다"와 "블록이 없다"를 부르는 쪽이 구분할 수
 * 있어야 한다. 둘 다 화면에서는 고아지만, 전자는 되살아날 수 있다.
 */
export function resolveTextRangeAnchor(
  ydoc: Y.Doc,
  blockId: string,
  anchor: TextRangeAnchor,
  view: BodyView = bodyView(ydoc),
): AnchorRange | null {
  const relStart = decode(anchor.start)
  const relEnd = decode(anchor.end)
  if (relStart === null || relEnd === null) return null
  const bounds = boundsOf(view.doc, blockId)
  if (bounds === null) return null

  const from = relativePositionToAbsolutePosition(ydoc, view.fragment, relStart, view.mapping as never)
  const to = relativePositionToAbsolutePosition(ydoc, view.fragment, relEnd, view.mapping as never)
  if (from === null || to === null || to < from) return null
  // 다른 블록으로 간 위치는 이 스레드의 것이 아니다 — 블록을 지웠다 되살린 문서가 그럴 수 있다.
  if (from < bounds.from || to > bounds.to) return null

  return { start: from - bounds.from, end: to - bounds.from, text: view.doc.textBetween(from, to) }
}

// ── 저장 모양 ─────────────────────────────────────────────────────────

/** `discussion.anchor` 에 들어가는 모양. 키 이름은 정본 §3.9 의 예시를 따른다(`quoted_text`). */
export function storedAnchor(anchor: TextRangeAnchor): Record<string, string> {
  return { kind: anchor.kind, start: anchor.start, end: anchor.end, quoted_text: anchor.quotedText }
}

/** 행에서 읽은 것을 앵커로. 모르는 모양이면 null 이다(읽기는 던지지 않는다). */
export function anchorFromStored(raw: unknown): TextRangeAnchor | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as { kind?: unknown; start?: unknown; end?: unknown; quoted_text?: unknown }
  if (row.kind !== ANCHOR_KIND) return null
  if (typeof row.start !== 'string' || typeof row.end !== 'string' || typeof row.quoted_text !== 'string') return null
  return { kind: ANCHOR_KIND, start: row.start, end: row.end, quotedText: row.quoted_text }
}
