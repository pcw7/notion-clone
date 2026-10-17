/**
 * 번들 예산 — 플랫폼 잔여 10g-1 (F-12-07 · 정본 §3.10 끝 [보강] 성능 계측 ⑥)
 *
 * 경로마다 **처음 받는 JS**(gzip)의 상한. 빌드 산출물을 재는 것은 `scripts/check-bundle.mjs` — 여기는 무엇을 세고 무엇과 견주는가만.
 * 12 F-12-07 *"로케일 데이터 같은 '전부 번들되는 데이터'가 조용히 번들을 키운다"* — 무거운 것(수식 · 코드 문법 · 이모지 자료)을 정적으로
 * import 하는 순간 CI 가 막는다. 그래서 여유는 **가장 작은 무거운 덩어리보다 작게** 둔다(`HEAVY_CHUNK_KB`).
 *
 * 예산을 올리는 것은 커밋으로 보이는 결정이다 — 왜 커졌는지 적고, `baselineKB` 도 그때의 크기로 함께 고친다.
 */

export type MeasuredRoute = {
  /** 매니페스트의 경로 이름(`/w/[workspaceId]/[pageId]/page`). */
  readonly route: string
  readonly files: number
  readonly gzipBytes: number
  readonly rawBytes: number
}

export type BudgetRule = {
  readonly pattern: RegExp
  /** 상한(KB · gzip). */
  readonly maxKB: number
  /** 예산을 정할 때 이 규칙에 든 가장 큰 경로의 크기(KB · gzip) — 여유를 재는 기준. */
  readonly baselineKB: number
  readonly why: string
}

/**
 * 가장 작은 무거운 덩어리(KB · gzip) — KaTeX. 지연 로드하는 것(KaTeX · 코드 문법 · 이모지 자료) 중 가장 작다. 이 검사의 잣대(파일마다
 * gzip)로 잰 값이다 — 편집기에 정적으로 넣었더니 페이지가 398.3KB → 473.9KB(+75.6).
 */
export const HEAVY_CHUNK_KB = 75

/**
 * 앞에서부터 처음 맞는 규칙. 마지막은 모든 경로에 맞는다. 여유는 규칙에서 가장 큰 경로를 기준으로 재므로, 크기가 크게 다른 경로는 규칙을
 * 나눈다(템플릿 편집 412KB 가 데이터베이스 규칙에 있으면 여유가 108KB 라 KaTeX 가 들어와도 넘지 않는다).
 */
export const BUNDLE_BUDGETS: readonly BudgetRule[] = [
  { pattern: /^\/w\/\[workspaceId\]\/db\/\[databaseId\]\/templates\//, maxKB: 470, baselineKB: 412, why: '데이터베이스 템플릿 편집 — 편집기' },
  { pattern: /^\/w\/\[workspaceId\]\/db\//, maxKB: 520, baselineKB: 462, why: '데이터베이스 화면 — 표 · 보드 · 행 열기(편집기 포함)' },
  { pattern: /^\/w\/\[workspaceId\]\/\[pageId\]\/page$/, maxKB: 450, baselineKB: 399, why: '페이지 — 편집기(ProseMirror · Yjs · 협업)' },
  { pattern: /^\/w\//, maxKB: 230, baselineKB: 199, why: '워크스페이스의 다른 화면 — 사이드바 · 설정' },
  { pattern: /^/, maxKB: 160, baselineKB: 136, why: '편집기가 없는 화면 — 로그인 · 공개 · 초대' },
]

export function budgetFor(route: string): BudgetRule {
  return BUNDLE_BUDGETS.find((rule) => rule.pattern.test(route)) ?? BUNDLE_BUDGETS[BUNDLE_BUDGETS.length - 1]
}

/** 처음 받는 파일 — 모든 경로가 받는 것 ∪ 그 경로의 레이아웃 · 페이지의 진입 청크. 겹치는 것은 한 번(처음 나온 차례). */
export function initialFiles(rootMain: readonly string[], entryJSFiles: Readonly<Record<string, readonly string[]>>): string[] {
  return [...new Set([...rootMain, ...Object.values(entryJSFiles).flat()])]
}

export type BudgetVerdict = MeasuredRoute & { readonly maxKB: number; readonly over: boolean }

/** 예산과 견준다 — 상한과 같으면 넘지 않았다. */
export function judge(measured: readonly MeasuredRoute[]): BudgetVerdict[] {
  return measured.map((m) => {
    const { maxKB } = budgetFor(m.route)
    return { ...m, maxKB, over: m.gzipBytes > maxKB * 1024 }
  })
}
