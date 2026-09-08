/**
 * 요청에서 클라이언트 IP · User-Agent 를 뽑는다.
 *
 * Next.js 15.0.0 에서 `NextRequest.ip` 와 `.geo` 가 **제거**되었다
 * (node_modules/next/dist/docs/.../next-request.md 버전 이력 확인).
 * 헤더에서 직접 읽어야 한다.
 *
 * ⚠ **`x-forwarded-for` 는 클라이언트가 위조할 수 있다.**
 *
 * 신뢰할 수 있는 프록시(로드밸런서·CDN) 뒤에 있고, 그 프록시가 헤더를
 * 덮어쓸 때만 이 값이 의미 있다. 그렇지 않으면 공격자가 매 요청마다 다른
 * IP 를 넣어 **IP 레이트리밋을 우회**한다.
 *
 * 그래서 이 프로젝트의 레이트리밋은 **이메일당 상한을 1차 방어**로 둔다
 * (F-14-16). 이메일은 위조해도 그 주소로 코드가 갈 뿐이라 공격자에게 이득이 없다.
 * IP 상한은 보조 수단이다 — 우회 가능하다는 전제로 설계되어 있다.
 *
 * 배포 시 `TRUSTED_PROXY_HOP_COUNT` 를 실제 프록시 단수로 설정한다.
 * 0(기본값)이면 x-forwarded-for 를 신뢰하지 않고 소켓 주소만 쓴다.
 */

export type RequestMeta = {
  readonly ip: string | null
  readonly userAgent: string | null
}

/**
 * 프록시가 붙인 IP 를 신뢰할 만큼의 hop 수.
 * 예: Cloudflare 뒤 앱 1대 = 1. 직접 노출 = 0.
 */
function trustedHops(): number {
  const n = Number(process.env.TRUSTED_PROXY_HOP_COUNT ?? 0)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

/** IPv4/IPv6 형태인지 간단히 확인한다. 위조 헤더가 DB inet 컬럼을 깨뜨리지 않게. */
function looksLikeIp(value: string): boolean {
  const v = value.trim()
  if (v.length === 0 || v.length > 45) return false
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) {
    return v.split('.').every((o) => Number(o) <= 255)
  }
  // IPv6 (느슨하게 — 16진수와 콜론만)
  return /^[0-9a-fA-F:]+$/.test(v) && v.includes(':')
}

export function requestMeta(request: Request): RequestMeta {
  const userAgent = request.headers.get('user-agent')?.slice(0, 512) ?? null

  const hops = trustedHops()
  if (hops === 0) {
    // 프록시를 신뢰하지 않는다. 소켓 주소는 Route Handler 에서 접근할 수 없으므로
    // IP 없이 간다 — 이메일당 레이트리밋은 여전히 동작한다.
    return { ip: null, userAgent }
  }

  const forwarded = request.headers.get('x-forwarded-for')
  if (!forwarded) return { ip: null, userAgent }

  // "client, proxy1, proxy2" 순. 신뢰하는 hop 수만큼 오른쪽에서 세어
  // 그 앞의 값을 클라이언트로 본다. 왼쪽 끝을 그냥 쓰면 위조에 그대로 당한다.
  const chain = forwarded.split(',').map((s) => s.trim()).filter(Boolean)
  const index = chain.length - hops
  const candidate = index >= 0 && index < chain.length ? chain[index] : undefined

  if (!candidate || !looksLikeIp(candidate)) return { ip: null, userAgent }
  return { ip: candidate, userAgent }
}
