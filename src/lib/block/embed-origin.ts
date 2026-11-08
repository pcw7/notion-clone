/**
 * 자기 출처 판정 — 임베드 규칙(`embed-source.ts`)과 떼어 둔 작은 순수 모듈 (44번 트랙 EM-1 · EM-3 · 정본 §3.4 [보강 EM-1] ③)
 *
 * 늘 실리는 쪽(블록 메뉴의 "임베드로 바꾸기")이 이것만 읽는다 — 서비스 규칙 전체를 첫 번들에 싣지 않는다.
 */

/** 이 앱 자신의 호스트(`host:port`)인가 — 스킴은 따지지 않는다(http · https 어느 쪽이든 자기다). */
export function isOwnHostUrl(url: string, ownHosts: readonly string[]): boolean {
  try {
    const host = new URL(url).host.toLowerCase()
    return ownHosts.some((own) => own.toLowerCase() === host)
  } catch {
    return false
  }
}

/** 출처(`https://host:port`) 또는 호스트 목록 → `host:port` 목록. 읽지 못하는 것은 버린다. */
export function ownHostsOf(origins: readonly (string | null | undefined)[]): string[] {
  const out: string[] = []
  for (const origin of origins) {
    if (!origin) continue
    try {
      const host = new URL(origin.includes('://') ? origin : `https://${origin}`).host
      if (host !== '' && !out.includes(host)) out.push(host)
    } catch {
      // 버린다
    }
  }
  return out
}
