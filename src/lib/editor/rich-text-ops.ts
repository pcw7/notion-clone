/**
 * rich text 오프셋 · 분할 · 병합 — F-01-19 의 텍스트 계층
 *
 * 정본: 01-block-editor.md F-01-19 "서식 경계에서 분할", "멘션 객체 한가운데 캐럿",
 *       "병합 결과 rich text 배열이 100 요소 초과"
 *       마스터 문서 §7-4 (이 프로젝트에서 버그 밀도가 가장 높은 구간)
 *
 * ──────────────────────────────────────────────────────────────────────
 * ★ 오프셋의 단위를 여기서 **확정한다.**
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-01-20 이 남긴 미결 사항:
 *   "인라인 수식은 rich text 배열의 한 요소이므로 F-01-19 의 블록 분할/병합에서
 *    원자 단위로 취급된다. **오프셋 계산 시 길이 1로 셀지, `plain_text` 길이로
 *    셀지 규칙을 하나로 고정할 것.**"
 *
 * **판결: 원자는 길이 1이다.** (ProseMirror 의 inline node 크기와 같다.)
 *
 * 근거는 취향이 아니다. 이 규칙을 고르면 **"캐럿이 멘션 한가운데 있다"는 상태가
 * 구조적으로 존재할 수 없게 된다.** 원자가 [i, i+1] 구간을 차지하므로 정수
 * 오프셋은 i 이거나 i+1 이지 그 사이일 수 없다. `plain_text` 길이로 세면
 * 멘션 안쪽 오프셋이 표현 가능해지고, 그때부터 **모든 호출 지점이 스냅 처리를
 * 기억해야** 한다 — 한 곳만 빠뜨리면 멘션이 반으로 쪼개진다.
 *
 * 게다가 오프셋의 유일한 출처는 ProseMirror selection 이고 유일한 소비처는
 * 이 파일이다. 두 쪽의 단위를 같게 두면 변환이 아예 없어진다. 변환이 없으면
 * 변환 버그도 없다.
 *
 * 그래서 이 파일의 오프셋은 **문자 인덱스가 아니다.** `toPlainText().length` 와
 * 다를 수 있다(멘션·수식이 있을 때). 헷갈리지 않도록 이름을 `unit` 으로 쓴다.
 */

import {
  MAX_RICH_TEXT_RUNS,
  MAX_RUN_CONTENT,
  normalizeRichText,
  type RichTextRun,
} from '../contracts/rich-text.ts'

/** 런 하나가 차지하는 오프셋 단위 수. 원자(mention·equation)는 1이다. */
export function runUnitLength(run: RichTextRun): number {
  if (run.type === 'text') return run.text?.content.length ?? 0
  return 1
}

/** RichText[] 전체의 오프셋 단위 수. 캐럿이 가질 수 있는 최대 오프셋과 같다. */
export function unitLength(runs: readonly RichTextRun[]): number {
  let total = 0
  for (const run of runs) total += runUnitLength(run)
  return total
}

/** 텍스트 런의 내용만 바꾼 새 런. `plain_text` 파생값도 함께 맞춘다. */
function withContent(run: RichTextRun, content: string): RichTextRun {
  return {
    ...run,
    text: { ...(run.text ?? { link: null }), content },
    plain_text: content,
  }
}

export type SplitResult = {
  readonly head: RichTextRun[]
  readonly tail: RichTextRun[]
}

/**
 * 오프셋에서 런 배열을 둘로 자른다.
 *
 * F-01-19: "rich text 배열을 캐럿 오프셋 기준으로 **span 단위 분할**.
 * 경계에 걸친 span 은 둘로 쪼갬 → 양쪽 모두 정규화(빈 span 제거, 인접 동일
 * annotation 병합)."
 *
 * 링크는 양쪽 모두 유지한다 — 링크가 걸린 문장을 반으로 자르면 두 조각 다
 * 그 링크를 가리키는 것이 맞다.
 *
 * @param offset 0 이상 `unitLength(runs)` 이하. 범위를 벗어나면 던진다 —
 *   조용히 clamp 하면 "글자가 사라졌다"가 아니라 "커서가 이상한 데로 갔다"는
 *   더 찾기 어려운 증상이 된다.
 */
export function splitRunsAt(runs: readonly RichTextRun[], offset: number): SplitResult {
  const total = unitLength(runs)
  if (!Number.isInteger(offset) || offset < 0 || offset > total) {
    throw new RangeError(`오프셋이 범위를 벗어났습니다: ${offset} (0..${total})`)
  }

  const head: RichTextRun[] = []
  const tail: RichTextRun[] = []
  let cursor = 0

  for (const run of runs) {
    const len = runUnitLength(run)
    const start = cursor
    const end = cursor + len
    cursor = end

    if (end <= offset) {
      head.push(run)
      continue
    }
    if (start >= offset) {
      tail.push(run)
      continue
    }

    // 경계가 이 런을 관통한다. 원자는 길이 1이라 여기 올 수 없다 —
    // 위 판결이 성립하는지 확인하는 자리이므로 assert 로 남긴다.
    if (run.type !== 'text') {
      throw new Error(
        `원자 런(${run.type})의 내부로 오프셋이 계산됐습니다. ` +
          `오프셋 단위 규칙이 깨졌습니다 — 원자는 길이 1이어야 합니다.`,
      )
    }
    const at = offset - start
    const content = run.text?.content ?? ''
    head.push(withContent(run, content.slice(0, at)))
    tail.push(withContent(run, content.slice(at)))
  }

  return { head: normalizeRichText(head), tail: normalizeRichText(tail) }
}

// ── 병합 ──────────────────────────────────────────────────────────────

export type ConcatFailure = {
  readonly ok: false
  /** 정규화 후에도 상한을 넘었다. 잘라내지 않고 호출자가 병합을 거부한다. */
  readonly reason: 'too_many_runs'
  readonly count: number
  readonly limit: number
}

export type ConcatSuccess = { readonly ok: true; readonly runs: RichTextRun[] }

/**
 * 계약이 요구하는 정규형으로 만든다.
 *
 * 두 단계다. 순서가 중요하다.
 *
 *   ① `normalizeRichText` — 인접한 동일 서식 런을 **합친다**
 *   ② 길이가 `MAX_RUN_CONTENT` 를 넘는 텍스트 런을 다시 **쪼갠다**
 *
 * ②가 없으면 ①이 만든 결과가 계약을 어긴다: 1500자 런 두 개를 합치면 3000자
 * 런이 되고, 그건 `validateRichText` 가 거부하는 값이다. 쪼개는 쪽을 골랐지
 * 잘라내는 쪽을 고르지 않았다 — 2000자는 **직렬화 상한**이지 데이터 상한이
 * 아니므로 여러 런으로 나누면 손실 없이 만족한다(F-09-03 이 임포터에 시키는 것과 같다).
 */
export function canonicalizeRuns(runs: readonly RichTextRun[]): RichTextRun[] {
  const merged = normalizeRichText(runs)
  const out: RichTextRun[] = []

  for (const run of merged) {
    const content = run.type === 'text' ? (run.text?.content ?? '') : ''
    if (run.type !== 'text' || content.length <= MAX_RUN_CONTENT) {
      out.push(run)
      continue
    }
    for (let i = 0; i < content.length; i += MAX_RUN_CONTENT) {
      out.push(withContent(run, content.slice(i, i + MAX_RUN_CONTENT)))
    }
  }

  return out
}

/**
 * 두 블록의 런을 이어붙인다. 블록 병합(Backspace)의 텍스트 계층.
 *
 * F-01-19: "병합 결과 rich text 배열이 100 요소 초과 → 공개 API 상한 초과.
 * **잘라내지 말고** 정규화 후에도 초과하면 병합을 거부하고 안내."
 *
 * 그래서 이 함수는 **실패할 수 있다.** 성공/실패를 반환값으로 표현하고 예외를
 * 쓰지 않는다 — 거부는 정상적인 결과이고 사용자에게 보여줄 안내 문구가 있다.
 */
export function concatRuns(
  left: readonly RichTextRun[],
  right: readonly RichTextRun[],
): ConcatSuccess | ConcatFailure {
  const runs = canonicalizeRuns([...left, ...right])
  if (runs.length > MAX_RICH_TEXT_RUNS) {
    return { ok: false, reason: 'too_many_runs', count: runs.length, limit: MAX_RICH_TEXT_RUNS }
  }
  return { ok: true, runs }
}
