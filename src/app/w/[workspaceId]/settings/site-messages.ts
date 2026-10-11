/**
 * 사이트 주소의 문구 — 설정 → 사이트 · 게시 절의 사이트 주소 (게시 · 공유 6c-2 · F-13-08 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 사이트 주소 ③④⑦
 */

const FAILURE: Readonly<Record<string, string>> = {
  forbidden: '소유자만 사이트 주소를 정할 수 있습니다.',
  invalid_name: '주소는 영문 소문자 · 숫자 · 하이픈 3~40자입니다(하이픈으로 시작하거나 끝날 수 없습니다).',
  reserved: '앱이 쓰는 이름이라 쓸 수 없습니다. 다른 주소를 고르세요.',
  taken: '다른 워크스페이스가 쓰는 주소입니다.',
}

export function siteDomainFailureMessage(reason: unknown): string {
  // 자기 칸만 — `FAILURE['constructor']` 는 객체 원형의 함수다
  return typeof reason === 'string' && Object.hasOwn(FAILURE, reason) ? FAILURE[reason]! : '바꾸지 못했습니다.'
}

/** 사이트 주소 — 이 앱의 주소 위에(`/s/{주소}/{슬러그}`). 슬러그가 없으면 그 자리를 `…` 로(설정이 모양을 보일 때). */
export function siteUrlOf(origin: string, domain: string, slug: string | null): string {
  return `${origin.replace(/\/+$/, '')}/s/${domain}/${slug ?? '…'}`
}

/** 설정 → 사이트의 설명. */
export const SITE_PANEL_NOTE =
  '웹에 게시한 페이지를 읽기 쉬운 주소로 엽니다. 페이지마다 게시 설정에서 슬러그를 정하면 이 주소 아래에 섭니다. 주소를 바꾸면 예전 주소는 곧바로 닫힙니다.'

/** 게시 절 — 워크스페이스 주소가 아직 없을 때. */
export const SITE_DOMAIN_MISSING = '사이트 주소를 쓰려면 소유자가 설정 → 사이트에서 워크스페이스 주소를 정해야 합니다.'
