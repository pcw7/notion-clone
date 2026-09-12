/**
 * 색인 텍스트 쓰기자 — W7 (F-07-06)
 *
 * 정본: 00-canonical-data-model.md §3.9 `search_document`
 *       07-search-navigation.md F-07-06
 *       마스터 문서 W7: "색인은 저장 시점 동기"
 *
 * ──────────────────────────────────────────────────────────────────────
 * 이 파일이 쓰는 것은 텍스트 3개뿐이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `title_text` · `body_text` · `lang`. 나머지 컬럼(권한 축 · in_trash ·
 * ancestor_ids · version · 감사)은 **마이그레이션 0012 의 트리거**가 `block` 에서
 * 따라간다. 그 분할의 근거는 마이그레이션 머리말에 있다 — 요약하면 권한 축을 앱이
 * 복사하게 두면 갱신 누락이 "검색 결과가 낡는다" 가 아니라 **권한 누출**이 된다.
 *
 * 그래서 이 파일에는 `perm_scope_id` 가 **나오지 않는다.** 나온다면 그건 버그다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 행은 이미 있다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 트리거가 `block` INSERT 에서 행을 만들었으므로 여기서는 UPDATE 다. 행이 없는
 * 경우는 "페이지가 없다"뿐이고, 그때 UPDATE 0건은 정상이다 — 색인이 없는 페이지를
 * 만들려고 INSERT 하면 FK 위반으로 저장 트랜잭션이 죽는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 같은 트랜잭션에서 돈다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-07-06 의 v0 대안: *"트랜잭션 안에서 자동 갱신되므로 파이프라인·지연·정합성
 * 문제가 전부 사라진다."* 그래서 `Tx` 를 받는다. 별도 커넥션으로 쓰면 저장은
 * 성공하고 색인만 실패하는 상태가 생기고, 그것을 고치려면 outbox 와 재시도가
 * 필요해진다 — v0 에서 그 비용을 지지 않는다.
 */

import type { Tx } from '../db/tx.ts'
import { toPlainText, type RichTextRun } from '../contracts/rich-text.ts'
import { PAGE_TYPE, specOf, isKnownBlockType } from '../block/types.ts'
import { detectLang } from './script.ts'

/**
 * `body_text` 상한.
 *
 * tsvector 쪽 상한(10만 자)은 마이그레이션의 `left()` 가 건다. 여기서 자르는 것은
 * **행 크기** 때문이다 — 본문 한도가 1MB 이고(F-12-16), 색인 행이 그만큼 커지면
 * 검색 결과 목록 질의가 TOAST 를 계속 펼친다.
 *
 * 40만 자로 둔다. 한글 기준 1.2MB 로 본문 한도보다 크므로 **실질적으로 자르지
 * 않는다** — 방어선이지 정책이 아니다. 한국어 검색(pg_bigm 축)은 본문 전체를
 * 봐야 하므로 공격적으로 자를 수 없다(판결: 마이그레이션 0012 머리말).
 */
export const MAX_INDEXED_BODY = 400_000

/** 블록 하나에서 색인할 텍스트를 뽑는다. */
function blockText(type: string, properties: Record<string, unknown> | null): string {
  if (!isKnownBlockType(type)) return ''

  // 자식 페이지의 제목은 **그 페이지의 색인 행**이 갖는다. 여기서 넣으면 부모
  // 본문을 검색했을 때 자식 제목이 걸리고, 자식 이름을 바꿔도 부모 색인은
  // 낡는다(쓰기자가 둘이 된다).
  if (type === PAGE_TYPE) return ''

  const parts: string[] = []
  if (specOf(type).hasRichText) {
    const title = properties?.title
    if (Array.isArray(title)) parts.push(toPlainText(title as RichTextRun[]))
  }
  // 이미지 캡션. `hasRichText = false` 인 타입이지만 RichText[] 를 담는다
  // (`image.ts`). 캡션은 사용자가 쓴 글이므로 검색돼야 한다.
  const caption = properties?.caption
  if (Array.isArray(caption)) parts.push(toPlainText(caption as RichTextRun[]))

  return parts.filter((p) => p.length > 0).join(' ')
}

/** 색인할 블록의 최소 모양. 프로젝터의 `ProjectedBlock` 과 DB 행 양쪽이 맞는다. */
export type IndexableBlock = {
  readonly type: string
  readonly properties: Record<string, unknown> | null
}

/**
 * 문서 순서대로 들어온 블록들을 `body_text` 로 합친다.
 *
 * 순서가 중요한 이유는 스니펫이다 — `ts_headline` 과 bigm 스니펫 모두 이 문자열의
 * 위치에서 잘라내므로, 순서가 문서와 다르면 사용자가 본 적 없는 순서의 문장이
 * 결과에 뜬다.
 */
export function buildBodyText(blocks: readonly IndexableBlock[]): string {
  const parts: string[] = []
  let length = 0
  for (const b of blocks) {
    const text = blockText(b.type, b.properties)
    if (text.length === 0) continue
    parts.push(text)
    // 줄바꿈 1자를 함께 센다. 상한을 넘으면 멈춘다 — 이어 붙인 뒤에 자르면
    // 최악의 경우 1MB 문자열을 한 번 만들었다 버린다.
    length += text.length + 1
    if (length >= MAX_INDEXED_BODY) break
  }
  // 줄바꿈으로 잇는다. 공백으로 이으면 `ts_headline` 이 블록 경계를 넘는 구문을
  // 하나로 보고("마지막 문단 끝" + "다음 문단 시작") 없는 문장을 만들어낸다.
  return parts.join('\n').slice(0, MAX_INDEXED_BODY)
}

export type IndexPageTextInput = {
  /** 페이지 제목. RichText[] 의 평문. */
  readonly title: string
  /** 문서 범위의 본문 블록. 문서 순서여야 한다. */
  readonly blocks: readonly IndexableBlock[]
}

/**
 * 페이지의 색인 텍스트를 쓴다.
 *
 * 호출 지점은 **페이지의 텍스트가 바뀌는 모든 곳**이다:
 *   · `savePageBody` — 본문 (프로젝터 직후, 같은 트랜잭션)
 *   · `createPage`   — 제목 (본문은 비어 있다)
 *   · `renamePage`   — 제목
 *
 * 이동·휴지통·공유 변경에서는 **부르지 않는다.** 텍스트가 안 바뀌므로 트리거가
 * 메타만 따라가면 끝이다(F-07-06: "본문 재색인 없이 메타만 partial update").
 */
export async function indexPageText(
  tx: Tx,
  pageId: string,
  input: IndexPageTextInput,
): Promise<void> {
  const body = buildBodyText(input.blocks)
  // 제목과 본문을 합쳐서 언어를 본다. 제목만 보면 "Q3 Report" 라는 제목의
  // 한국어 문서가 `'en'` 이 된다.
  const lang = detectLang(`${input.title} ${body}`)

  await tx.query(
    `UPDATE search_document
        SET title_text = $2, body_text = $3, lang = $4
      WHERE doc_id = $1`,
    [pageId, input.title, body, lang],
  )
}

/**
 * 제목만 다시 쓴다.
 *
 * `renamePage` 가 쓴다. 본문을 읽지 않으므로 질의 1개다 — 이름만 바꿨는데 문서
 * 범위를 전부 읽으면 제목 변경이 본문 저장만큼 비싸진다.
 */
export async function indexPageTitle(tx: Tx, pageId: string, title: string): Promise<void> {
  await tx.query(
    `UPDATE search_document
        SET title_text = $2,
            -- 본문을 모르는 채로 언어를 다시 판단하면 제목만으로 판정이 뒤집힌다.
            -- 이미 값이 있으면 유지하고, 없을 때만(새 페이지) 제목으로 정한다.
            lang = coalesce(lang, $3)
      WHERE doc_id = $1`,
    [pageId, title, detectLang(title)],
  )
}
