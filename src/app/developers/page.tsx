/**
 * /developers — 공개 API 개발자 문서 (API-6 · F-09-15)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ① ~ ⑩ · 09-api-integrations.md F-09-15(최초 성공까지의 경로)
 *
 * **로그인 없이 연다** — 워크스페이스의 내용이 없는 정적인 글이고, 토큰을 만들기 전(또는 동료에게서 토큰을 받은 사람)에도 읽어야 한다.
 * 그래서 `/w/` 밑(로그인 · 멤버십)이 아니라 앱의 맨 위에 둔다 · `/v1` · `/api` 는 기계의 주소라 피한다(노션의 developers.notion.com 자리).
 * 서버 컴포넌트뿐이다(브라우저 JS 를 더하지 않는다). 주소 표는 `lib/api/endpoints.ts` 하나에서 그린다 — 시험이 라우트 파일과 견준다.
 * 숫자 · 오류 코드 · 노션과 다른 점은 `lib/api/developer-docs.ts`. 예제의 주소는 이 앱의 출처다(`docsOrigin`).
 */

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import type { ReactNode } from 'react'

import {
  curlSample,
  DIFFERENCES,
  docsOrigin,
  ERROR_CODES,
  ERROR_SAMPLE,
  expiryChoices,
  LIMITS,
  ME_SAMPLE,
  NOTION_VERSION,
  PAGINATION_SAMPLE,
  SDK_ERROR_SAMPLE,
  sdkSample,
} from '@/lib/api/developer-docs'
import { API_ENDPOINT_GROUPS, API_ENDPOINTS } from '@/lib/api/endpoints'
import { SCREEN_TITLES } from '@/lib/nav/screen-title'

export const metadata: Metadata = { title: SCREEN_TITLES.developers }

const SECTIONS = [
  { id: 'quickstart', title: '빠른 시작' },
  { id: 'auth', title: '인증과 토큰' },
  { id: 'version', title: '판(Notion-Version)' },
  { id: 'errors', title: '오류' },
  { id: 'limits', title: '제한' },
  { id: 'pagination', title: '쪽 넘기기' },
  { id: 'endpoints', title: '주소' },
  { id: 'sdk', title: '공식 SDK' },
  { id: 'differences', title: '노션과 다른 점' },
] as const

const MUTED = 'text-[var(--foreground-muted)]'
const RULE = 'border-[var(--divider-color)]'

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-[var(--inline-code-bg)] px-1 py-0.5 font-mono text-[0.85em] text-[var(--inline-code-color)]">{children}</code>
}

function Block({ children, label }: { children: string; label: string }) {
  return (
    <pre aria-label={label} className="mt-3 overflow-x-auto rounded-md bg-[var(--code-block-bg)] p-4 font-mono text-xs leading-5">
      <code>{children}</code>
    </pre>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} data-testid={`developer-docs-${id}`} className={`scroll-mt-6 border-t pt-8 ${RULE}`}>
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-3 text-sm leading-6">{children}</div>
    </section>
  )
}

const TH = `border-b ${RULE} py-2 pr-3 text-left text-xs font-medium ${MUTED}`
const TD = `border-b ${RULE} py-2 pr-3 align-top`

export default async function DevelopersPage() {
  const h = await headers()
  const origin = docsOrigin({
    configured: process.env.NEXT_PUBLIC_APP_URL,
    host: h.get('host'),
    forwardedHost: h.get('x-forwarded-host'),
    forwardedProto: h.get('x-forwarded-proto'),
  })

  return (
    <main data-testid="developer-docs" className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">API 문서</h1>
        <p className="text-sm leading-6">
          스크립트 · 도구가 이 워크스페이스를 읽고 씁니다. 모양은 노션 API <Code>{NOTION_VERSION}</Code>(데이터 소스 판)과 같아서 노션의 공식 SDK 를
          주소만 바꿔 그대로 씁니다. 주소는 <Code>{origin}/v1/…</Code> 입니다.
        </p>
        <nav aria-label="목차" className={`flex flex-wrap gap-x-3 gap-y-1 text-xs ${MUTED}`}>
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="underline-offset-2 hover:underline">
              {s.title}
            </a>
          ))}
        </nav>
      </header>

      <Section id="quickstart" title="빠른 시작">
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          <li>
            앱에서 <strong>설정 → 내 계정 → API 토큰</strong>으로 가서 토큰을 만듭니다. 값(<Code>ntn_</Code>으로 시작)은 만들 때 한 번만 보이니 바로
            복사해 둡니다.
          </li>
          <li>
            <Code>Authorization: Bearer</Code> 머리에 토큰을, <Code>Notion-Version</Code> 머리에 <Code>{NOTION_VERSION}</Code>을 실어 부릅니다.
            <Block label="curl 예제">{curlSample(origin)}</Block>
          </li>
          <li>
            토큰을 만든 사람의 사용자 객체가 오면 준비가 끝났습니다.
            <Block label="응답 예">{ME_SAMPLE}</Block>
          </li>
        </ol>
      </Section>

      <Section id="auth" title="인증과 토큰">
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          <li>
            토큰은 <strong>한 워크스페이스에 묶이고 만든 사람의 권한 그대로</strong> 움직입니다 — 그 사람이 볼 수 있는 것만 보고, 고칠 수 있는 것만
            고칩니다.
          </li>
          <li>멤버 이상만 만듭니다(게스트는 만들 수 없습니다). 게스트로 바뀌거나 멈춘 · 지운 계정의 토큰은 더 듣지 않습니다.</li>
          <li>만료는 만들 때 고릅니다: {expiryChoices()}.</li>
          <li>
            <strong>SSO 를 강제한 워크스페이스에서는 소유자의 토큰만</strong> 듣습니다(토큰은 SSO 를 거치지 않습니다).
          </li>
          <li>설정에서 폐기하면 곧바로 401 이 됩니다. 저장은 해시만 하므로 잃어버린 값은 되찾을 수 없습니다 — 새로 만드세요.</li>
          <li>비밀번호 · 2단계 인증 · 세션 · 토큰 · 멤버 · 요금제 관리는 토큰으로 하지 않습니다. 쿠키는 보지 않습니다(토큰만).</li>
        </ul>
      </Section>

      <Section id="version" title="판(Notion-Version)">
        <p>
          받는 판은 <Code>{NOTION_VERSION}</Code> 하나입니다. 머리가 없으면 400 <Code>missing_version</Code>, 다른 날짜면 400{' '}
          <Code>invalid_request</Code>입니다. 데이터베이스와 데이터 소스가 나뉜 판이라 행은 <Code>data_source_id</Code> 밑에 있습니다.
        </p>
      </Section>

      <Section id="errors" title="오류">
        <p>
          모든 오류는 노션의 모양입니다. <Code>message</Code>는 노션처럼 영어이고, 문의할 때는 <Code>request_id</Code>(응답 머리{' '}
          <Code>x-request-id</Code>와 같다)를 알려 주세요.
        </p>
        <Block label="오류 예">{ERROR_SAMPLE}</Block>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={TH}>상태</th>
                <th className={TH}>code</th>
                <th className={TH}>언제</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(ERROR_CODES).map(([code, e]) => (
                <tr key={code} data-testid="api-error-row">
                  <td className={`${TD} font-mono text-xs`}>{e.status}</td>
                  <td className={`${TD} font-mono text-xs`}>{code}</td>
                  <td className={TD}>{e.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="limits" title="제한">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {LIMITS.map((l) => (
                <tr key={l.name}>
                  <th scope="row" className={`${TD} whitespace-nowrap text-left font-medium`}>
                    {l.name}
                  </th>
                  <td className={`${TD} whitespace-nowrap`}>{l.value}</td>
                  <td className={`${TD} ${MUTED}`}>{l.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="pagination" title="쪽 넘기기">
        <p>
          목록은 <Code>has_more</Code> · <Code>next_cursor</Code>를 줍니다. 다음 쪽은 받은 커서를 <Code>start_cursor</Code>로 보냅니다 — GET 은 주소의
          매개변수로, POST(질의 · 검색)는 본문으로. 질의 · 검색 · 코멘트 · 사용자의 커서는 그 요청에 묶여 있어 필터 · 정렬 · 대상이 다른 요청에
          쓰면 400 입니다. 공식 SDK 의{' '}
          <Code>iteratePaginatedAPI</Code> · <Code>collectPaginatedAPI</Code>가 그대로 동작합니다.
        </p>
        <Block label="목록 응답 예">{PAGINATION_SAMPLE}</Block>
      </Section>

      <Section id="endpoints" title="주소">
        <p className={MUTED}>
          {API_ENDPOINTS.length}개. 경로의 id 는 대시가 있든 없든 받습니다. 표에 없는 주소 · 메서드는 400 <Code>invalid_request_url</Code>입니다.
        </p>
        {API_ENDPOINT_GROUPS.map((group) => (
          <div key={group.title} className="overflow-x-auto">
            <h3 className="mt-2 text-sm font-semibold">{group.title}</h3>
            <table className="mt-1 w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={`${TH} w-16`}>메서드</th>
                  <th className={TH}>주소</th>
                  <th className={TH}>하는 일</th>
                  <th className={TH}>SDK</th>
                </tr>
              </thead>
              <tbody>
                {group.endpoints.map((e) => (
                  <tr key={`${e.method} ${e.path}`} data-testid="api-endpoint-row" data-method={e.method} data-path={e.path}>
                    <td className={`${TD} font-mono text-xs font-medium`}>{e.method}</td>
                    <td className={`${TD} break-all font-mono text-xs`}>{e.path}</td>
                    <td className={TD}>
                      {e.summary}
                      {e.note !== undefined && <span className={`block text-xs ${MUTED}`}>{e.note}</span>}
                    </td>
                    <td className={`${TD} whitespace-nowrap font-mono text-xs ${MUTED}`}>{e.sdk}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Section>

      <Section id="sdk" title="공식 SDK">
        <p>
          노션의 공식 JavaScript SDK(<Code>@notionhq/client</Code> 5 판)를 그대로 씁니다. <Code>baseUrl</Code>을 이 앱의 주소로, <Code>notionVersion</Code>을{' '}
          <Code>{NOTION_VERSION}</Code>로 줍니다. 429 를 받으면 SDK 가 <Code>Retry-After</Code>만큼 기다렸다 다시 보냅니다.
        </p>
        <Block label="SDK 예제">{sdkSample(origin)}</Block>
        <p>오류는 노션과 같은 코드로 갈라 씁니다.</p>
        <Block label="SDK 오류 처리 예제">{SDK_ERROR_SAMPLE}</Block>
      </Section>

      <Section id="differences" title="노션과 다른 점">
        <p className={MUTED}>대부분 노션과 같게 움직입니다. 앱의 규칙을 따르느라 달라진 것만 적습니다.</p>
        {DIFFERENCES.map((group) => (
          <div key={group.title}>
            <h3 className="text-sm font-semibold">{group.title}</h3>
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
              {group.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </Section>
    </main>
  )
}
