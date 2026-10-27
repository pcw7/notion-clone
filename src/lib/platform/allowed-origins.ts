/**
 * 익명 쓰기 경로의 출처 검사가 받는 출처들 (10n-78 · F-17-10 · 정본 §3.3 끝 [보강] 공개 페이지 신고 · [보강] 폼 ⓐ)
 *
 * 공개 신고 폼 · 공개 폼 제출은 `Origin` 이 있으면 "이 서버의 것"이어야 한다(다른 사이트의 방문자를 시켜 퍼붓지 못하게). 전에는 그 "이 서버"를
 * **요청이 닿은 주소의 출처**(`request.url`)로만 봤다 — 프록시가 호스트 · 스킴을 바꾸는 배포(TLS 종단 · 내부 포트)에서는 브라우저가 보낸
 * 공개 주소의 출처와 달라 정상 제출이 막혔다. 그래서 셋을 합친다:
 *
 *   · 요청이 닿은 주소의 출처 — 프록시 없이 띄운 서버(개발 · e2e)
 *   · 설정한 공개 주소(`NEXT_PUBLIC_APP_URL`) — 초대 링크 · 협업 서버가 이미 이 값을 앱의 주소로 쓴다
 *   · 더 받을 출처(`APP_ALLOWED_ORIGINS` — 쉼표로) — 주소가 둘 이상인 배포
 *
 * 출처로 읽히지 않는 값은 버린다(오타가 모든 출처를 받게 하지 않는다). `Origin` 이 없으면 브라우저가 아니다 — 받는다(레이트리밋이 지킨다).
 */

/** 출처(`scheme://host[:port]`)로 읽히면 그 출처, 아니면 null. */
function originOf(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

export function allowedOrigins(
  requestUrl: string,
  /** 환경 변수 — `NEXT_PUBLIC_APP_URL` · `APP_ALLOWED_ORIGINS` 만 읽는다. */
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly string[] {
  const listed = [requestUrl, env.NEXT_PUBLIC_APP_URL ?? '', ...(env.APP_ALLOWED_ORIGINS ?? '').split(',')]
  const origins: string[] = []
  for (const value of listed) {
    if (value.trim() === '') continue
    const origin = originOf(value)
    if (origin !== null && !origins.includes(origin)) origins.push(origin)
  }
  return origins
}

/** 이 `Origin` 을 받는가 — 없으면(브라우저가 아니다) 받는다. */
export function isAllowedOrigin(origin: string | null, allowed: readonly string[]): boolean {
  return origin === null || allowed.includes(origin)
}
