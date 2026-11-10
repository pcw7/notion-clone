/**
 * 공개 표의 파일 칸 — 이름만 싣는다 (47번 트랙 PT-4 · 정본 §3.5 [보강 PT-1] ⑧)
 *
 * 공개 파일 길은 블록 단위라 칸의 파일은 방문자가 열 수 없다 — 그래서 링크도 파일 id 도 싣지 않는다(id 가 공개 재료에 남으면 앱 경로를
 * 짐작하는 실마리가 된다). 화면이 이름만 그려도 재료에 id 가 있으면 새는 것이므로 여기서 고른다(`public-files.test.ts`).
 */

export type PublicFilesValue = { readonly type: 'files'; readonly files: readonly { readonly name: string }[] }

export function publicFilesValue(value: unknown): PublicFilesValue {
  const files = (value as { files?: unknown } | null)?.files
  return {
    type: 'files',
    files: (Array.isArray(files) ? files : []).flatMap((f) => {
      const name = (f as { name?: unknown } | null)?.name
      return typeof name === 'string' ? [{ name }] : []
    }),
  }
}
