/**
 * 가져오기의 문구 — 잔여 묶음 8m-1 (F-09-12 · DOM · DB 없음)
 *
 * 거부 코드(`import/import.ts` `ImportFailure`)의 말 · 가져온 뒤의 말 · 옮기지 못한 것의 요약.
 */

/** 받는 확장자 — 파일 고르개의 `accept`. 서버가 다시 거른다(`importKindOf`). ZIP 은 홀로(8m-2a). */
export const IMPORT_ACCEPT = '.md,.markdown,.txt,.zip'

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`

export function importFailureMessage(reason: unknown, file?: unknown, limit?: unknown): string {
  const name = typeof file === 'string' && file !== '' ? `${file} — ` : ''
  switch (reason) {
    case 'no_files':
      return '가져올 파일을 고르세요.'
    case 'too_many_files':
      return `한 번에 ${typeof limit === 'number' ? limit : 20}개까지 가져올 수 있습니다.`
    case 'unsupported_type':
      return `${name}마크다운(.md) · 텍스트(.txt) 파일, 또는 ZIP 하나만 가져올 수 있습니다.`
    case 'invalid_zip':
      return `${name}ZIP 으로 읽을 수 없습니다.`
    case 'too_large':
      return `${name}파일이 너무 큽니다.${typeof limit === 'number' ? ` 지금 요금제에서는 ${mb(limit)}까지입니다.` : ''}`
    case 'invalid_encoding':
      return `${name}UTF-8 로 된 파일만 읽을 수 있습니다.`
    case 'not_found':
      return '가져올 곳을 찾을 수 없습니다.'
    case 'too_deep':
      return '페이지가 너무 깊어 더 아래에 만들 수 없습니다.'
    default:
      return '가져오지 못했습니다.'
  }
}

const SKIP_LABELS: Readonly<Record<string, string>> = {
  unsafe_path: '안전하지 않은 경로',
  encrypted: '암호가 걸린 파일',
  unsupported_compression: '모르는 압축',
  corrupt: '깨진 파일',
  unsupported_type: '가져올 수 없는 형식',
  duplicate: '같은 이름',
  invalid_encoding: 'UTF-8 이 아님(빈 페이지로 남김)',
  image_too_large: '이미지가 5 MB 를 넘음',
  unreferenced: '본문에서 쓰지 않은 이미지',
}

/** 건너뛴 항목의 이유(ZIP 의 부분 성공 · 8m-2a). */
export const skipReasonLabel = (reason: unknown): string => (typeof reason === 'string' && SKIP_LABELS[reason]) || '건너뜀'

/** 건너뛴 항목의 요약 — 없으면 빈 문자열. */
export const skippedNotice = (count: number): string => (count === 0 ? '' : `건너뛴 것 ${count}개`)

/** 가져온 뒤의 한 줄. */
export const importedNotice = (pages: number): string => `${pages}개 페이지를 가져왔습니다.`

const LOSS_LABELS: readonly (readonly [string, string])[] = [
  ['html', 'HTML'],
  ['images', '이미지'],
  ['links', '링크(글자만 남김)'],
  ['formatting', '꾸밈'],
]

/** 옮기지 못한 것의 요약 — 없으면 빈 문자열. */
export function lossesSummary(losses: Readonly<Record<string, number>> | null | undefined): string {
  if (!losses) return ''
  const parts = LOSS_LABELS.filter(([key]) => (losses[key] ?? 0) > 0).map(([key, label]) => `${label} ${losses[key]}개`)
  return parts.length === 0 ? '' : `옮기지 못한 것: ${parts.join(' · ')}`
}
