/**
 * 옮기기의 문구 — F-02-08 · 7c-3 · 7c-13조각 (F-06-20 · DOM · DB 없음)
 *
 * 서버의 거부 코드(`MoveError`)를 사람의 말로 바꾼다. `needs_full_access` 는 **왜** 막혔는지 말한다 — 다른 teamspace 나
 * 워크스페이스 최상위로 옮기면 그 페이지를 볼 수 있는 사람이 통째로 바뀌므로 공유를 바꾸는 것과 같다(`move-page.ts` 머리말).
 *
 * 7c-13: 옮기기 전의 **영향 미리보기**(`previewMove`)를 어떻게 말하고, 언제 한 번 더 묻는지도 여기서 정한다.
 */

/** 미리보기의 한쪽 — 서버의 `MovePreviewSide` 와 같은 모양(클라이언트가 서버 모듈을 import 하지 않게 따로 적는다). */
export type MovePreviewSideView = { readonly count: number; readonly names: readonly string[] | null }

export type MovePreviewView = {
  readonly noop: boolean
  readonly lose: MovePreviewSideView
  readonly gain: MovePreviewSideView
  readonly keep: number
  readonly keptBelow: { readonly pages: number; readonly people: number }
  /** 웹 공개의 앞뒤(6a-4) — 옮기기 전 · 뒤에 웹에서 열리는가 · 자기 게시인가. */
  readonly web: { readonly own: boolean; readonly before: boolean; readonly after: boolean }
}

/**
 * 한 번 더 물을까 — **볼 수 있는 사람이 바뀔 때만**(워크스페이스 안의 사람이든 웹이든). 같은 사람들이 그대로 보면 곧바로 옮긴다(그때 묻는
 * 것은 소음이다). 하위의 공유(`keptBelow`)만 있고 바뀌는 사람이 없으면 묻지 않는다 — 이동 전에도 그랬던 것이다. 웹 공개가 바뀌면(위
 * 페이지의 게시 안으로 · 밖으로) 묻는다 — 6a-4.
 */
export function moveNeedsConfirm(preview: MovePreviewView): boolean {
  return !preview.noop && (preview.lose.count > 0 || preview.gain.count > 0 || preview.web.before !== preview.web.after)
}

/** 사람들을 한 줄로 — 이름을 받았으면 이름(넘치면 "외 N명"), 못 받았으면 수만. */
export function previewPeople(side: MovePreviewSideView): string {
  if (side.names === null || side.names.length === 0) return `${side.count}명`
  const rest = side.count - side.names.length
  return rest > 0 ? `${side.names.join(' · ')} 외 ${rest}명` : side.names.join(' · ')
}

/** 미리보기를 줄로 — 잃는 사람 · 새로 보는 사람 · 그대로 · 하위의 공유. 없는 것은 말하지 않는다. */
export function movePreviewLines(preview: MovePreviewView): { readonly key: string; readonly text: string }[] {
  const lines: { key: string; text: string }[] = []
  if (preview.lose.count > 0) lines.push({ key: 'lose', text: `못 보게 되는 사람 — ${previewPeople(preview.lose)}` })
  if (preview.gain.count > 0) lines.push({ key: 'gain', text: `새로 보는 사람 — ${previewPeople(preview.gain)}` })
  if (preview.keep > 0) lines.push({ key: 'keep', text: `그대로 보는 사람 ${preview.keep}명` })
  if (preview.keptBelow.pages > 0) {
    lines.push({
      key: 'below',
      text: `하위 페이지 ${preview.keptBelow.pages}개는 이 페이지를 못 보는 ${preview.keptBelow.people}명이 여전히 봅니다 — 따로 준 공유는 옮겨도 남습니다`,
    })
  }
  // 웹 공개(6a-4) — 06 엣지 *"이동 시 공개 상태 경고 필수"*
  if (preview.web.own && preview.web.after) {
    lines.push({ key: 'web', text: '이 페이지는 웹에 게시되어 있어 옮겨도 주소를 아는 누구나 봅니다 — 게시는 공유 메뉴에서 취소합니다' })
  } else if (!preview.web.before && preview.web.after) {
    lines.push({ key: 'web', text: '옮기면 위 페이지의 웹 게시로 이 페이지와 하위 페이지가 웹에 공개됩니다' })
  } else if (preview.web.before && !preview.web.after) {
    lines.push({ key: 'web', text: '옮기면 웹 게시 밖으로 나가 웹에서 더는 열리지 않습니다' })
  }
  return lines
}

export function moveFailureMessage(error: unknown): string {
  switch (error) {
    case 'too_deep':
      return '그 위치로 옮기면 깊이 제한을 넘습니다.'
    case 'cycle':
      return '자기 하위 페이지 안으로는 옮길 수 없습니다.'
    case 'forbidden':
      return '이 페이지를 옮길 권한이 없습니다.'
    case 'needs_full_access':
      return '다른 teamspace · 개인 페이지 · 워크스페이스 최상위로 옮기려면 이 페이지의 전체 권한이 필요합니다 — 볼 수 있는 사람이 바뀝니다.'
    case 'target_not_found':
      return '그 위치로 옮길 수 없습니다.'
    default:
      return '옮기지 못했습니다.'
  }
}
