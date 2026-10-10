/**
 * 바깥 요청 — 사용자가 적은 URL 로 보내는 **단 하나의 길** (히스토리 · 활동 4e-1 · F-11-19)
 *
 * 정본: 00-canonical-data-model.md §3.8 [보강] 페이지 웹훅 ① ② · 마스터 문서 비고 20 *"SSRF 방어만 제대로 하면 된다"*
 *
 * 서버가 사용자가 적은 주소로 요청을 보내는 순간 SSRF 진입점이다(§3.3-71 — 그래서 외부 이미지도 내려받지 않았다). 웹훅은 보내는 것이
 * 일이라 피할 수 없다 — 대신 이 파일 하나로만 보낸다. 자동화의 `send_webhook`(08 F-08-13)도 이 길을 쓴다.
 *
 *   ① 모양(`checkOutboundUrl`) — https 만 · 기본 포트(443)만 · 사용자 정보(`user:pass@`) 금지 · 2,048자 이하 · 호스트가 막힌 대역의 주소
 *     글자가 아니고 `localhost` 류(`.localhost` · `.local` · `.internal` · 점 없는 한 단어)가 아니다. WHATWG URL 이 `0177.0.0.1` ·
 *     `2130706433` 같은 꼴을 `127.0.0.1` 로 바로잡은 뒤에 본다.
 *   ② 주소(`isBlockedAddress`) — 이름을 풀어 나온 주소가 **하나라도** 막힌 대역이면 보내지 않는다. IPv6 는 전역 유니캐스트(`2000::/3`)
 *     밖을 모두 막는다(루프백 · 매핑 · NAT64 · ULA · 링크 로컬 · 멀티캐스트가 다 그 밖이다).
 *   ③ 연결은 **검사한 그 주소로** — `lookup` 을 고정한다. 검사하고 나서 다시 이름을 풀면 그 사이에 답이 바뀔 수 있다(DNS rebinding).
 *   ④ 리다이렉트를 따라가지 않는다(3xx 는 실패) · 10초 · 응답 본문은 64KB 까지만 읽고 버린다 · 연결을 다시 쓰지 않는다(`agent: false`).
 *
 * 검사를 비켜 가는 호스트는 `OUTBOUND_ALLOW_HOSTS`(쉼표로 나눈 `host:port`)뿐이다 — e2e 의 받는 서버용이고 운영에는 두지 않는다. 그
 * 호스트는 http · 다른 포트도 받고 주소 대역을 보지 않지만, **이름 풀이와 주소 고정은 똑같이 거친다**(검사가 고정 경로를 지나게).
 */

import { lookup as dnsLookup } from 'node:dns'
import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'

/** URL 의 길이 상한(정본 ②). */
export const MAX_OUTBOUND_URL_LENGTH = 2048
/** 한 번 보내기의 시간 상한(정본 ①). */
export const OUTBOUND_TIMEOUT_MS = 10_000
/** 응답 본문은 이만큼만 읽는다(정본 ①). */
const MAX_RESPONSE_BYTES = 64 * 1024

// ── 막힌 대역 ─────────────────────────────────────────────────────────

// IPv4 · IPv6 를 따로 둔다 — 한 목록에 두면 IPv4 주소가 IPv6 규칙(`::/3` 안의 매핑 주소)에도 걸려 공인 주소까지 막힌다
const BLOCKED_V4 = new BlockList()
const BLOCKED_V6 = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8], // 이 네트워크
  ['10.0.0.0', 8], // 사설
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // 루프백
  ['169.254.0.0', 16], // 링크 로컬 — 클라우드 메타데이터(169.254.169.254)
  ['172.16.0.0', 12], // 사설
  ['192.0.0.0', 24], // IETF 프로토콜 할당
  ['192.0.2.0', 24], // 문서용(TEST-NET-1)
  ['192.88.99.0', 24], // 6to4 중계(폐기)
  ['192.168.0.0', 16], // 사설
  ['198.18.0.0', 15], // 벤치마크
  ['198.51.100.0', 24], // 문서용(TEST-NET-2)
  ['203.0.113.0', 24], // 문서용(TEST-NET-3)
  ['224.0.0.0', 4], // 멀티캐스트
  ['240.0.0.0', 4], // 예약 · 브로드캐스트
] as const) {
  BLOCKED_V4.addSubnet(net, prefix, 'ipv4')
}
for (const [net, prefix] of [
  // 전역 유니캐스트(2000::/3) 밖은 모두 — 루프백 · 지정 안 됨 · IPv4 매핑(::ffff:0:0/96) · NAT64(64:ff9b::/96) · 버림(100::/64) ·
  // ULA(fc00::/7) · 링크 로컬(fe80::/10) · 사이트 로컬(fec0::/10) · 멀티캐스트(ff00::/8)
  ['::', 3],
  ['4000::', 2],
  ['8000::', 1],
  // 전역 유니캐스트 안의 특수 대역
  ['2001::', 23], // IETF 프로토콜 할당 — Teredo(2001::/32) · ORCHID 포함
  ['2001:db8::', 32], // 문서용
  ['2002::', 16], // 6to4 — 안에 IPv4 를 싣는다
  ['3fff::', 20], // 문서용(RFC 9637)
] as const) {
  BLOCKED_V6.addSubnet(net, prefix, 'ipv6')
}

/** 막힌 대역의 주소인가 — 주소가 아니면 막는다(정본 ①). */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return BLOCKED_V4.check(address, 'ipv4')
  if (family === 6) return BLOCKED_V6.check(address, 'ipv6')
  return true
}

// ── 모양 ──────────────────────────────────────────────────────────────

export type OutboundUrlProblem = 'invalid' | 'too_long' | 'not_https' | 'credentials' | 'port' | 'private_host'

/** 검사를 비켜 가는 `host:port` — e2e 의 받는 서버용(머리말). 부를 때마다 읽는다(검사가 바꾼다). */
function allowedHosts(): Set<string> {
  return new Set(
    (process.env.OUTBOUND_ALLOW_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter((h) => h !== ''),
  )
}

const hostOf = (url: URL) => url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
const portOf = (url: URL) => url.port || (url.protocol === 'https:' ? '443' : url.protocol === 'http:' ? '80' : '')
const isAllowListed = (url: URL) => allowedHosts().has(`${hostOf(url)}:${portOf(url)}`)

/** 안쪽 이름 — 이름을 풀기 전에 막는다. 점 없는 한 단어는 검색 도메인을 타고 안쪽으로 풀린다. */
function isInternalName(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa') ||
    !host.includes('.')
  )
}

/** URL 의 모양만 본다(정본 ②) — 저장할 때 · 보낼 때. 이름 풀이는 하지 않는다. */
export function checkOutboundUrl(raw: string): { readonly ok: true; readonly url: URL } | { readonly ok: false; readonly problem: OutboundUrlProblem } {
  if (raw.length > MAX_OUTBOUND_URL_LENGTH) return { ok: false, problem: 'too_long' }
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { ok: false, problem: 'invalid' }
  }
  if (url.username !== '' || url.password !== '') return { ok: false, problem: 'credentials' }
  if (isAllowListed(url) && (url.protocol === 'https:' || url.protocol === 'http:')) return { ok: true, url }
  if (url.protocol !== 'https:') return { ok: false, problem: 'not_https' }
  if (url.port !== '' && url.port !== '443') return { ok: false, problem: 'port' }
  const host = hostOf(url)
  if (isIP(host) !== 0 ? isBlockedAddress(host) : isInternalName(host)) return { ok: false, problem: 'private_host' }
  return { ok: true, url }
}

// ── 보내기 ────────────────────────────────────────────────────────────

export type ResolvedAddress = { readonly address: string; readonly family: number }
/** 이름 풀이 — 검사가 바꿔 끼운다(DNS rebinding 을 흉내 낸다). */
export type Resolver = (hostname: string) => Promise<readonly ResolvedAddress[]>

const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => (error ? reject(error) : resolve(addresses)))
  })

export type OutboundFailure =
  | 'blocked_url' // 모양이 틀렸다(정본 ②)
  | 'blocked_address' // 풀린 주소가 막힌 대역이다(정본 ①)
  | 'dns' // 이름이 풀리지 않는다
  | 'timeout'
  | 'network' // 연결 · TLS 실패
  | 'redirect' // 3xx — 따라가지 않는다
  | 'http_error' // 4xx · 5xx

export type OutboundResult =
  | { readonly ok: true; readonly status: number }
  | { readonly ok: false; readonly reason: OutboundFailure; readonly status: number | null; readonly detail: string }

const failed = (reason: OutboundFailure, detail: string, status: number | null = null): OutboundResult => ({
  ok: false,
  reason,
  status,
  detail: detail.slice(0, 500),
})

/**
 * JSON 을 POST 한다 — 모양 · 이름 풀이 · 주소 검사 · 고정 연결(머리말 ① ~ ④). 던지지 않는다 — 실패는 결과로 준다.
 *
 * @param options.resolve 이름 풀이를 바꿔 끼운다(검사만)
 */
export async function postJson(
  rawUrl: string,
  body: unknown,
  options: { readonly resolve?: Resolver; readonly timeoutMs?: number; readonly headers?: Readonly<Record<string, string>> } = {},
): Promise<OutboundResult> {
  const checked = checkOutboundUrl(rawUrl)
  if (!checked.ok) return failed('blocked_url', checked.problem)
  const url = checked.url
  const host = hostOf(url)
  const allowListed = isAllowListed(url)

  let target: ResolvedAddress
  if (isIP(host) !== 0) {
    target = { address: host, family: isIP(host) }
  } else {
    let addresses: readonly ResolvedAddress[]
    try {
      addresses = await (options.resolve ?? systemResolver)(host)
    } catch (e) {
      return failed('dns', e instanceof Error ? e.message : String(e))
    }
    if (addresses.length === 0) return failed('dns', '주소가 없다')
    const first = addresses[0] as ResolvedAddress
    target = first
    if (!allowListed) {
      const blocked = addresses.find((a) => isBlockedAddress(a.address))
      if (blocked !== undefined) return failed('blocked_address', blocked.address)
    }
  }
  if (!allowListed && isBlockedAddress(target.address)) return failed('blocked_address', target.address)

  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  const timeoutMs = options.timeoutMs ?? OUTBOUND_TIMEOUT_MS
  const requestOptions: RequestOptions = {
    method: 'POST',
    hostname: host,
    port: portOf(url),
    path: `${url.pathname}${url.search}`,
    agent: false,
    headers: {
      ...options.headers,
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(payload.length),
      'user-agent': 'notion-clone-webhook/1',
    },
    // 검사한 그 주소로만 연결한다(머리말 ③) — `all` 로 묻는 쪽(autoSelectFamily)과 하나로 묻는 쪽 둘 다 받는다
    lookup: (_hostname, opts, callback) => {
      if (typeof opts === 'object' && opts !== null && 'all' in opts && opts.all) {
        ;(callback as (e: Error | null, addresses: ResolvedAddress[]) => void)(null, [target])
      } else {
        ;(callback as (e: Error | null, address: string, family: number) => void)(null, target.address, target.family)
      }
    },
  }

  return new Promise<OutboundResult>((resolve) => {
    let settled = false
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = send(requestOptions, (res: IncomingMessage) => {
      const status = res.statusCode ?? 0
      let seen = 0
      res.on('data', (chunk: Buffer) => {
        seen += chunk.length
        if (seen > MAX_RESPONSE_BYTES) res.destroy()
      })
      const finish = () => {
        if (status >= 200 && status < 300) settle({ ok: true, status })
        else if (status >= 300 && status < 400) settle(failed('redirect', res.headers.location ?? '', status))
        else settle(failed('http_error', `HTTP ${status}`, status))
      }
      res.on('end', finish)
      res.on('close', finish)
      res.on('error', finish)
    })
    const deadline = setTimeout(() => {
      req.destroy(new Error('timeout'))
      settle(failed('timeout', `${timeoutMs}ms`))
    }, timeoutMs)
    function settle(result: OutboundResult): void {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      resolve(result)
    }
    req.on('error', (e) => settle(failed('network', e.message)))
    req.end(payload)
  })
}
