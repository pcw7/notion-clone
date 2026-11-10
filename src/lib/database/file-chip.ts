/**
 * 파일 칸(PT-4)의 칩 — 순수 도우미
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 PT-1] ⑧
 *
 * 칸은 `{id, name}` 만 들고 있다(MIME 은 `file` 행의 것이다). 작은 미리보기를 그릴지는 이름의 확장자로 정한다 — 받는 그림 4종과 같은 목록이고,
 * 확장자만 그림인 다른 파일은 칩의 `<img>` 가 불러오지 못해(서버는 그림이 아니면 내려받기로 준다) 글만 남는다.
 */

/** 미리보기를 시도할 확장자(받는 그림 4종 — `limits.ts` `ALLOWED_IMAGE_MIME`). */
const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp)$/i

export function isImageName(name: string): boolean {
  return IMAGE_EXTENSION.test(name)
}

/** 파일 내용의 주소 — 파일 블록과 같은 길(`/content` · 세션이 판정한다 · 서명 URL 을 저장하지 않는다). */
export function fileContentHref(workspaceId: string, fileId: string): string {
  return `/api/workspaces/${workspaceId}/files/${fileId}/content`
}

/** 올린 파일의 보일 이름 — 비었으면 "파일", 255자를 넘으면 자른다(칸 가드 0139 의 상한). */
export function fileDisplayName(originalName: string | null | undefined, max = 255): string {
  const name = (originalName ?? '').trim()
  return name === '' ? '파일' : name.slice(0, max)
}
