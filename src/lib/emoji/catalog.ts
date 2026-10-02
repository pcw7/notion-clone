/**
 * 이모지 고르개의 목록 · 검색 · 무작위 — 페이지 아이콘(잔여 묶음 8c-1 · F-02-05 · 순수 · DOM · DB 없음)
 *
 * 데이터는 `emojibase-data` 의 한국어 판(`ko/data.json` — MIT · 한국어 이름과 태그 · 1,900여 개)이다. 화면이 고르개를 열 때 지연
 * 로드해(`emoji-catalog-loader.ts`) 이 함수들에 넣는다 — 이 모듈은 데이터를 import 하지 않는다(검사가 작은 표로 돈다).
 *
 * 목록에 넣지 않는 것:
 *   · **구성 요소**(그룹 2 — 피부색 견본 · 머리 모양 조각)와 그룹이 없는 것(깃발을 만드는 지역 지표 글자) — 홀로 쓰는 이모지가 아니다
 *   · **Emoji 15.0 보다 새것**(`MAX_EMOJI_VERSION`) — 화면은 이모지를 OS 글꼴로 그린다. Windows 11 의 글꼴은 15.0 까지라 그 뒤의 것은
 *     두부(□)로 보인다. 고르개가 보여 주지 않을 뿐 받기는 받는다(API · 붙여넣기 — 서버의 규칙은 버전을 모른다)
 *   · 서버가 받지 않는 것(`isSingleEmoji`) — 고를 수 있는데 저장이 거부되면 안 된다. ⚠ **증명하지 못한 방어** — 지금 데이터에는 이
 *     거르기에 걸리는 것이 없다(검사가 거르기 전의 후보 전체로 0개임을 본다 · 빼도 검사가 통과한다 — 8c-1 반사실 c16). 데이터를 올릴
 *     때 걸리는 것이 생기면 고르개에서 조용히 빠진다
 * 피부색 변형은 아직 고르지 않는다(기본 노란색만 — §7).
 *
 * **무작위는 깃발을 뽑지 않는다** — Windows 의 이모지 글꼴에는 국기가 없어 🇧🇹 가 "BT" 두 글자로 보인다(8c-1 의 화면 확인에서 "아이콘
 * 추가"가 실제로 그렇게 달았다). 고르개에는 남긴다 — 다른 OS 는 국기로 그리고, 고르는 사람은 보고 고른다.
 *
 * 검색은 한국어 이름 · 태그의 부분 일치다(띄어쓰기 · 대소문자 무시). 이름이 검색어와 같은 것(또는 이모지 글자 그대로)이 먼저, 이름이
 * 검색어로 시작하는 것, 이름에 든 것, 태그에만 든 것 순서 — 각 무리 안에서는 목록 순서. 영어 이름은 없다(한국어 데이터만 싣는다 — §7).
 */

import { isSingleEmoji } from '../contracts/emoji.ts'

/** 고르개가 보여 주는 가장 새 Emoji 버전(머리말 — 화면이 OS 글꼴로 그린다). */
export const MAX_EMOJI_VERSION = 15

/** 깃발 그룹 — 무작위가 뽑지 않는다(머리말). */
export const FLAGS_GROUP = 9

/** 그룹 번호(Unicode 의 `emoji-test.txt` 순서 · emojibase 의 `group`) → 고르개의 제목. 2(구성 요소)는 싣지 않는다. */
export const EMOJI_GROUP_LABELS: ReadonlyMap<number, string> = new Map([
  [0, '웃는 얼굴과 감정'],
  [1, '사람과 몸'],
  [3, '동물과 자연'],
  [4, '음식과 음료'],
  [5, '여행과 장소'],
  [6, '활동'],
  [7, '사물'],
  [8, '기호'],
  [9, '깃발'],
])

/** emojibase 의 항목 중 쓰는 칸만. */
export type RawEmoji = {
  readonly emoji: string
  readonly label: string
  readonly tags?: readonly string[]
  readonly group?: number
  readonly order?: number
  readonly version: number
}

export type EmojiEntry = {
  readonly emoji: string
  readonly label: string
  readonly tags: readonly string[]
  readonly group: number
}

export type EmojiGroup = { readonly id: number; readonly label: string; readonly entries: readonly EmojiEntry[] }

export type EmojiCatalog = {
  /** 그룹 순서대로 — 빈 그룹은 없다. */
  readonly groups: readonly EmojiGroup[]
  /** 모든 항목 — 그룹 순서 · 그룹 안의 목록 순서. */
  readonly all: readonly EmojiEntry[]
}

export function buildEmojiCatalog(raw: readonly RawEmoji[]): EmojiCatalog {
  const kept = raw
    .filter((e) => e.group !== undefined && EMOJI_GROUP_LABELS.has(e.group) && e.version <= MAX_EMOJI_VERSION && isSingleEmoji(e.emoji))
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const groups: EmojiGroup[] = []
  for (const [id, label] of EMOJI_GROUP_LABELS) {
    const entries = kept
      .filter((e) => e.group === id)
      .map((e) => ({ emoji: e.emoji, label: e.label, tags: e.tags ?? [], group: id }))
    if (entries.length > 0) groups.push({ id, label, entries })
  }
  return { groups, all: groups.flatMap((g) => g.entries) }
}

/** 검색어의 비교 모양 — 띄어쓰기를 빼고 소문자로. */
function fold(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase()
}

/** 검색 — 빈 검색어면 빈 배열(부르는 쪽이 그룹 목록을 보인다). 순서는 머리말. */
export function searchEmoji(catalog: EmojiCatalog, query: string): EmojiEntry[] {
  const q = fold(query)
  if (q === '') return []
  const exact: EmojiEntry[] = []
  const starts: EmojiEntry[] = []
  const inLabel: EmojiEntry[] = []
  const inTags: EmojiEntry[] = []
  for (const entry of catalog.all) {
    const label = fold(entry.label)
    if (entry.emoji === query.trim() || label === q) exact.push(entry)
    else if (label.startsWith(q)) starts.push(entry)
    else if (label.includes(q)) inLabel.push(entry)
    else if (entry.tags.some((tag) => fold(tag).includes(q))) inTags.push(entry)
  }
  return [...exact, ...starts, ...inLabel, ...inTags]
}

/**
 * 무작위 하나 — 깃발이 아닌 것 중에서(머리말). 뽑을 것이 없으면 null. `except`(지금 아이콘)는 고르지 않는다 — "무작위"를 눌렀는데
 * 그대로면 고장 난 것처럼 보인다(뽑힌 것이 그것이면 다음 것). `random` 은 [0, 1) 을 내는 함수(검사가 정한다).
 */
export function randomEmoji(catalog: EmojiCatalog, except: string | null = null, random: () => number = Math.random): EmojiEntry | null {
  const all = catalog.all.filter((e) => e.group !== FLAGS_GROUP)
  if (all.length === 0) return null
  const index = Math.min(all.length - 1, Math.floor(random() * all.length))
  if (all[index].emoji !== except || all.length === 1) return all[index]
  return all[(index + 1) % all.length]
}
