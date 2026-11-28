/**
 * User-Agent → 브라우저 · OS · 기기 꼴 (AC-3 · F-14-08 의 기기 목록 · 새 기기 알림)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강 AC-0] ⑭ [AC-3] — `device_label` 에는 User-Agent 원문(256자)이 있고 읽을 때 여기서 가른다.
 *       14-auth-accounts.md F-14-08 *"표(기기 아이콘 / 브라우저·OS / 대략 위치 / 마지막 활동 상대시간 / Log out)"*
 *
 * 새 의존성을 들이지 않는다 — 목록에 "Chrome · Windows" 를 보일 만큼만 가른다. 틀려도 보안 판정에 쓰지 않는다(기기 표시는 쿠키의
 * 해시다 — `device.ts`). 차례가 뜻이다: Edge · Opera · 삼성 인터넷 · 웨일은 User-Agent 에 `Chrome/` 도 싣고, Chrome 은 `Safari/` 도 싣는다.
 */

export type DeviceForm = 'phone' | 'tablet' | 'computer' | 'unknown'

export type ParsedAgent = {
  readonly browser: string | null
  readonly os: string | null
  readonly form: DeviceForm
}

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bWhale\//, '웨일'],
  [/\bSamsungBrowser\//, '삼성 인터넷'],
  [/\bKAKAOTALK\b/i, '카카오톡'],
  [/\b(?:OPR|OPiOS)\/|\bOpera\b/, 'Opera'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:HeadlessChrome|Chrome|CriOS)\//, 'Chrome'],
  [/\bChromium\//, 'Chromium'],
  [/\bVersion\/[\d.]+.*\bSafari\/|\bAppleWebKit\/.*\bMobile\/\w+$/, 'Safari'],
]

function osAndForm(ua: string): { os: string | null; form: DeviceForm } {
  if (/\biPad\b/.test(ua)) return { os: 'iPadOS', form: 'tablet' }
  if (/\b(?:iPhone|iPod)\b/.test(ua)) return { os: 'iOS', form: 'phone' }
  // 안드로이드 폰은 `Mobile` 을 싣고 태블릿은 싣지 않는다(크롬 · 삼성 인터넷의 관례)
  if (/\bAndroid\b/.test(ua)) return { os: 'Android', form: /\bMobile\b/.test(ua) ? 'phone' : 'tablet' }
  if (/\bWindows NT\b/.test(ua)) return { os: 'Windows', form: 'computer' }
  if (/\bCrOS\b/.test(ua)) return { os: 'ChromeOS', form: 'computer' }
  // 아이패드의 데스크톱 모드도 Macintosh 라고 말한다 — 가를 길이 없어 컴퓨터로 둔다
  if (/\bMacintosh\b|\bMac OS X\b/.test(ua)) return { os: 'macOS', form: 'computer' }
  if (/\bLinux\b|\bX11\b/.test(ua)) return { os: 'Linux', form: 'computer' }
  return { os: null, form: 'unknown' }
}

export function parseUserAgent(ua: string | null | undefined): ParsedAgent {
  if (typeof ua !== 'string' || ua.trim() === '') return { browser: null, os: null, form: 'unknown' }
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1] ?? null
  return { browser, ...osAndForm(ua) }
}

/** 목록 · 알림에 쓰는 이름 — "Chrome · Windows". 하나만 알면 그 하나 · 둘 다 모르면 "알 수 없는 기기". */
export function deviceLabel(agent: ParsedAgent): string {
  if (agent.browser !== null && agent.os !== null) return `${agent.browser} · ${agent.os}`
  return agent.browser ?? agent.os ?? '알 수 없는 기기'
}

/**
 * 가린 IP — 대략 위치의 자리(유료 geo-IP 를 쓰지 않는다 · 정본 [AC-3]). IPv4 는 앞 셋(`203.0.113.*`), IPv6 는 앞 세 묶음(`2001:db8:85a3:…`).
 * IPv4 를 품은 IPv6(`::ffff:1.2.3.4`)는 IPv4 로 본다. 모양이 아니면 null — 화면에 온전한 IP 를 주지 않는다.
 */
export function coarseIp(ip: string | null | undefined): string | null {
  if (typeof ip !== 'string') return null
  const value = ip.trim().replace(/\/\d+$/, '')
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i.exec(value)
  if (v4 !== null) return `${v4[1]}.${v4[2]}.${v4[3]}.*`
  if (!/^[0-9a-f:]+$/i.test(value) || !value.includes(':')) return null
  // `::` 를 펼쳐 앞 세 묶음을 얻는다 — `2001:db8::1` 의 앞 셋은 `2001:db8:0`
  const [head, tail] = value.split('::', 2) as [string, string | undefined]
  const front = head === '' ? [] : head.split(':')
  const back = tail === undefined || tail === '' ? [] : tail.split(':')
  const groups = tail === undefined ? front : [...front, ...Array<string>(Math.max(0, 8 - front.length - back.length)).fill('0'), ...back]
  if (groups.length !== 8 || groups.some((g) => g === '' || g.length > 4)) return null
  return `${groups.slice(0, 3).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}:…`
}

/** 대략 위치의 글 — `approx_location` 이 있으면 그것, 없으면 가린 IP 의 네트워크(`203.0.113.* 네트워크`), 둘 다 없으면 null. */
export function placeLabel(approx: string | null | undefined, ip: string | null | undefined): string | null {
  const named = typeof approx === 'string' ? approx.trim().slice(0, 80) : ''
  if (named !== '') return named
  const coarse = coarseIp(ip)
  return coarse === null ? null : `${coarse} 네트워크`
}
