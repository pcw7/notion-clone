/**
 * 공개 API `/v1` 의 주소 목록 — 개발자 문서의 표가 이것을 그린다 (API-6 · F-09-15 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ~ ⑭ · 09-api-integrations.md F-09-15 *"단일 소스로 두면 드리프트가 사라진다"*
 *
 * `endpoints.test.ts` 가 `src/app/v1/**\/route.ts` 를 읽어 **메서드 · 주소 · 핸들러 이름**이 이 목록과 하나도 다르지 않은지 본다 — 라우트를
 * 더하거나 빼면 여기도 고쳐야 CI 가 지난다. 받지 않는 메서드(`v1InvalidUrl` — 400 `invalid_request_url`)는 싣지 않는다.
 * 글은 화면에 그대로 나간다(한국어 · 짧게). 노션과 다른 점의 자세한 것은 `developer-docs.ts` 의 "노션과 다른 점".
 *
 * **SDK 대조(API-10 · ⑭ ②)** — 공식 SDK 의 메서드는 모두 이 목록(`API_ENDPOINTS`)이나 받지 않는 목록(`API_UNSUPPORTED`)에 있다. 시험이 SDK 의
 * `Client` 를 걸어 메서드마다 실제로 보내는 메서드 · 주소를 잡아 견준다(SDK 를 올리면 새 메서드가 시험을 깬다). 받지 않는 주소는
 * `v1InvalidUrl` 이 이 표를 읽어 400 `validation_error` 로 까닭을 말한다(라우트 파일의 받지 않는 메서드든 그물이든).
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
        method: 'POST',
        path: '/v1/pages/{page_id}/move',
        handler: 'moveApiPage',
        sdk: 'pages.move',
        summary: '다른 페이지 밑으로 옮기기',
        note: '맨 뒤에 붙는다 · 데이터베이스 행 · 데이터 소스 · 워크스페이스 최상위는 400',
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
      {
        method: 'GET',
        path: '/v1/data_sources/{data_source_id}/templates',
        handler: 'listApiTemplates',
        sdk: 'dataSources.listTemplates',
        summary: '템플릿 목록',
        note: '`is_default` 는 그 데이터베이스의 공유 뷰가 기본으로 둔 것',
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
  {
    title: '사용자 지정 이모지',
    endpoints: [
      {
        method: 'GET',
        path: '/v1/custom_emojis',
        handler: 'listApiCustomEmojis',
        sdk: 'customEmojis.list',
        summary: '워크스페이스의 이모지 목록',
        note: '이름 순 · `name` 은 정확히 같은 이름',
      },
    ],
  },
]

/** 펼친 목록 — 표의 줄 수 · 시험이 쓴다. */
export const API_ENDPOINTS: readonly ApiEndpoint[] = API_ENDPOINT_GROUPS.flatMap((g) => g.endpoints)

// ── SDK 에 있지만 받지 않는 주소 (API-10 · ⑭ ②) ─────────────────────────

/** 받지 않는 까닭의 묶음 — 화면의 표와 오류 글이 같은 것을 말한다. */
export type UnsupportedFamily = 'markdown' | 'meeting_notes' | 'views' | 'async_tasks' | 'agents' | 'oauth'

export const UNSUPPORTED_FAMILIES: Readonly<
  Record<UnsupportedFamily, { readonly title: string; readonly reason: string; readonly message: string; readonly applicable: boolean }>
> = {
  markdown: {
    title: '페이지 마크다운',
    reason: '노션의 "enhanced markdown" 판이다 — 본문은 블록 API(blocks.children)로 읽고 쓴다',
    message: 'read and write page content with the blocks API (blocks.children.list / blocks.children.append).',
    applicable: true,
  },
  meeting_notes: {
    title: '회의록',
    reason: '앱에 회의록(AI 회의 노트) 블록이 없다',
    message: 'the app has no meeting notes block.',
    applicable: true,
  },
  views: {
    title: '뷰',
    reason: '뷰는 앱의 화면에서 만들고 고친다 — 행은 데이터 소스 질의로 읽는다',
    message: 'create and edit views in the app; read rows with POST /v1/data_sources/{data_source_id}/query.',
    applicable: true,
  },
  async_tasks: {
    title: '비동기 작업',
    reason: '모든 쓰기는 응답 전에 끝난다 — 기다릴 작업이 없다',
    message: 'every write finishes before the response, so there are no async tasks.',
    applicable: true,
  },
  agents: {
    title: '노션 AI 에이전트',
    reason: '노션 AI 의 에이전트 · 세션 · 플러그인 · 스킬이다 — 앱의 AI 는 화면에서만 쓴다',
    message: 'Notion AI agents, sessions, plugins and skills are not available in this app.',
    applicable: true,
  },
  oauth: {
    title: 'OAuth',
    reason: '해당 없음 — 공개 통합(OAuth 앱)이 없다. 개인 토큰을 설정에서 만든다',
    message: 'there are no public integrations. Create a personal API token in Settings → My account → API tokens.',
    applicable: false,
  },
}

export type UnsupportedEndpoint = {
  readonly method: ApiMethod
  readonly path: string
  readonly sdk: string
  readonly family: UnsupportedFamily
}

const unsupported = (family: UnsupportedFamily, rows: readonly (readonly [ApiMethod, string, string])[]): UnsupportedEndpoint[] =>
  rows.map(([method, path, sdk]) => ({ method, path, sdk, family }))

/** SDK 5 판의 메서드 중 받지 않는 것 — 차례는 SDK 의 묶음. 같은 주소의 두 메서드(`sessions.update` · `stream`)는 앞의 것이 답한다. */
export const API_UNSUPPORTED: readonly UnsupportedEndpoint[] = [
  ...unsupported('markdown', [
    ['GET', '/v1/pages/{page_id}/markdown', 'pages.retrieveMarkdown'],
    ['PATCH', '/v1/pages/{page_id}/markdown', 'pages.updateMarkdown'],
  ]),
  ...unsupported('meeting_notes', [
    ['POST', '/v1/blocks/meeting_notes', 'blocks.meetingNotes.create'],
    ['POST', '/v1/blocks/meeting_notes/query', 'blocks.meetingNotes.query'],
  ]),
  ...unsupported('views', [
    ['GET', '/v1/views', 'views.list'],
    ['POST', '/v1/views', 'views.create'],
    ['GET', '/v1/views/{view_id}', 'views.retrieve'],
    ['PATCH', '/v1/views/{view_id}', 'views.update'],
    ['DELETE', '/v1/views/{view_id}', 'views.delete'],
    ['POST', '/v1/views/{view_id}/queries', 'views.queries.create'],
    ['GET', '/v1/views/{view_id}/queries/{query_id}', 'views.queries.results'],
    ['DELETE', '/v1/views/{view_id}/queries/{query_id}', 'views.queries.delete'],
  ]),
  ...unsupported('async_tasks', [['GET', '/v1/async_tasks/{task_id}', 'asyncTasks.retrieve']]),
  ...unsupported('agents', [
    ['POST', '/v1/agents/query', 'agents.query'],
    ['POST', '/v1/agents/batch', 'agents.batch'],
    ['GET', '/v1/agents/{agent_id}', 'agents.retrieve'],
    ['DELETE', '/v1/agents/{agent_id}', 'agents.delete'],
    ['GET', '/v1/agents/{agent_id}/insights', 'agents.retrieveInsights'],
    ['PATCH', '/v1/agents/{agent_id}/status', 'agents.updateStatus'],
    ['PATCH', '/v1/agents/{agent_id}/credit_limit', 'agents.updateCreditLimit'],
    ['POST', '/v1/sessions', 'sessions.update'],
    ['POST', '/v1/sessions', 'sessions.stream'],
    ['POST', '/v1/sessions/query', 'sessions.query'],
    ['GET', '/v1/sessions/{session_id}', 'sessions.retrieve'],
    ['POST', '/v1/sessions/{session_id}/cancel', 'sessions.cancel'],
    ['POST', '/v1/sessions/{session_id}/events/query', 'sessions.queryEvents'],
    ['GET', '/v1/ai/plugins', 'plugins.list'],
    ['GET', '/v1/ai/plugins/{id}', 'plugins.retrieve'],
    ['GET', '/v1/ai/skills/{id}', 'skills.retrieve'],
  ]),
  ...unsupported('oauth', [
    ['POST', '/v1/oauth/token', 'oauth.token'],
    ['POST', '/v1/oauth/introspect', 'oauth.introspect'],
    ['POST', '/v1/oauth/revoke', 'oauth.revoke'],
  ]),
]

/** 주소 틀 → 정규식 — `{이름}` 은 한 마디. */
const patternOf = (path: string): RegExp =>
  new RegExp(`^${path.split('/').map((s) => (s.startsWith('{') ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')}$`)

/** 요청이 받지 않는 SDK 주소인가 — 끝의 `/` 는 뗀다. 아니면 null(그냥 없는 주소다). */
export function unsupportedEndpoint(method: string, pathname: string): UnsupportedEndpoint | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  const m = method.toUpperCase()
  return API_UNSUPPORTED.find((e) => e.method === m && patternOf(e.path).test(path)) ?? null
}

/** 받지 않는 주소의 오류 글 — 노션의 말투(영어) · SDK 메서드와 까닭. */
export function unsupportedMessage(e: UnsupportedEndpoint): string {
  return `${e.sdk} (${e.method} ${e.path}) is not supported by this server: ${UNSUPPORTED_FAMILIES[e.family].message}`
}

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
