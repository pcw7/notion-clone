/**
 * Enter 분할 · Backspace 병합 규칙 — F-01-19
 *
 * 정본: 01-block-editor.md F-01-19
 *       마스터 문서 §7-4 (난제 TOP 7 의 4위) · §9-Q7
 *
 * ──────────────────────────────────────────────────────────────────────
 * 이 파일이 존재하는 이유
 * ──────────────────────────────────────────────────────────────────────
 *
 * 마스터 문서 §9-Q7 이 이 규칙을 **"W4 이전 필수"** 로 지정했다:
 *   "규칙만 바뀐다(스키마 무변경). **단 미정 상태로 구현하면 구현자마다 다르게
 *    만든다.**"
 *
 * 그래서 규칙을 **ProseMirror 커맨드 안에 흩어놓지 않고** 순수 함수로 뽑았다.
 * 화면도 DOM 도 트랜잭션도 없이 결정만 계산한다. 덕분에:
 *
 *   - 자식이 사라지는가(§7-4 가 "최빈 버그"로 지목한 것)를 단위 테스트로 본다
 *   - 규칙을 바꿀 때 고칠 자리가 한 곳이다
 *   - 에디터(F-01-19 클론 대안: "직접 구현하지 않는다")는 ProseMirror 의
 *     `splitBlock`/`joinBackward` 를 쓰고, **여기서 나온 계획대로 예외만 조정**한다
 *
 * ──────────────────────────────────────────────────────────────────────
 * 정본이 판결한 것 / 우리가 정한 것
 * ──────────────────────────────────────────────────────────────────────
 *
 * **정본이 판결한 것** (바꾸려면 정본 문서를 먼저 고친다)
 *   - 분할: 새 블록 타입은 원본과 동일. 단 `heading_*`/`quote`/`callout` → `paragraph`
 *   - 분할: 자식은 **원본에 남긴다**. 새 블록은 자식 없이 생성
 *   - 분할: `to_do.checked` 는 새 블록에서 false, `block_color` 는 상속
 *   - 병합: **앞 블록의 타입이 이긴다**
 *   - 병합: 뒤 블록의 자식은 앞 블록의 자식 **끝으로** 이관
 *   - 병합: 앞 블록이 자식 불가 타입이면 병합 차단 → "빈 블록이면 삭제" 폴백
 *   - 병합: 앞 블록이 `divider`/`image` 면 병합 불가 → **앞 블록을 선택 상태로**
 *   - 병합: 배열 100 요소 초과면 **잘라내지 말고 거부**
 *   - 빈 블록 Enter: 리스트/투두면 리스트 탈출, `paragraph` 면 새 빈 블록
 *   - 빈 블록 Backspace: 타입 되돌림 → 이미 `paragraph` 면 삭제 + 이전 블록 끝으로
 *
 * **정본이 "분기하라"고만 하고 정하지 않은 것 — 여기서 정한다**
 *   ① 새 블록을 형제로 넣는가 첫 자식으로 넣는가
 *      (F-01-19: "새 블록이 자식보다 앞에 오므로 … 분기")
 *      → **자식이 있고 펼쳐져 있으면 첫 자식, 그 외에는 형제.**
 *        기준은 하나다: *새 블록이 화면에서 원본 바로 다음 줄에 와야 한다.*
 *        자식이 펼쳐져 있는데 형제로 넣으면 방금 Enter 를 누른 자리와
 *        새 블록 사이에 자식들이 끼어든다. 접혀 있으면 자식이 화면에 없으므로
 *        형제가 곧 바로 다음 줄이다. **어느 경우에도 자식을 옮기지 않는다** —
 *        자식 이동이 §7-4 가 말한 "자식이 사라지는" 버그의 발원지다.
 *
 *   ② 앞 블록이 접힌 컨테이너인데 뒤 블록에 자식이 있는 병합
 *      → **병합하면서 앞 블록을 펼친다**(`expandTarget`).
 *        이관된 자식이 접힌 컨테이너 안으로 사라지면 사용자에게는 삭제로 보인다.
 *        거부하는 것보다 펼치는 쪽이 손실이 없다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 범위 밖
 * ──────────────────────────────────────────────────────────────────────
 * `code` 블록의 Enter/Backspace 예외(F-01-14)는 여기 없다. **MVP 12종에
 * `code` 가 없기 때문이다**(`block/types.ts`). 추가할 때는 레지스트리에
 * `splitsOnEnter: false` 같은 항목을 넣어 이 파일이 타입 표만 보고 분기하게
 * 한다 — 여기에 `if (type === 'code')` 를 심지 않는다.
 */

import {
  specOf,
  normalizeFormat,
  type BlockFormat,
  type BlockType,
  type MvpBlockType,
} from '../block/types.ts'
import type { RichTextRun } from '../contracts/rich-text.ts'
import { concatRuns, splitRunsAt, unitLength } from './rich-text-ops.ts'

// ── 입력 ──────────────────────────────────────────────────────────────

/**
 * 규칙 판정에 필요한 블록의 최소 정보.
 *
 * 일부러 `block` 테이블 행도 ProseMirror 노드도 아니다. 양쪽에서 이 모양으로
 * 만들어 넣으면 같은 규칙이 서버(프로젝터)와 클라이언트(에디터)에 동시에 적용된다.
 */
export type RuleBlock = {
  readonly type: BlockType
  /** `properties.title`. 텍스트를 담지 않는 타입이면 빈 배열. */
  readonly title: readonly RichTextRun[]
  readonly properties?: Readonly<Record<string, unknown>>
  readonly format?: BlockFormat
  readonly hasChildren: boolean
  /** 접힌 컨테이너인가. 접혀 있으면 자식이 화면에 없다. */
  readonly collapsed: boolean
}

/**
 * 빈 상태에서 Enter 를 누르면 타입을 되돌리는(=리스트를 탈출하는) 타입들.
 *
 * 정본은 "리스트/투두"만 열거하지만 `quote`·`callout`·`toggle` 도 같은 문제를
 * 갖는다 — 들어가면 나올 방법이 필요하다. `heading_*` 은 넣지 않았다:
 * 빈 헤딩에서 Enter 는 "제목을 쓰다 말고 본문으로 넘어간다"는 흐름이고,
 * 타입 규칙이 이미 새 블록을 `paragraph` 로 만들어 주므로 탈출이 저절로 된다.
 */
const ESCAPABLE_ON_EMPTY: ReadonlySet<BlockType> = new Set<BlockType>([
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'toggle',
  'quote',
  'callout',
])

/**
 * 분할 시 타입을 승계하지 않고 `paragraph` 로 바꾸는 타입들.
 *
 * 정본 근거: "헤딩 뒤에 본문을 쓰는 것이 압도적으로 흔한 흐름". `quote`·`callout`
 * 도 같은 이유로 열거되어 있다.
 */
const SPLITS_INTO_PARAGRAPH: ReadonlySet<BlockType> = new Set<BlockType>([
  'heading_1',
  'heading_2',
  'heading_3',
  'quote',
  'callout',
])

// ── 분할 (Enter) ──────────────────────────────────────────────────────

export type NewBlockPlacement = 'sibling_after' | 'first_child'

export type SplitPlan =
  /** 빈 리스트/투두/컨테이너에서 Enter — 타입만 paragraph 로 되돌린다. 블록을 만들지 않는다. */
  | { readonly kind: 'escape_to_paragraph' }
  /** 텍스트를 담지 않는 블록(divider·image)에서 Enter — 뒤에 빈 문단을 넣는다. */
  | { readonly kind: 'insert_paragraph_after' }
  /** 실제 분할. */
  | {
      readonly kind: 'split'
      /** 원본 블록에 남는 텍스트. */
      readonly head: RichTextRun[]
      /** 새 블록으로 가는 텍스트. */
      readonly tail: RichTextRun[]
      readonly newType: MvpBlockType
      readonly newPlacement: NewBlockPlacement
      readonly newProperties: Record<string, unknown>
      readonly newFormat: BlockFormat
      /**
       * 원본의 자식을 옮기는가. **항상 false 다.**
       * 필드로 남겨둔 이유는 "자식을 옮기지 않는다"가 규칙이라는 것을
       * 호출자와 리뷰어에게 보이게 하기 위해서다 — F-01-19 가 이 지점을
       * "가장 흔한 버그"로 지목했다.
       */
      readonly movesChildren: false
    }

/**
 * Enter 를 눌렀을 때 무엇을 할지 계산한다.
 *
 * @param offset 캐럿 오프셋. 단위는 `rich-text-ops.ts` 가 확정한 **문서 단위**
 *   (원자는 길이 1)이며 문자 인덱스가 아니다.
 */
export function planSplit(block: RuleBlock, offset: number): SplitPlan {
  const spec = specOf(block.type)

  // divider·image 는 텍스트가 없어 쪼갤 것이 없다.
  if (!spec.hasRichText) return { kind: 'insert_paragraph_after' }

  const total = unitLength(block.title)

  // 빈 블록에서의 탈출. 자식이 있으면 탈출시키지 않는다 — 컨테이너를 문단으로
  // 바꾸면 자식은 남지만 컨테이너였다는 사실이 조용히 사라진다.
  if (total === 0 && !block.hasChildren && ESCAPABLE_ON_EMPTY.has(block.type)) {
    return { kind: 'escape_to_paragraph' }
  }

  const { head, tail } = splitRunsAt(block.title, offset)
  const newType = (
    SPLITS_INTO_PARAGRAPH.has(block.type) ? 'paragraph' : block.type
  ) as MvpBlockType

  return {
    kind: 'split',
    head,
    tail,
    newType,
    newPlacement: placementFor(block),
    newProperties: newPropertiesFor(newType),
    newFormat: inheritedFormat(newType, block.format),
    movesChildren: false,
  }
}

/**
 * 새 블록이 형제인가 첫 자식인가 — 위 머리말 ① 의 판결.
 *
 * 자식을 옮기지 않으면서 "새 블록은 화면에서 원본 바로 다음"을 지키는 유일한 방법이다.
 */
function placementFor(block: RuleBlock): NewBlockPlacement {
  if (!block.hasChildren) return 'sibling_after'
  if (block.collapsed) return 'sibling_after'
  // 펼쳐진 자식이 있다. 형제로 넣으면 자식들 아래로 밀려난다.
  return specOf(block.type).canHaveChildren ? 'first_child' : 'sibling_after'
}

/**
 * 새 블록의 properties.
 *
 * `checked` 를 복제하지 않는 것이 정본의 요구다("완료 표시가 복제되면 잘못된 상태").
 * 원본의 properties 를 통째로 복사하지 않고 **필요한 것만 새로 만든다** —
 * 복사 후 지우는 방식은 나중에 타입이 늘어날 때 지우는 것을 빠뜨린다.
 */
function newPropertiesFor(newType: MvpBlockType): Record<string, unknown> {
  if (newType === 'to_do') return { checked: false }
  return {}
}

/** `block_color` 만 상속한다. 지원하지 않는 타입이면 normalizeFormat 이 버린다. */
function inheritedFormat(newType: MvpBlockType, format: BlockFormat | undefined): BlockFormat {
  return normalizeFormat(newType, { block_color: format?.block_color })
}

// ── 병합 (Backspace / Delete) ─────────────────────────────────────────

export type MergePlan =
  /** 빈 블록인데 타입이 paragraph 가 아니다 — 먼저 타입만 되돌린다. */
  | { readonly kind: 'revert_type_to_paragraph' }
  /** 이전 블록이 없다. 아무 것도 하지 않는다. */
  | { readonly kind: 'noop' }
  /** 이전 블록이 divider·image — 병합 대신 그 블록을 선택 상태로 만든다(삭제 대기). */
  | { readonly kind: 'select_target' }
  /** 병합할 수 없다. 사용자에게 이유를 보여준다. */
  | {
      readonly kind: 'blocked'
      readonly reason: 'too_many_runs' | 'target_cannot_have_children'
      readonly detail: string
    }
  /** 병합. */
  | {
      readonly kind: 'merge'
      /** 살아남는 블록의 타입 — **앞 블록이 이긴다.** */
      readonly resultType: BlockType
      readonly resultTitle: RichTextRun[]
      /** 병합 후 캐럿 위치. 이어붙인 경계 = 앞 블록의 원래 길이. */
      readonly caretOffset: number
      /** 사라지는 블록의 자식을 앞 블록의 자식 끝으로 옮기는가. */
      readonly movesChildren: boolean
      /** 앞 블록이 접혀 있는데 자식이 들어온다 — 펼쳐야 자식이 보인다. */
      readonly expandTarget: boolean
    }

/**
 * 병합을 계산한다.
 *
 * @param source 사라질 블록. Backspace 면 캐럿이 있는 블록, Delete 면 다음 블록.
 * @param target 살아남을 블록. Backspace 면 **화면에서 이전** 블록, Delete 면 캐럿이 있는 블록.
 *
 * ⚠ `target` 은 트리 순서상의 이전 블록이 아니라 **화면에 보이는 이전 블록**이어야
 * 한다. F-01-19: "접힌 토글 뒤에서 Backspace → 토글 subtree 전체와 병합되는 것처럼
 * 보이면 안 된다. 접힌 토글 **제목**과 병합하되 자식은 그대로 토글에 남긴다."
 * 트리 순서로 계산하면 접힌 토글의 **마지막 자손**(화면에 없는 블록)과 합쳐진다.
 * 그래서 `tree.ts` 의 `flattenVisible()` 로 이웃을 구해 넣는다.
 */
export function planMerge(source: RuleBlock, target: RuleBlock | null): MergePlan {
  const sourceEmpty = unitLength(source.title) === 0

  // 빈 블록의 Backspace 는 먼저 타입을 되돌린다. 이 단계에서는 이전 블록을
  // 보지 않는다 — 되돌릴 타입이 있으면 그것이 먼저다(F-01-01 · F-01-19).
  if (sourceEmpty && !source.hasChildren && source.type !== 'paragraph' && specOf(source.type).hasRichText) {
    return { kind: 'revert_type_to_paragraph' }
  }

  if (target === null) return { kind: 'noop' }

  // 앞 블록이 텍스트를 담지 않는다(divider·image). 이어붙일 자리가 없다.
  if (!specOf(target.type).hasRichText) return { kind: 'select_target' }

  const movesChildren = source.hasChildren
  if (movesChildren && !specOf(target.type).canHaveChildren) {
    // 정본: "자식 불가 타입이면 병합 자체를 차단하고 대신 '빈 블록이면 삭제'
    // 동작으로 폴백." 빈 블록이 아니면 차단이 최종 결론이다.
    if (sourceEmpty) {
      return {
        kind: 'merge',
        resultType: target.type,
        resultTitle: [...target.title],
        caretOffset: unitLength(target.title),
        // 자식은 남는다. 빈 블록만 사라지므로 자식은 그 자리에서 한 단 올라간다.
        movesChildren: false,
        expandTarget: false,
      }
    }
    return {
      kind: 'blocked',
      reason: 'target_cannot_have_children',
      detail: `${target.type} 은 자식 블록을 가질 수 없어 자식이 있는 블록을 병합할 수 없습니다.`,
    }
  }

  const joined = concatRuns(target.title, source.title)
  if (!joined.ok) {
    return {
      kind: 'blocked',
      reason: 'too_many_runs',
      detail:
        `병합하면 서식 조각이 ${joined.count}개가 되어 상한 ${joined.limit}개를 넘습니다. ` +
        `텍스트를 잘라내지 않기 위해 병합하지 않았습니다.`,
    }
  }

  return {
    kind: 'merge',
    resultType: target.type,
    resultTitle: joined.runs,
    caretOffset: unitLength(target.title),
    movesChildren,
    // 접힌 앞 블록으로 자식이 들어가면 화면에서 사라진다. 펼쳐서 손실을 막는다.
    expandTarget: movesChildren && target.collapsed,
  }
}
