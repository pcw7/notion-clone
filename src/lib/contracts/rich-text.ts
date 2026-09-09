/**
 * RichText[] 직렬화 계약 — F-09-03 / F-01-03
 *
 * 정본: docs/research/09-api-integrations.md F-09-03
 *       docs/research/01-block-editor.md "rich text 값 모델"
 *
 * 로드맵 W2: **"이 주에 고친 계약은 이후 못 고친다."**
 * 마스터 문서 §5.1: "색 enum을 나중에 넣으면 전 블록 마이그레이션."
 *
 * 그래서 MVP 가 bold/italic/strike/code/link 만 쓰더라도 **색 19값과
 * mention/equation 타입 자리는 지금 확정**한다. 값을 안 쓰는 것과
 * 표현할 수 없는 것은 다르다.
 */

// ── 색 ────────────────────────────────────────────────────────────────
//
// **정확히 19개다.** `default` + 텍스트 9종 + 배경 9종.
// `default_background` 는 **없다** — 공개 API 열거에도, 헬프센터 목록에도 없다
// (01 문서에서 GAP 1회차 정정 후 2회차에 1차 출처로 재검증됨).
// UI 의 "기본 배경"은 배경이 없는 상태라서 값이 불필요할 뿐이다.
//
// 텍스트색과 배경색을 **동시에 지정할 수 없다**는 제약이 이 표현에서 따라 나온다.
// 필드가 하나이기 때문이다. 두 필드로 쪼개면 노션 API 호환이 깨진다.

export const TEXT_COLORS = [
  'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red',
] as const
export type TextColor = (typeof TEXT_COLORS)[number]

export const COLORS = [
  'default',
  ...TEXT_COLORS,
  ...TEXT_COLORS.map((c) => `${c}_background` as const),
] as const
export type Color = (typeof COLORS)[number]

const COLOR_SET: ReadonlySet<string> = new Set(COLORS)

export function isColor(v: unknown): v is Color {
  return typeof v === 'string' && COLOR_SET.has(v)
}

// ── 한계값 (F-09-03) ──────────────────────────────────────────────────
//
// 순진한 마크다운 임포터가 여기서 400 을 맞는다. 2000자를 넘는 문단은
// 여러 런으로 쪼개 보내야 한다.

export const MAX_RUN_CONTENT = 2000
export const MAX_LINK_URL = 2000
export const MAX_EQUATION = 1000

/**
 * rich text **배열**의 요소 수 상한 (01-block-editor.md "rich text 값 모델").
 *
 * 이 값이 쓰이는 곳은 블록 병합이다(F-01-19): 두 블록의 런을 이어붙였을 때
 * 정규화 후에도 100을 넘으면 **잘라내지 말고 병합을 거부**한다.
 * 잘라내면 사용자가 Backspace 한 번으로 텍스트를 잃는다.
 */
export const MAX_RICH_TEXT_RUNS = 100

// ── 타입 ──────────────────────────────────────────────────────────────

export type Annotations = {
  bold: boolean
  italic: boolean
  strikethrough: boolean
  underline: boolean
  code: boolean
  color: Color
}

export type MentionType =
  | 'user'
  | 'page'
  | 'database'
  | 'date'
  | 'link_preview'
  | 'template_mention'
  | 'custom_emoji'

export type RichTextRun = {
  type: 'text' | 'mention' | 'equation'
  annotations: Annotations
  /** 서식 제거 텍스트. **응답 전용 파생값**이며 요청 시 보내도 무시된다. */
  plain_text: string
  /** 응답 전용 파생값. */
  href: string | null
  text?: { content: string; link: { url: string } | null }
  equation?: { expression: string }
  mention?: { type: MentionType; [k: string]: unknown }
}

export const DEFAULT_ANNOTATIONS: Annotations = Object.freeze({
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  color: 'default',
})

/** 평문에서 런 하나를 만든다. */
export function textRun(content: string, annotations: Partial<Annotations> = {}): RichTextRun {
  const ann = { ...DEFAULT_ANNOTATIONS, ...annotations }
  return {
    type: 'text',
    annotations: ann,
    plain_text: content,
    href: null,
    text: { content, link: null },
  }
}

/** RichText[] 에서 검색·인덱싱용 평문을 뽑는다. */
export function toPlainText(runs: readonly RichTextRun[]): string {
  return runs.map((r) => r.plain_text ?? '').join('')
}

// ── 검증 ──────────────────────────────────────────────────────────────

export type ValidationIssue = { path: string; message: string }

function validateAnnotations(a: unknown, path: string, out: ValidationIssue[]): void {
  if (typeof a !== 'object' || a === null) {
    out.push({ path, message: 'annotations 가 객체가 아닙니다' })
    return
  }
  const ann = a as Record<string, unknown>
  for (const flag of ['bold', 'italic', 'strikethrough', 'underline', 'code']) {
    if (typeof ann[flag] !== 'boolean') {
      out.push({ path: `${path}.${flag}`, message: 'boolean 이어야 합니다' })
    }
  }
  if (!isColor(ann.color)) {
    out.push({
      path: `${path}.color`,
      message: `19개 색 값 중 하나여야 합니다 (default_background 는 존재하지 않습니다): ${JSON.stringify(ann.color)}`,
    })
  }
}

/**
 * 요청으로 들어온 RichText[] 를 검증한다.
 *
 * 응답 전용 파생값(`plain_text`, `href`)은 **검증하지 않는다** — 보내도 무시하는
 * 것이 계약이므로, 있다고 거부하면 노션 클라이언트가 그대로 돌려보낸 값에
 * 400 을 맞는다.
 */
export function validateRichText(value: unknown, path = 'rich_text'): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (!Array.isArray(value)) {
    return [{ path, message: '배열이어야 합니다' }]
  }

  value.forEach((raw, i) => {
    const p = `${path}[${i}]`
    if (typeof raw !== 'object' || raw === null) {
      issues.push({ path: p, message: '객체가 아닙니다' })
      return
    }
    const run = raw as Record<string, unknown>

    if (run.type !== 'text' && run.type !== 'mention' && run.type !== 'equation') {
      issues.push({ path: `${p}.type`, message: "'text' | 'mention' | 'equation' 이어야 합니다" })
    }

    validateAnnotations(run.annotations, `${p}.annotations`, issues)

    if (run.type === 'text') {
      const t = run.text as Record<string, unknown> | undefined
      if (typeof t?.content !== 'string') {
        issues.push({ path: `${p}.text.content`, message: '문자열이어야 합니다' })
      } else if (t.content.length > MAX_RUN_CONTENT) {
        issues.push({
          path: `${p}.text.content`,
          message: `${MAX_RUN_CONTENT}자를 넘습니다 (${t.content.length}). 여러 런으로 쪼개 보내세요.`,
        })
      }
      const link = t?.link as Record<string, unknown> | null | undefined
      if (link != null) {
        if (typeof link.url !== 'string') {
          issues.push({ path: `${p}.text.link.url`, message: '문자열이어야 합니다' })
        } else if (link.url.length > MAX_LINK_URL) {
          issues.push({ path: `${p}.text.link.url`, message: `${MAX_LINK_URL}자를 넘습니다` })
        }
      }
    }

    if (run.type === 'equation') {
      const e = run.equation as Record<string, unknown> | undefined
      if (typeof e?.expression !== 'string') {
        issues.push({ path: `${p}.equation.expression`, message: '문자열이어야 합니다' })
      } else if (e.expression.length > MAX_EQUATION) {
        issues.push({ path: `${p}.equation.expression`, message: `${MAX_EQUATION}자를 넘습니다` })
      }
    }

    if (run.type === 'mention') {
      const m = run.mention as Record<string, unknown> | undefined
      if (typeof m?.type !== 'string') {
        issues.push({ path: `${p}.mention.type`, message: 'mention 타입이 필요합니다' })
      }
    }
  })

  return issues
}

// ── ProseMirror 어댑터 ────────────────────────────────────────────────
//
// F-09-03 이 명시한 요구사항:
//   "rich text 는 중첩되지 않는 **플랫 런 배열**이다. 클론이 ProseMirror/Slate
//    같은 중첩 mark 모델을 쓰면 **직렬화 시 플래튼, 역직렬화 시 병합**
//    어댑터가 반드시 필요하다."
//
// 우리는 ProseMirror(Tiptap)를 쓰기로 했으므로 이 어댑터가 필수다.

/** 두 annotation 이 같은가. 인접 런 병합 판정에 쓴다. */
export function sameAnnotations(a: Annotations, b: Annotations): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.strikethrough === b.strikethrough &&
    a.underline === b.underline &&
    a.code === b.code &&
    a.color === b.color
  )
}

/**
 * 인접한 동일 서식 런을 합친다.
 *
 * 서버가 병합해 돌려줄 수 있으므로(F-09-03 `[추정]`) **클라이언트는 런 경계
 * 보존을 가정하면 안 된다.** 우리가 저장할 때도 미리 합쳐두면 저장 크기가 줄고
 * 비교가 안정적이 된다.
 *
 * `text` 런만 합친다 — mention/equation 은 각각이 하나의 원자다.
 * 빈 content 런은 제거한다(응답에서 사라질 수 있는 값이다).
 */
export function normalizeRichText(runs: readonly RichTextRun[]): RichTextRun[] {
  const out: RichTextRun[] = []

  for (const run of runs) {
    if (run.type === 'text' && (run.text?.content ?? '') === '') continue

    const prev = out[out.length - 1]
    const mergeable =
      prev !== undefined &&
      prev.type === 'text' &&
      run.type === 'text' &&
      sameAnnotations(prev.annotations, run.annotations) &&
      (prev.text?.link?.url ?? null) === (run.text?.link?.url ?? null)

    if (mergeable && prev.text && run.text) {
      const content = prev.text.content + run.text.content
      out[out.length - 1] = {
        ...prev,
        text: { ...prev.text, content },
        plain_text: content,
      }
    } else {
      out.push({ ...run, plain_text: run.plain_text ?? run.text?.content ?? '' })
    }
  }

  return out
}
