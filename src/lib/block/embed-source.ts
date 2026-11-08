/**
 * 임베드 주소 규칙 — F-09-10 (44번 트랙 EM-1 · 정본 §3.4 [보강 EM-1] ②)
 *
 * 주소 하나에서 iframe 주소를 **순수 규칙으로** 만든다(네트워크 없음). 블록에는 주소만 적고 iframe 주소 · 서비스 이름은 읽을 때 여기서 만든다.
 * 결과 주소는 늘 https 다. 호스트는 URL 로 읽어 정확히 · 하위 도메인으로만 맞춘다(`youtube.com.evil.com` 은 YouTube 가 아니다).
 *
 * 순수 모듈이다 — 편집기 · 공개 화면이 함께 읽는다.
 */

import { isBookmarkUrl } from './bookmark-block.ts'

export type EmbedProvider =
  | 'youtube'
  | 'vimeo'
  | 'loom'
  | 'figma'
  | 'google-maps'
  | 'google-docs'
  | 'google-sheets'
  | 'google-slides'
  | 'google-drive'
  | 'codepen'
  | 'codesandbox'
  | 'spotify'
  | 'soundcloud'
  | 'miro'
  | 'x'

export type EmbedKnown = {
  readonly kind: 'known'
  readonly provider: EmbedProvider
  readonly label: string
  readonly src: string
  /** 가로 / 세로 — 동영상. 없으면 `height` 를 쓴다. */
  readonly aspect?: number
  readonly height?: number
}

export type EmbedGeneric = {
  readonly kind: 'generic'
  readonly provider: 'generic'
  /** 호스트(`www.` 는 뗀다). */
  readonly label: string
  /** 그 주소 그대로. */
  readonly src: string
  readonly height: number
}

export type EmbedRefused = { readonly kind: 'refused'; readonly reason: string }

export type EmbedSource = EmbedKnown | EmbedGeneric | EmbedRefused

export { EMBED_ALLOW, EMBED_REFERRER_POLICY, EMBED_SANDBOX } from './embed-attrs.ts'

export const GENERIC_EMBED_HEIGHT = 450
const VIDEO_ASPECT = 16 / 9

function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

function known(provider: EmbedProvider, label: string, src: string, shape: { aspect?: number; height?: number }): EmbedKnown {
  return { kind: 'known', provider, label, src, ...shape }
}

/** `90` · `90s` · `1m30s` · `1h2m3s` → 초. 읽지 못하거나 0 이면 null. */
export function embedStartSeconds(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(raw)
  if (!match) return null
  const total = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
  return total > 0 && total < 360_000 ? total : null
}

function youtube(u: URL): EmbedKnown | null {
  const host = u.hostname
  let id: string | null = null
  if (host === 'youtu.be') {
    id = u.pathname.split('/')[1] ?? null
  } else if (hostIs(host, 'youtube.com') || hostIs(host, 'youtube-nocookie.com')) {
    const path = /^\/(?:shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname)
    if (path) id = path[1] ?? null
    else if (u.pathname === '/watch') id = u.searchParams.get('v')
    else if (u.pathname !== '/playlist') return null
  } else return null
  const list = u.searchParams.get('list')
  const listId = list !== null && /^[\w-]{10,64}$/.test(list) ? list : null
  const videoId = id !== null && /^[\w-]{11}$/.test(id) ? id : null
  if (videoId === null && listId === null) return null
  const hashStart = /^#(?:t|start)=([\w]+)/.exec(u.hash)?.[1]
  const start = embedStartSeconds(u.searchParams.get('t') ?? u.searchParams.get('start') ?? hashStart)
  const query = new URLSearchParams()
  if (videoId === null) query.set('list', listId as string)
  else if (listId !== null) query.set('list', listId)
  if (start !== null && videoId !== null) query.set('start', String(start))
  const tail = query.toString()
  const base = videoId === null ? 'https://www.youtube-nocookie.com/embed/videoseries' : `https://www.youtube-nocookie.com/embed/${videoId}`
  return known('youtube', '유튜브', tail === '' ? base : `${base}?${tail}`, { aspect: VIDEO_ASPECT })
}

function vimeo(u: URL): EmbedKnown | null {
  if (u.hostname === 'player.vimeo.com') {
    const id = /^\/video\/(\d+)\/?$/.exec(u.pathname)?.[1]
    if (!id) return null
    const h = u.searchParams.get('h')
    return known('vimeo', 'Vimeo', `https://player.vimeo.com/video/${id}${h !== null && /^\w+$/.test(h) ? `?h=${h}` : ''}`, { aspect: VIDEO_ASPECT })
  }
  if (u.hostname !== 'vimeo.com' && u.hostname !== 'www.vimeo.com') return null
  const match = /^\/(?:(?:channels|groups)\/[^/]+\/(?:videos\/)?)?(\d{5,})(?:\/([0-9a-f]{6,}))?\/?$/.exec(u.pathname)
  if (!match) return null
  return known('vimeo', 'Vimeo', `https://player.vimeo.com/video/${match[1]}${match[2] ? `?h=${match[2]}` : ''}`, { aspect: VIDEO_ASPECT })
}

function loom(u: URL): EmbedKnown | null {
  if (u.hostname !== 'loom.com' && u.hostname !== 'www.loom.com') return null
  const id = /^\/(?:share|embed)\/([\w]{16,64})\/?$/.exec(u.pathname)?.[1]
  return id ? known('loom', 'Loom', `https://www.loom.com/embed/${id}`, { aspect: VIDEO_ASPECT }) : null
}

function figma(u: URL, original: string): EmbedKnown | null {
  if (u.hostname !== 'figma.com' && u.hostname !== 'www.figma.com') return null
  if (u.pathname === '/embed') return known('figma', 'Figma', original, { height: 450 })
  if (!/^\/(?:file|design|proto|board|slides)\/[^/]+/.test(u.pathname)) return null
  return known('figma', 'Figma', `https://www.figma.com/embed?embed_host=notion-clone&url=${encodeURIComponent(original)}`, { height: 450 })
}

function googleMaps(u: URL): EmbedKnown | null {
  const host = u.hostname
  const isMapsHost = host === 'maps.google.com'
  if (!isMapsHost && host !== 'google.com' && host !== 'www.google.com') return null
  const path = u.pathname
  if (path === '/maps/embed' || path.startsWith('/maps/embed/')) return known('google-maps', 'Google 지도', `https://${host}${path}${u.search}`, { height: 450 })
  if (!isMapsHost && path !== '/maps' && !path.startsWith('/maps/')) return null
  let query = u.searchParams.get('q') ?? u.searchParams.get('query')
  if (query === null || query.trim() === '') {
    const named = /^\/maps\/(?:search|place)\/([^/]+)/.exec(path)?.[1]
    if (named) {
      try {
        query = decodeURIComponent(named.replace(/\+/g, ' '))
      } catch {
        return null
      }
    }
  }
  if (query === null || query.trim() === '') return null
  const out = new URLSearchParams({ q: query.trim(), output: 'embed' })
  return known('google-maps', 'Google 지도', `https://maps.google.com/maps?${out.toString()}`, { height: 450 })
}

function googleDocs(u: URL): EmbedKnown | null {
  if (u.hostname !== 'docs.google.com') return null
  const match = /^\/(document|spreadsheets|presentation)\/d\/([\w-]{20,})(?:\/|$)/.exec(u.pathname)
  if (!match) return null
  const [, kind, id] = match
  if (kind === 'document') return known('google-docs', 'Google 문서', `https://docs.google.com/document/d/${id}/preview`, { height: 480 })
  if (kind === 'spreadsheets') return known('google-sheets', 'Google 스프레드시트', `https://docs.google.com/spreadsheets/d/${id}/preview`, { height: 480 })
  return known('google-slides', 'Google 슬라이드', `https://docs.google.com/presentation/d/${id}/embed`, { height: 480 })
}

function googleDrive(u: URL): EmbedKnown | null {
  if (u.hostname !== 'drive.google.com') return null
  const id = /^\/file\/d\/([\w-]{10,})(?:\/|$)/.exec(u.pathname)?.[1] ?? (u.pathname === '/open' ? u.searchParams.get('id') : null)
  if (!id || !/^[\w-]{10,}$/.test(id)) return null
  return known('google-drive', 'Google 드라이브', `https://drive.google.com/file/d/${id}/preview`, { height: 480 })
}

function codepen(u: URL): EmbedKnown | null {
  if (u.hostname !== 'codepen.io' && u.hostname !== 'www.codepen.io') return null
  const match = /^\/([\w-]+)\/(?:pen|full|details|embed)\/(\w+)\/?$/.exec(u.pathname)
  return match ? known('codepen', 'CodePen', `https://codepen.io/${match[1]}/embed/${match[2]}?default-tab=result`, { height: 400 }) : null
}

function codesandbox(u: URL): EmbedKnown | null {
  if (u.hostname !== 'codesandbox.io' && u.hostname !== 'www.codesandbox.io') return null
  const id = /^\/(?:s|embed|p\/sandbox)\/([\w-]+)\/?$/.exec(u.pathname)?.[1]
  return id ? known('codesandbox', 'CodeSandbox', `https://codesandbox.io/embed/${id}`, { height: 500 }) : null
}

function spotify(u: URL): EmbedKnown | null {
  if (u.hostname !== 'open.spotify.com') return null
  const match = /^\/(?:intl-[\w-]+\/)?(?:embed\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]{10,30})\/?$/.exec(u.pathname)
  if (!match) return null
  const [, type, id] = match
  return known('spotify', 'Spotify', `https://open.spotify.com/embed/${type}/${id}`, { height: type === 'track' || type === 'episode' ? 152 : 352 })
}

function soundcloud(u: URL, original: string): EmbedKnown | null {
  if (u.hostname === 'w.soundcloud.com') return u.pathname.startsWith('/player') ? known('soundcloud', 'SoundCloud', original, { height: 166 }) : null
  if (u.hostname !== 'soundcloud.com' && u.hostname !== 'www.soundcloud.com' && u.hostname !== 'm.soundcloud.com' && u.hostname !== 'on.soundcloud.com') return null
  if (u.pathname === '/' || u.pathname === '') return null
  const sets = u.pathname.includes('/sets/')
  return known('soundcloud', 'SoundCloud', `https://w.soundcloud.com/player/?url=${encodeURIComponent(original)}`, { height: sets ? 352 : 166 })
}

function miro(u: URL): EmbedKnown | null {
  if (u.hostname !== 'miro.com' && u.hostname !== 'www.miro.com') return null
  const id = /^\/app\/(?:board|live-embed)\/([\w=-]+)\/?$/.exec(u.pathname)?.[1]
  return id ? known('miro', 'Miro', `https://miro.com/app/live-embed/${id}/`, { height: 480 }) : null
}

function xTweet(u: URL): EmbedKnown | null {
  const host = u.hostname
  if (!['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(host)) return null
  const id = /^\/(?:\w{1,15}|i\/web)\/status(?:es)?\/(\d{1,25})(?:\/|$)/.exec(u.pathname)?.[1]
  return id ? known('x', 'X', `https://platform.twitter.com/embed/Tweet.html?id=${id}`, { height: 560 }) : null
}

/**
 * 주소 → 그리는 법. 알려진 서비스면 `known`(https 로 올려 그린다) · 다른 https 주소는 `generic`(눌러야 불러온다) · http 인 일반 주소와 http(s) 가
 * 아닌 것은 `refused`(섞인 콘텐츠). 자기 출처 검사는 `embedPlanOf` 가 한다.
 */
export function embedSourceOf(url: string): EmbedSource {
  if (!isBookmarkUrl(url)) return { kind: 'refused', reason: 'http 또는 https 주소만 임베드할 수 있습니다.' }
  const parsed = new URL(url)
  const secure = new URL(url)
  secure.protocol = 'https:'
  const original = secure.href
  const hit =
    youtube(secure) ??
    vimeo(secure) ??
    loom(secure) ??
    figma(secure, original) ??
    googleMaps(secure) ??
    googleDocs(secure) ??
    googleDrive(secure) ??
    codepen(secure) ??
    codesandbox(secure) ??
    spotify(secure) ??
    soundcloud(secure, original) ??
    miro(secure) ??
    xTweet(secure)
  if (hit) return hit
  if (parsed.protocol !== 'https:') return { kind: 'refused', reason: 'http 주소는 보안 연결이 아니라 이 페이지 안에 그릴 수 없습니다 — https 주소가 필요합니다.' }
  return { kind: 'generic', provider: 'generic', label: parsed.hostname.replace(/^www\./, ''), src: parsed.href, height: GENERIC_EMBED_HEIGHT }
}

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

/** 편집기 · 공개 화면이 부르는 하나 — 자기 출처의 주소는 그리지 않는다(`allow-same-origin` 과 겹치면 격리가 풀리고 끝없이 중첩된다 · 정본 ③). */
export function embedPlanOf(url: string, ownHosts: readonly string[]): EmbedSource {
  if (isOwnHostUrl(url, ownHosts)) {
    return { kind: 'refused', reason: '이 앱 자신의 주소는 임베드할 수 없습니다 — 격리가 풀리고 화면이 끝없이 겹칩니다.' }
  }
  return embedSourceOf(url)
}
