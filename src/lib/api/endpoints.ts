/**
 * 공개 API `/v1` 의 주소 목록 — 개발자 문서의 표가 이것을 그린다 (API-6 · F-09-15 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ~ ⑪ · 09-api-integrations.md F-09-15 *"단일 소스로 두면 드리프트가 사라진다"*
 *
 * `endpoints.test.ts` 가 `src/app/v1/**\/route.ts` 를 읽어 **메서드 · 주소 · 핸들러 이름**이 이 목록과 하나도 다르지 않은지 본다 — 라우트를
 * 더하거나 빼면 여기도 고쳐야 CI 가 지난다. 받지 않는 메서드(`v1InvalidUrl` — 400 `invalid_request_url`)는 싣지 않는다.
 * 글은 화면에 그대로 나간다(한국어 · 짧게). 노션과 다른 점의 자세한 것은 `developer-docs.ts` 의 "노션과 다른 점".
 */

export type ApiMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export type ApiEndpoint = {
  readonly method: ApiMethod
  /** 노션 문서와 같은 모양 — `/v1/pages/{page_id}`. 경로의 `{이름}` 은 라우트 폴더의 `[이름]`. */
  readonly path: string
  /** 라우트가 `v1Route(…)` 에 넘기는 핸들러의 이름 — 시험이 라우트 파일과 견준다. */
  readonly handler: string
  /** 공식 SDK(`@notionhq/client`)의 메서드. */
  readonly sdk: string
  readonly summary: string
  readonly note?: string
}

export type ApiEndpointGroup = { readonly title: string; readonly endpoints: readonly ApiEndpoint[] }

export const API_ENDPOINT_GROUPS: readonly ApiEndpointGroup[] = [
  {
    title: '사용자',
    endpoints: [
      { method: 'GET', path: '/v1/users/me', handler: 'usersMe', sdk: 'users.me', summary: '토큰을 만든 사람' },
      {
        method: 'GET',
        path: '/v1/users',
        handler: 'listApiUsers',
        sdk: 'users.list',
        summary: '워크스페이스의 멤버 목록',
        note: '활동 중인 멤버만(게스트 · 멈춘 사람은 빠진다)',
      },
      { method: 'GET', path: '/v1/users/{user_id}', handler: 'retrieveApiUser', sdk: 'users.retrieve', summary: '사람 하나', note: '나간 사람은 404' },
    ],
  },
  {
    title: '페이지',
    endpoints: [
      {
        method: 'POST',
        path: '/v1/pages',
        handler: 'createApiPage',
        sdk: 'pages.create',
        summary: '페이지 밑에 페이지 · 데이터 소스에 행 만들기',
        note: '`children` 으로 본문을 함께 쓴다',
      },
      { method: 'GET', path: '/v1/pages/{page_id}', handler: 'retrievePage', sdk: 'pages.retrieve', summary: '페이지 객체(속성 · 아이콘 · 부모)' },
      {
        method: 'PATCH',
        path: '/v1/pages/{page_id}',
        handler: 'updateApiPage',
        sdk: 'pages.update',
        summary: '속성 · 아이콘 · 커버 고치기 · 휴지통',
        note: '`in_trash: true` 로 지우고 `false` 로 되살린다',
      },
      {
        method: 'GET',
        path: '/v1/pages/{page_id}/properties/{property_id}',
        handler: 'retrievePageProperty',
        sdk: 'pages.properties.retrieve',
        summary: '속성 값 하나',
        note: '제목 · 글 · 사람 · 연결은 쪽으로 나눈 목록',
      },
    ],
  },
  {
    title: '블록',
    endpoints: [
      { method: 'GET', path: '/v1/blocks/{block_id}', handler: 'retrieveBlock', sdk: 'blocks.retrieve', summary: '블록 하나' },
      { method: 'PATCH', path: '/v1/blocks/{block_id}', handler: 'updateApiBlock', sdk: 'blocks.update', summary: '블록 내용 고치기', note: '종류는 바꾸지 않는다' },
      {
        method: 'DELETE',
        path: '/v1/blocks/{block_id}',
        handler: 'deleteApiBlock',
        sdk: 'blocks.delete',
        summary: '블록 지우기',
        note: '본문 블록은 되살릴 수 없다(버전 기록으로 되돌린다)',
      },
      { method: 'GET', path: '/v1/blocks/{block_id}/children', handler: 'retrieveBlockChildren', sdk: 'blocks.children.list', summary: '자식 블록 목록' },
      {
        method: 'PATCH',
        path: '/v1/blocks/{block_id}/children',
        handler: 'appendBlockChildren',
        sdk: 'blocks.children.append',
        summary: '자식 블록 붙이기',
        note: '`after` · `position` 을 받는다',
      },
    ],
  },
  {
    title: '데이터베이스',
    endpoints: [
      {
        method: 'POST',
        path: '/v1/databases',
        handler: 'createApiDatabase',
        sdk: 'databases.create',
        summary: '데이터베이스 만들기',
        note: '페이지 본문 안의 인라인 데이터베이스만',
      },
      { method: 'GET', path: '/v1/databases/{database_id}', handler: 'retrieveDatabase', sdk: 'databases.retrieve', summary: '데이터베이스 객체 · 데이터 소스 목록' },
      { method: 'PATCH', path: '/v1/databases/{database_id}', handler: 'updateApiDatabase', sdk: 'databases.update', summary: '이름 · 아이콘 · 잠금 · 휴지통' },
    ],
  },
  {
    title: '데이터 소스',
    endpoints: [
      { method: 'POST', path: '/v1/data_sources', handler: 'createApiDataSource', sdk: 'dataSources.create', summary: '데이터베이스에 데이터 소스 더하기' },
      { method: 'GET', path: '/v1/data_sources/{data_source_id}', handler: 'retrieveDataSource', sdk: 'dataSources.retrieve', summary: '데이터 소스 객체 · 속성(스키마)' },
      {
        method: 'PATCH',
        path: '/v1/data_sources/{data_source_id}',
        handler: 'updateApiDataSource',
        sdk: 'dataSources.update',
        summary: '이름 · 속성 고치기',
        note: '한 요청이 한 트랜잭션(하나라도 거부되면 아무것도 바뀌지 않는다)',
      },
      {
        method: 'POST',
        path: '/v1/data_sources/{data_source_id}/query',
        handler: 'queryDataSource',
        sdk: 'dataSources.query',
        summary: '행 질의 — 필터 · 정렬 · 커서',
        note: '한 질의가 넘겨 주는 행은 10,000개까지',
      },
    ],
  },
  {
    title: '검색',
    endpoints: [{ method: 'POST', path: '/v1/search', handler: 'searchApi', sdk: 'search', summary: '제목으로 페이지 · 데이터 소스 찾기', note: '본문은 찾지 않는다' }],
  },
  {
    title: '코멘트',
    endpoints: [
      { method: 'GET', path: '/v1/comments', handler: 'listApiComments', sdk: 'comments.list', summary: '페이지 · 블록의 열린 코멘트', note: '`block_id` 가 필요하다' },
      { method: 'POST', path: '/v1/comments', handler: 'createApiComment', sdk: 'comments.create', summary: '새 스레드 · 답글 달기' },
      { method: 'GET', path: '/v1/comments/{comment_id}', handler: 'retrieveApiComment', sdk: 'comments.retrieve', summary: '코멘트 하나' },
      { method: 'PATCH', path: '/v1/comments/{comment_id}', handler: 'updateApiComment', sdk: 'comments.update', summary: '코멘트 고치기', note: '쓴 사람만(남의 것은 403)' },
      { method: 'DELETE', path: '/v1/comments/{comment_id}', handler: 'deleteApiComment', sdk: 'comments.delete', summary: '코멘트 지우기', note: '쓴 사람만(남의 것은 403)' },
    ],
  },
  {
    title: '파일 올리기',
    endpoints: [
      {
        method: 'POST',
        path: '/v1/file_uploads',
        handler: 'createApiFileUpload',
        sdk: 'fileUploads.create',
        summary: '업로드 만들기',
        note: 'single_part 만 · 1시간 안에 보내고 붙인다',
      },
      {
        method: 'POST',
        path: '/v1/file_uploads/{file_upload_id}/send',
        handler: 'sendApiFileUpload',
        sdk: 'fileUploads.send',
        summary: '파일 보내기',
        note: 'multipart/form-data 의 file 하나 · 파일 하나 5MB',
      },
      {
        method: 'POST',
        path: '/v1/file_uploads/{file_upload_id}/complete',
        handler: 'completeApiFileUpload',
        sdk: 'fileUploads.complete',
        summary: '여러 조각 마감',
        note: '늘 400 — single_part 는 보내면 끝',
      },
      { method: 'GET', path: '/v1/file_uploads/{file_upload_id}', handler: 'retrieveApiFileUpload', sdk: 'fileUploads.retrieve', summary: '업로드 하나', note: '내 것만' },
      { method: 'GET', path: '/v1/file_uploads', handler: 'listApiFileUploads', sdk: 'fileUploads.list', summary: '내 업로드 목록', note: 'status 로 거른다' },
    ],
  },
]

/** 펼친 목록 — 표의 줄 수 · 시험이 쓴다. */
export const API_ENDPOINTS: readonly ApiEndpoint[] = API_ENDPOINT_GROUPS.flatMap((g) => g.endpoints)

/**
 * 라우트 파일의 자리(`src/app` 밑) → 문서의 주소. `v1/pages/[page_id]/route.ts` → `/v1/pages/{page_id}` · 모든 것을 받는 자리(`[...path]`)는
 * null(주소가 아니다 — 없는 주소를 400 으로 받는 그물이다).
 */
export function routeFileToPath(relative: string): string | null {
  const parts = relative.replace(/\\/g, '/').split('/')
  if (parts.at(-1) !== 'route.ts' || parts[0] !== 'v1') return null
  const segments = parts.slice(0, -1)
  if (segments.some((s) => s.startsWith('[...'))) return null
  return `/${segments.map((s) => (s.startsWith('[') && s.endsWith(']') ? `{${s.slice(1, -1)}}` : s)).join('/')}`
}

/**
 * 라우트 파일의 글에서 `export const GET = v1Route(retrievePage)` 들 — 선택을 준 것(`v1Route(sendApiFileUpload, { body: 'multipart' })`)도 ·
 * 받지 않는 메서드(`unknownUrl`)는 빠진다.
 */
export function routeHandlers(source: string): { readonly method: string; readonly handler: string }[] {
  return [...source.matchAll(/^export const (GET|POST|PATCH|PUT|DELETE) = v1Route\((\w+)(?:, \{[^}]*\})?\)/gm)]
    .map((m) => ({ method: m[1]!, handler: m[2]! }))
    .filter((r) => r.handler !== 'v1InvalidUrl')
}
