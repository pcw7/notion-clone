/**
 * AI 채팅 화면 — `/w/{workspaceId}/ai` (AI-6 · F-10-17 · F-10-22)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑪ — **따로인 화면**이다(페이지 화면의 첫 JS 에 들지 않는다). 사이드바의 "AI" ·
 * Ctrl/Cmd+Shift+J · 페이지 "···" 의 "AI 와 이 페이지 대화"(`?page=<id>` — 범위를 그 페이지로) 가 여기로 온다. `?s=<id>` 는 연 대화.
 *
 * 첫 목록 · 연 대화 · 범위 페이지의 제목 · 내 AI 지시의 상태 · 모델 고르개(AI-7)는 서버가 읽어서 준다(모두 그 사람의 것 · 볼 수 있는 것만). 게스트는 AI 를
 * 쓰지 않으므로 까닭만 보인다. 꺼짐 · 공급자 없음이면 지난 대화는 읽을 수 있고 입력은 닫힌다(소유자에게는 설정 → AI 링크).
 *
 * 진입 게이트가 레이아웃과 여기 양쪽에서 돈다(레이아웃 머리말의 규칙).
 */

import type { Metadata } from 'next'

import { AI_ASK_FORBIDDEN } from '@/lib/ai/ask-client'
import { aiInstructionsViewFor, chatScopePageOf, getChatSession, listChatSessions } from '@/lib/ai/chat-store'
import { WORKSPACE_SCOPE, type ChatScope } from '@/lib/ai/chat-shared'
import { readAiConfig } from '@/lib/ai/config'
import { aiModelChoicesFor } from '@/lib/ai/model-setting'
import { aiEntryFor } from '@/lib/ai/usage'
import { requirePageSession } from '@/lib/auth/page-session'
import { SCREEN_TITLES } from '@/lib/nav/screen-title'
import { ChatView } from './chat-view'

export const metadata: Metadata = { title: SCREEN_TITLES.ai }

const one = (v: string | string[] | undefined): string | null => (typeof v === 'string' && v !== '' ? v : null)

export default async function AiChatPage({ params, searchParams }: PageProps<'/w/[workspaceId]/ai'>) {
  const { workspaceId } = await params
  const query = await searchParams
  const ctx = await requirePageSession(workspaceId)
  const config = readAiConfig()
  const entry = await aiEntryFor(ctx, config)

  if (entry.state === 'forbidden') {
    return (
      <main data-testid="ai-chat-forbidden" className="mx-auto flex min-h-screen max-w-xl flex-col gap-3 px-6 py-12">
        <h1 className="text-2xl font-semibold">AI</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{AI_ASK_FORBIDDEN}</p>
      </main>
    )
  }

  const sessionParam = one(query.s)
  const pageParam = one(query.page)
  const [sessions, opened, scopePage, instructions, models] = await Promise.all([
    listChatSessions(ctx),
    sessionParam === null ? null : getChatSession(ctx, sessionParam),
    pageParam === null ? null : chatScopePageOf(ctx, pageParam),
    aiInstructionsViewFor(ctx),
    // 모델 고르개(AI-7) — 자동(워크스페이스 기본) + 쓸 수 있는 모델. 판정은 한 턴의 게이트가 다시 한다
    aiModelChoicesFor(ctx, config),
  ])

  // 범위 — `?page=` 가 이긴다 · 아니면 연 대화의 범위(그 페이지를 지금 볼 수 있을 때) · 아니면 워크스페이스 전체
  let scope: ChatScope = WORKSPACE_SCOPE
  let scopeTitle: string | null = null
  if (scopePage !== null) {
    scope = { kind: 'page', pageId: scopePage.id }
    scopeTitle = scopePage.title
  } else if (opened !== null && opened.scope.kind === 'page' && opened.scopeTitle !== null) {
    scope = opened.scope
    scopeTitle = opened.scopeTitle
  }

  return (
    <ChatView
      // 연 대화 · 범위가 바뀌면 화면 상태를 새로 시작한다(같은 화면 안의 이동)
      key={`${opened?.id ?? 'new'}:${scope.kind === 'page' ? scope.pageId : ''}`}
      workspaceId={workspaceId}
      entry={{ state: entry.state, canManage: entry.canManage }}
      initialSessions={sessions}
      opened={opened}
      initialScope={scope}
      initialScopeTitle={scopeTitle}
      instructions={{ title: instructions?.title ?? null, state: instructions?.state ?? 'none' }}
      models={models}
    />
  )
}
