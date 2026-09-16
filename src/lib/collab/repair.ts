/**
 * 본문 Y.Doc 수선 — 동시 편집이 만든 구조 위반을 Y.Doc 안에서 고친다 (F-05-01 · CRDT 3조각)
 *
 * 정본: 판결 X-1 · HANDOFF §3.2-14
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 Y.Doc 까지 고치는가
 * ──────────────────────────────────────────────────────────────────────
 *
 * `readBodyYDoc` 은 읽을 때마다 정규화하므로 프로젝션은 이미 올바르다. 그런데 에디터는 Y.Doc 을 그대로
 * 비춘다(`collab-schema.ts`) — 고치지 않으면 한 블록에 내용 줄이 둘인 모양이 화면에 남고, 편집 명령은 스키마에
 * 맞는 문서를 전제로 짜여 있다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 누가 고치는가 — 로그 저장소의 append 한 곳
 * ──────────────────────────────────────────────────────────────────────
 *
 * y-prosemirror 에는 옮기기가 없어 그룹 합치기 · 자식 올리기는 "지우고 새로 넣기"다. 두 참여자가 같은 위반을
 * 각자 고치면 새로 넣기가 둘이 되어 **옮긴 블록이 복제된다**(`repair.test.ts` 가 고정한다). 그래서 수선을
 * 쓰는 곳은 `appendDocUpdate` 하나다 — 페이지마다 스냅샷 행 잠금으로 한 줄로 서고, 잠근 뒤 읽은 상태(앞선
 * 수선까지)에서 계산하므로 수선끼리 겹치지 않는다. 에디터 · 협업 서버는 수선을 받아 적용할 뿐 쓰지 않는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 성질
 * ──────────────────────────────────────────────────────────────────────
 *
 *   - **프로젝션을 바꾸지 않는다** — Y.Doc 을 자기의 정규화된 읽기에 맞출 뿐이라 구성상 그렇다(`repair.test.ts` ①
 *     이 장면마다 확인한다). 그래도 사본에서 먼저 고쳐 보고 읽기가 그대로이고 고칠 것이 남지 않았을 때만 원본에
 *     적용한다 — **이 확인에 걸리는 입력은 찾지 못했다**(확인을 빼는 반사실에서 검사가 전부 통과했다). 비교가
 *     어긋나는 날 본문을 바꾸는 대신 위반을 남기게 하는 방어다
 *   - **고칠 곳만 건드린다** — `updateYFragment` 의 비교가 같은 부분을 건너뛴다. 다른 블록의 동시 편집은 남는다
 *   - **모르는 것이 있으면 고치지 않는다** — 새 버전 클라이언트가 넣은 노드 · 마크는 읽기에서 빠지므로 그 읽기에
 *     맞추면 Y.Doc 에서 지워진다. 위반을 남기는 쪽이 지우는 쪽보다 낫다(HANDOFF §7 스키마 버전 게이트)
 *   - 옮기는 수선은 옮긴 블록을 새 요소로 만든다. 수선과 **동시에** 그 블록에 친 글자는 지워진 옛 요소에 들어가
 *     사라진다 — 동시 순서 변경과 같은 한계다(§7)
 */

import * as Y from 'yjs'
import { updateYFragment } from 'y-prosemirror'

import { pmToDoc } from '../editor/pm-adapter.ts'
import { blockSchema } from '../editor/schema.ts'
import { normalizeBody, type NormalizeFix } from './normalize.ts'
import { BODY_FRAGMENT, markNameOf, readBodyPm, type BodyReadOptions } from './ydoc.ts'

/** 수선 트랜잭션의 origin. 참여자의 UndoManager 가 추적하지 않는다(F-05-15 — 내 편집만 되돌린다). */
export const REPAIR_ORIGIN = 'repair'

export type RepairResult =
  /** 고칠 것이 없다. 아무것도 쓰지 않았다. */
  | { readonly kind: 'clean' }
  /** 고쳤다. `update` 는 이미 `ydoc` 에 적용됐고, 다른 참여자에게 보낼 것이다. */
  | { readonly kind: 'repaired'; readonly update: Uint8Array; readonly fixes: readonly NormalizeFix[] }
  /** 고칠 것이 있지만 쓰지 않았다. `ydoc` 은 그대로다. */
  | {
      readonly kind: 'skipped'
      /**
       * `unknown_content` — 모르는 노드 · 마크가 있다.
       * `unverified` — 사본에서 고쳐 본 결과가 읽기와 달랐다(여기에 닿는 입력은 찾지 못했다 — 머리말).
       */
      readonly reason: 'unknown_content' | 'unverified'
      readonly fixes: readonly NormalizeFix[]
    }

/**
 * `ydoc` 의 구조 위반을 고친다. 고쳤으면 그 update 를 `ydoc` 에 적용하고 돌려준다.
 *
 * @param options 읽기와 같은 것을 넘긴다(`readBodyYDoc`) — 투영이 읽은 문서로 고쳐야 행과 Y.Doc 이 같은 자리다. 하위 페이지
 *   참조를 올린 수선은 이것 없이 읽어도 같은 문서가 된다(올린 뒤의 문서에는 이것으로도 고칠 것이 없다).
 */
export function repairBodyYDoc(ydoc: Y.Doc, pageId: string, options: BodyReadOptions = {}): RepairResult {
  const normalizeOptions = { seed: pageId, pageRefDepth: options.pageRefDepth }
  const normalized = normalizeBody(readBodyPm(ydoc), normalizeOptions)
  const { fixes } = normalized
  if (fixes.length === 0) return { kind: 'clean' }
  if (hasUnknownBodyContent(ydoc)) return { kind: 'skipped', reason: 'unknown_content', fixes }

  const expected = JSON.stringify(pmToDoc(normalized.doc))
  const probe = new Y.Doc()
  Y.applyUpdate(probe, Y.encodeStateAsUpdate(ydoc))
  const changes: Uint8Array[] = []
  const collect = (change: Uint8Array): void => void changes.push(change)
  probe.on('update', collect)
  try {
    const fragment = probe.getXmlFragment(BODY_FRAGMENT)
    // 매핑을 비워 둔다 — 모든 비교가 구조로 한다. 바인딩의 매핑은 이 사본의 노드를 모른다.
    probe.transact(() => updateYFragment(probe, fragment, normalized.doc, { mapping: new Map(), isOMark: new Map() }), REPAIR_ORIGIN)
  } finally {
    probe.off('update', collect)
  }
  const after = normalizeBody(readBodyPm(probe), normalizeOptions)
  const verified = changes.length > 0 && after.fixes.length === 0 && JSON.stringify(pmToDoc(after.doc)) === expected
  probe.destroy()
  if (!verified) return { kind: 'skipped', reason: 'unverified', fixes }

  const update = changes.length === 1 ? changes[0] : Y.mergeUpdates(changes)
  Y.applyUpdate(ydoc, update, REPAIR_ORIGIN)
  return { kind: 'repaired', update, fixes }
}

/** 본문에 이 스키마가 모르는 것이 있어 수선을 쓸 수 없는가(머리말 "모르는 것이 있으면 고치지 않는다"). */
export function hasUnknownBodyContent(ydoc: Y.Doc): boolean {
  return hasUnknownContent(ydoc.getXmlFragment(BODY_FRAGMENT))
}

/** 이 스키마가 모르는 노드 이름 · 마크 이름 · 글자가 아닌 삽입이 하나라도 있는가. */
function hasUnknownContent(parent: Y.XmlFragment | Y.XmlElement): boolean {
  for (const child of parent.toArray()) {
    if (child instanceof Y.XmlElement) {
      const type = blockSchema.nodes[child.nodeName]
      if (type === undefined || type.isText || hasUnknownContent(child)) return true
    } else if (child instanceof Y.XmlText) {
      for (const op of child.toDelta() as { insert?: unknown; attributes?: Record<string, unknown> }[]) {
        if (typeof op.insert !== 'string') return true
        for (const key of Object.keys(op.attributes ?? {})) {
          if (blockSchema.marks[markNameOf(key)] === undefined) return true
        }
      }
    } else {
      return true
    }
  }
  return false
}
