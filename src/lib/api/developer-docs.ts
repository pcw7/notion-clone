/**
 * 개발자 문서의 내용 — 오류 코드 · 제한 · 예제 · 노션과 다른 점 (API-6 · F-09-15 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ① ~ ⑩ · 09-api-integrations.md F-09-05 · F-09-15
 *
 * 숫자는 규약의 상수에서 읽는다(손으로 적은 숫자가 코드와 어긋나지 않게) — 요청 제한 · 본문 · 쪽 크기 · 블록 · 질의 상한 · 토큰 수 · 만료.
 * 오류 코드 표는 `ApiErrorCode` 의 모든 값을 가져야 한다(`satisfies` — 코드를 더하면 여기서 타입이 막는다). 화면은 `app/developers/page.tsx`.
 */

import { MAX_QUERY_PAGINATION } from '../database/limits.ts'
import { API_MAX_BLOCKS, API_MAX_CHILDREN, API_MAX_NESTING } from './block-json.ts'
import { API_TOKEN_DEFAULT_EXPIRY_DAYS, API_TOKEN_EXPIRY_DAYS, API_TOKEN_MAX_LIVE } from './token-format.ts'
import { API_MAX_BODY_BYTES, API_MAX_PAGE_SIZE, API_RATE_RULE, NOTION_VERSION, type ApiErrorCode } from './v1-protocol.ts'

export { NOTION_VERSION }

/** 화면의 숫자 — 천 단위 쉼표. */
const n = (value: number): string => value.toLocaleString('en-US')

/** 만료 고르개의 말 — 일수와 "없음"(설정의 고르개와 같은 차례). */
export function expiryChoices(): string {
  const days = [...API_TOKEN_EXPIRY_DAYS].map((d) => (d === 365 ? '1년' : `${d}일`))
  const fallback = API_TOKEN_DEFAULT_EXPIRY_DAYS === 365 ? '1년' : `${API_TOKEN_DEFAULT_EXPIRY_DAYS}일`
  return `${days.join(' · ')} · 없음(기본 ${fallback})`
}

export const LIMITS: readonly { readonly name: string; readonly value: string; readonly note: string }[] = [
  {
    name: '요청 수',
    value: `토큰마다 평균 초당 ${API_RATE_RULE.limit / API_RATE_RULE.windowSeconds}번`,
    note: `${API_RATE_RULE.windowSeconds}초에 ${API_RATE_RULE.limit}번까지 받는다(짧은 몰림은 괜찮다). 넘으면 429 rate_limited 와 Retry-After(초) — 공식 SDK 는 그만큼 기다렸다 다시 보낸다.`,
  },
  { name: '요청 본문', value: `${API_MAX_BODY_BYTES / 1024}KB`, note: '넘으면 400 validation_error.' },
  { name: '한 쪽의 크기', value: `page_size 최대 ${API_MAX_PAGE_SIZE}`, note: `주지 않으면 ${API_MAX_PAGE_SIZE}. 넘으면 400.` },
  {
    name: '블록 쓰기',
    value: `한 요청에 ${n(API_MAX_BLOCKS)}개`,
    note: `children 배열 하나에 ${API_MAX_CHILDREN}개 · ${API_MAX_NESTING}단까지 중첩.`,
  },
  {
    name: '질의 한 번',
    value: `${n(MAX_QUERY_PAGINATION)}행`,
    note: '커서로 넘겨 받을 수 있는 행의 상한. 닿으면 응답의 request_status 가 incomplete — created_time 으로 범위를 잘라 다시 묻는다(SDK 의 iterateAllDataSourceRows).',
  },
  { name: '토큰', value: `사람마다 워크스페이스마다 ${API_TOKEN_MAX_LIVE}개`, note: '살아 있는(폐기 · 만료되지 않은) 것만 센다.' },
]

/** 오류 코드 — 노션의 코드 그대로. 글(`message`)은 영어(노션의 말투). */
export const ERROR_CODES = {
  invalid_json: { status: 400, when: '본문이 JSON 이 아니다' },
  invalid_request_url: { status: 400, when: '없는 주소 · 받지 않는 메서드' },
  invalid_request: { status: 400, when: '받지 않는 Notion-Version' },
  missing_version: { status: 400, when: 'Notion-Version 머리가 없다' },
  validation_error: { status: 400, when: '본문 · 매개변수가 틀렸다 · 지원하지 않는 기능 · 잠긴 페이지 쓰기' },
  unauthorized: { status: 401, when: '토큰이 없거나 · 틀렸거나 · 폐기 · 만료됐다(어느 쪽인지 말하지 않는다)' },
  restricted_resource: { status: 403, when: '볼 수는 있지만 고칠 권한이 없다 · 내보내기 정책이 막았다' },
  object_not_found: { status: 404, when: '없거나 볼 권한이 없다(있는지 새지 않는다)' },
  conflict_error: { status: 409, when: '동시에 쓴 것과 부딪쳤다 — 다시 보낸다' },
  rate_limited: { status: 429, when: '요청이 너무 잦다 — Retry-After 만큼 기다린다' },
  internal_server_error: { status: 500, when: '서버 오류 — request_id 를 알려 주세요' },
} as const satisfies Record<ApiErrorCode, { readonly status: number; readonly when: string }>

export const ERROR_SAMPLE = `{
  "object": "error",
  "status": 404,
  "code": "object_not_found",
  "message": "Could not find page with ID: 59833787-2cf9-4fdf-8782-e53db20768a5.",
  "request_id": "c1f8a4f0-7e1d-4f7e-9d65-0b0d6f3c8a12"
}`

/** 예제의 주소 — 설정한 공개 주소(`NEXT_PUBLIC_APP_URL`), 없으면 이 요청의 호스트(프록시 뒤라면 `x-forwarded-*`). */
export function docsOrigin(input: {
  readonly configured?: string | undefined
  readonly host?: string | null
  readonly forwardedHost?: string | null
  readonly forwardedProto?: string | null
}): string {
  const configured = (input.configured ?? '').trim()
  if (configured !== '') {
    try {
      return new URL(configured).origin
    } catch {
      // 읽히지 않는 설정 — 요청의 호스트로
    }
  }
  const host = (input.forwardedHost ?? '').split(',')[0]?.trim() || (input.host ?? '').trim() || 'localhost:3000'
  const proto = (input.forwardedProto ?? '').split(',')[0]?.trim() || (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https')
  return `${proto}://${host}`
}

export function curlSample(origin: string): string {
  return `curl ${origin}/v1/users/me \\
  -H "Authorization: Bearer ntn_…" \\
  -H "Notion-Version: ${NOTION_VERSION}"`
}

export const ME_SAMPLE = `{
  "object": "user",
  "id": "2c1e7a5d-…",
  "type": "person",
  "name": "김노션",
  "avatar_url": null,
  "person": { "email": "me@example.com" }
}`

export function sdkSample(origin: string): string {
  return `import { Client, collectPaginatedAPI } from '@notionhq/client'

const notion = new Client({
  auth: process.env.NOTION_TOKEN,       // ntn_…
  baseUrl: '${origin}',
  notionVersion: '${NOTION_VERSION}',
})

const me = await notion.users.me({})

// 쪽을 넘기며 모두 — 커서는 SDK 가 이어 준다
const rows = await collectPaginatedAPI(notion.dataSources.query, {
  data_source_id: '…',
  filter: { property: '점수', number: { greater_than_or_equal_to: 4 } },
  sorts: [{ property: '점수', direction: 'descending' }],
})`
}

export const SDK_ERROR_SAMPLE = `import { APIErrorCode, APIResponseError } from '@notionhq/client'

try {
  await notion.pages.retrieve({ page_id })
} catch (error) {
  if (APIResponseError.isAPIResponseError(error) && error.code === APIErrorCode.ObjectNotFound) {
    // 없거나 볼 수 없다
  } else {
    throw error
  }
}`

export const PAGINATION_SAMPLE = `{
  "object": "list",
  "results": [ … ],
  "next_cursor": "b186YjoxNTAz…",
  "has_more": true,
  "type": "page_or_data_source",
  "page_or_data_source": {}
}`

/** 노션과 다른 점 — 정본 [보강 API-1] ⑥ ~ ⑩ 를 쉬운 말로 줄였다. 자세한 것은 정본. */
export const DIFFERENCES: readonly { readonly title: string; readonly items: readonly string[] }[] = [
  {
    title: '토큰과 범위',
    items: [
      '개인 토큰만 있다 — 통합(봇) · OAuth · 웹훅 · 파일 올리기 · 뷰 · 페이지 옮기기는 없다(그런 주소는 400 invalid_request_url).',
      '토큰은 만든 사람 그대로다 — 노션은 개인 토큰의 사용자 목록을 막지만 여기서는 연다(앱의 멤버 화면과 같다).',
      `받는 판은 ${NOTION_VERSION} 하나다.`,
    ],
  },
  {
    title: '페이지 (⑥)',
    items: [
      '올린 파일의 아이콘 · 커버와 내장 커버는 null 로 읽힌다(짧게 사는 파일 주소를 만들지 않는다).',
      '파일 속성은 { type: "file_upload", file_upload: { id } } — 읽은 값을 그대로 다시 보내면 같은 값이다.',
      '없는 선택 옵션 이름은 거부한다(노션은 새로 만든다) — 옵션은 데이터 소스 고치기로 만든다.',
      '잠긴 페이지에 쓰면 400 · 내보내기 정책이 꺼진 워크스페이스는 소유자만 읽고 쓴다.',
      'filter_properties 는 읽기(GET /v1/pages/{id} · 질의)에서만 듣는다 — 만들기 · 고치기의 응답은 모든 속성.',
    ],
  },
  {
    title: '블록 (⑦)',
    items: [
      '지운 본문 블록은 되살릴 수 없다 — 버전 기록으로 되돌린다(in_trash: false 는 페이지만).',
      '토글 헤딩 · 이모지가 아닌 콜아웃 아이콘 · link_to_page · synced_block · pdf · audio · template 쓰기는 400.',
      '버튼 · 출처 없는 미디어는 unsupported 로 읽힌다.',
    ],
  },
  {
    title: '데이터 소스 · 질의 (⑧)',
    items: [
      'rollup · 장소 · 버튼으로 거르기, 사람 · 연결 · 파일 · rollup 으로 정렬하기는 400.',
      '없는 선택 옵션 이름으로 거르면 거부하지 않고 아무것도 맞지 않는다.',
      '상대 날짜(지난주 등)의 오늘은 UTC 다.',
      '커서는 그 질의에 묶인다 — 필터 · 정렬이 다른 질의에 쓰면 400.',
      '수식의 expression 은 앱의 식(prop("이름")) · 데이터 소스의 created_by · last_edited_by 는 싣지 않는다.',
    ],
  },
  {
    title: '데이터베이스 만들기 · 고치기 (⑨)',
    items: [
      '만들기는 페이지 본문 안의 인라인 데이터베이스만 — is_inline: false · 워크스페이스 최상위는 400.',
      '한 요청이 한 트랜잭션이다 — 속성 하나라도 거부되면 아무것도 바뀌지 않는다.',
      '선택 옵션은 id 로 잡으면 이름도 바꾼다(노션은 못 한다) · 빠진 옵션은 지운다.',
      '수식 · relation · rollup 으로의 타입 바꾸기, 버튼 · 장소 속성 만들기, 데이터베이스 옮기기는 400.',
    ],
  },
  {
    title: '검색 · 코멘트 · 사용자 (⑩)',
    items: [
      '검색은 제목만 찾는다(본문은 찾지 않는다) · 휴지통은 찾지 않는다 · 기본 정렬은 앱의 "가장 잘 맞는 순".',
      '코멘트의 display_name 은 user 만 · attachments 는 빈 배열만 · markdown 은 400.',
      '남의 코멘트를 고치거나 지우면 403(노션은 404) · 해결된 스레드에 답하면 다시 열린다.',
      '사용자 목록은 활동 중인 멤버만(게스트 · 멈춘 사람은 빠진다).',
    ],
  },
]
