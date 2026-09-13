/**
 * 익스포트 파일 이름 — F-09-14
 *
 * 정본: 09-api-integrations.md F-09-14 — *"파일명 충돌 해결 규칙(동명 페이지 → 접미사에 id
 *       일부 부착)을 명세로 고정해야 임포터가 역파싱할 수 있다."*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 제목은 파일 이름이 아니다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 제목에는 무엇이든 들어간다. 파일 이름은 ZIP 을 풀 운영체제 셋(Windows · macOS · Linux)과
 * 압축 해제 도구가 모두 받는 글자여야 한다. 원래 제목은 `.md` 의 첫 줄 `# 제목` 에 그대로
 * 남는다 — 파일 이름은 찾아가는 길일 뿐이다. 그래서 의심스러우면 바꾸는 쪽으로 기운다.
 *
 * `safeFileName` 의 규칙, 순서대로:
 *   1. NFC. 줄바꿈 · 제어 문자 → 공백. 공백을 하나로 몬다
 *   2. Windows 가 거부하는 `< > : " / \ | ? *` → `_`
 *   3. **BMP 밖 글자(이모지)와 그것을 잇는 글자(ZWJ · 변형 선택자)를 뺀다** — bsdtar(libarchive
 *      3.8.8 · Windows)는 그런 이름을 풀지 못한다. 한글 · `é` · `·` · `#%` 는 푼다(실측, HANDOFF §3.3-66)
 *   4. 60글자에서 자른다 — 폴더가 깊어지면 경로 전체가 Windows 의 260자에 먼저 걸린다
 *   5. 끝의 `.` · 공백은 뗀다(Windows 가 떼어 ZIP 안의 이름과 풀린 이름이 달라진다).
 *      앞의 `.` 은 `_` 로 바꾼다(유닉스에서 숨김 파일이 된다)
 *   6. 장치 이름(CON · PRN · AUX · NUL · COM1–9 · LPT1–9)은 확장자가 붙어도 Windows 가 받지
 *      않는다 → 그 이름 바로 뒤에 `_`
 *   7. 남은 것이 없으면 대체 이름
 *
 * ──────────────────────────────────────────────────────────────────────
 * 겹치면 겹친 항목 **전부**에 id 를 붙인다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 먼저 온 쪽이 원래 이름을 갖게 하면 형제 순서나 **누가 권한 때문에 빠졌는가**에 따라 같은
 * 페이지의 파일 이름이 익스포트마다 달라진다. 겹친 항목 전부에 ` ` + id 앞 8자리(하이픈을 뺀
 * 16진수)를 붙이고, 그래도 겹치면 32자리 전체를 붙인다. 이름은 **그 폴더의 항목 집합만으로**
 * 정해지고 순서와 무관하다.
 *
 * 겹침은 대소문자 · NFC 를 무시하고 본다 — `zip.ts` 와 **같은 함수**(`collisionKey`)다. 두 벌이면
 * 여기서 통과한 이름을 ZIP 이 중복으로 거부하는 날이 온다. 페이지는 `이름.md` 와 폴더 `이름` 을,
 * 데이터베이스는 `이름.csv` 와 폴더 `이름` 을 **폴더가 실제로 생기든 말든** 둘 다 차지한다 —
 * 하위 페이지가 생기는 순간 그 페이지의 파일 이름이 바뀌면 안 된다.
 */

import { collisionKey } from './zip.ts'

export const MAX_NAME_LENGTH = 60

const WINDOWS_FORBIDDEN = /[<>:"/\\|?*]/g
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\.|$)/i

/** 이모지를 잇거나(ZWJ) 모양을 고르는(변형 선택자) 글자. 이모지를 빼면 홀로 남아 보이지 않는 글자가 된다. */
const EMOJI_GLUE: ReadonlySet<number> = new Set([0x200d, 0xfe0e, 0xfe0f])

function isControl(codePoint: number): boolean {
  return (
    codePoint < 0x20 ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x2028 || // 줄 구분자
    codePoint === 0x2029 // 문단 구분자
  )
}

function cut(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : chars.slice(0, max).join('')
}

/** 제목을 파일 이름으로(확장자 없이). 규칙은 머리말. */
export function safeFileName(title: string, fallback: string): string {
  let name = ''
  for (const ch of title.normalize('NFC')) {
    const codePoint = ch.codePointAt(0) ?? 0
    if (codePoint > 0xffff || EMOJI_GLUE.has(codePoint)) continue
    name += isControl(codePoint) ? ' ' : ch
  }
  name = name.replace(WINDOWS_FORBIDDEN, '_').replace(/\s+/g, ' ').trim()
  name = cut(name, MAX_NAME_LENGTH).replace(/[. ]+$/, '')
  if (name.startsWith('.')) name = `_${name.slice(1)}`
  if (name === '') return fallback
  return name.replace(DEVICE_NAME, '$1_')
}

export type NameRequest = {
  /** 결과 맵의 키. */
  readonly key: string
  /** 겹칠 때 붙일 id(uuid). */
  readonly id: string
  /** `safeFileName` 이 만든 이름. */
  readonly base: string
  /**
   * 이 항목이 폴더 안에서 차지하는 이름들의 확장자. 폴더는 `''` 이다.
   * 페이지 `['.md', '']` · 데이터베이스 `['.csv', '']` · 첨부 `['.png']`.
   */
  readonly extensions: readonly string[]
}

/** 접미사 단계: 없음 → id 8자리 → 32자리. */
const SUFFIX_LENGTHS = [0, 8, 32] as const

/**
 * 한 폴더의 항목들에 겹치지 않는 이름을 준다. 반환은 `key → 이름(확장자 없이)`.
 *
 * @param reserved 이 폴더에서 이미 쓰는 이름(확장자 포함). 최상위의 `_export_report.json` 같은 것.
 */
export function resolveNames(
  requests: readonly NameRequest[],
  reserved: readonly string[] = [],
): Map<string, string> {
  const level = new Map<string, number>(requests.map((r) => [r.key, 0]))
  const nameOf = (request: NameRequest): string => {
    const length = SUFFIX_LENGTHS[level.get(request.key) ?? 0]
    return length === 0 ? request.base : `${request.base} ${request.id.replace(/-/g, '').slice(0, length)}`
  }
  const reservedClaims = new Set(reserved.map(collisionKey))

  for (;;) {
    const owners = new Map<string, string[]>()
    for (const request of requests) {
      const name = nameOf(request)
      for (const extension of request.extensions) {
        const claim = collisionKey(name + extension)
        const list = owners.get(claim)
        if (list) list.push(request.key)
        else owners.set(claim, [request.key])
      }
    }

    const colliding = new Set<string>()
    for (const [claim, keys] of owners) {
      if (keys.length > 1 || reservedClaims.has(claim)) for (const key of keys) colliding.add(key)
    }
    if (colliding.size === 0) return new Map(requests.map((r) => [r.key, nameOf(r)]))

    // 겹친 항목만 한 단계 올린다. 올린 이름이 다른 항목과 새로 겹치면 다음 바퀴에서 둘 다 오른다.
    for (const key of colliding) {
      const next = (level.get(key) ?? 0) + 1
      if (next >= SUFFIX_LENGTHS.length) {
        throw new Error(`id 32자리를 붙여도 파일 이름이 겹친다(같은 id 가 두 번 들어왔다): ${key}`)
      }
      level.set(key, next)
    }
  }
}

/**
 * Markdown 링크에 넣을 경로 조각.
 *
 * `%` · `#` · `?` 는 주소 문법이라 인코딩한다. 공백 · 괄호는 Markdown 직렬화기의 `linkDestination`
 * 이 인코딩한다 — 여기서 먼저 하면 `%` 가 두 번 인코딩된다.
 */
export function encodeHrefSegment(name: string): string {
  return name.replace(/[%#?]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
}
