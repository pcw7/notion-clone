/**
 * AI 의 문구 — 설정 → 워크스페이스 → AI · 한도 거부 (AI-1 · F-10-12 · DOM · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ① ③ ⑤
 *
 * 값(쓴 양 · 한도 · 풀리는 시각)은 서버가 준다(`aiQuotaView`). 시각은 **UTC 로** 적는다 — 하루 · 달의 경계가 UTC 이고, 서버와 브라우저가
 * 같은 글을 그린다(시간대가 달라 하이드레이션이 어긋나지 않는다).
 */

import type { AiLimitKind, AiQuotaView } from '@/lib/ai/quota'

export const AI_UNAVAILABLE = '운영자가 AI 를 설정하지 않았습니다.'
export const AI_DISABLED = '워크스페이스 소유자가 AI 를 켜야 합니다.'
export const AI_ENABLED = '이 워크스페이스에서 AI 가 켜져 있습니다.'
export const AI_OWNER_ONLY = '워크스페이스 소유자만 켜고 끌 수 있습니다.'
export const AI_SWITCH_LABEL = '이 워크스페이스에서 AI 쓰기'

/** 켤 때 보이는 알림(정본 ⑤) — 글이 어디로 가는가 · 무료 등급의 정책. */
export function aiDisclosure(host: string): string {
  return `AI 를 쓰면 그 요청에 담긴 페이지의 글이 외부 AI 서비스(${host})로 보내집니다. 무료 등급은 그 서비스의 정책(학습 · 보관)을 따릅니다.`
}

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO 시각 → "12월 1일 00:00 (UTC)". 읽을 수 없으면 원문. */
export function formatUtc(iso: string): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return iso
  return `${t.getUTCMonth() + 1}월 ${t.getUTCDate()}일 ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())} (UTC)`
}

const times = (n: number) => `${n.toLocaleString('ko-KR')}회`

export type AiUsageLine = { readonly key: 'window' | 'month' | 'trial' | 'grants' | 'none'; readonly text: string }

/** 쓴 양의 줄들 — 창 · 달 · 체험 · 보충(있는 것만). 요금제에 몫이 없고 보충도 없으면 그렇다고 한 줄. */
export function aiUsageLines(view: AiQuotaView): AiUsageLine[] {
  const lines: AiUsageLine[] = []
  if (view.window !== null) {
    const w = view.window
    if (w.limit === null) lines.push({ key: 'window', text: `지난 6시간 ${times(w.used)} (제한 없음)` })
    else {
      const full = w.used >= w.limit && w.resetsAt !== null
      lines.push({ key: 'window', text: `지난 6시간 ${w.used.toLocaleString('ko-KR')} / ${times(w.limit)}${full ? ` · ${formatUtc(w.resetsAt!)}부터 다시 쓸 수 있습니다` : ''}` })
    }
  }
  if (view.month !== null) {
    const m = view.month
    lines.push({
      key: 'month',
      text: m.limit === null ? `이번 달 ${times(m.used)} (무제한)` : `이번 달 ${m.used.toLocaleString('ko-KR')} / ${times(m.limit)} · ${formatUtc(m.resetsAt)}에 새로 채워집니다`,
    })
  }
  if (view.trial !== null) {
    const t = view.trial
    lines.push({ key: 'trial', text: t.limit === null ? `체험 ${times(t.used)}` : `체험 ${t.used.toLocaleString('ko-KR')} / ${times(t.limit)} (다시 채워지지 않습니다)` })
  }
  if (view.grantsLeft > 0) {
    lines.push({ key: 'grants', text: `운영자 보충 ${times(view.grantsLeft)} 남음${view.grantsExpireAt === null ? '' : ` · 가장 이른 만료 ${formatUtc(view.grantsExpireAt)}`}` })
  } else if (view.kind === 'none') {
    lines.push({ key: 'none', text: '이 요금제에는 AI 응답이 없습니다. 운영자에게 보충을 요청하세요.' })
  }
  return lines
}

/** 한도 거부(`ai_limit_reached`)의 말 — 어느 한도 · 언제 풀리는지. 체험은 다시 차지 않는다. */
export function aiLimitMessage(limit: AiLimitKind | string, resetsAt: string | null): string {
  const when = resetsAt === null ? '' : ` ${formatUtc(resetsAt)}부터 다시 쓸 수 있습니다.`
  switch (limit) {
    case 'daily':
      return `오늘 이 앱의 AI 사용량이 모두 찼습니다.${when}`
    case 'window':
      return `6시간 한도에 닿았습니다.${when}`
    case 'month':
      return `이번 달 한도에 닿았습니다.${when}`
    case 'trial':
      return '체험 응답을 모두 썼습니다. 운영자에게 보충을 요청하세요.'
  }
  return `AI 한도에 닿았습니다.${when}`
}

/** 공급자가 잠시 막았다(`ai_busy` — 무료 등급의 요청 수 · 분당 토큰). 우리 한도가 아니고 셈에도 들지 않는다. */
export function aiBusyMessage(retryAfter: number | null): string {
  return `AI 서비스가 잠시 바쁩니다 — ${retryAfter === null ? '잠시' : `${retryAfter}초`} 뒤 다시 시도하세요.`
}

/** 스위치 저장의 거부. */
export function aiSwitchFailureMessage(reason: unknown): string {
  if (reason === 'forbidden') return AI_OWNER_ONLY
  return '저장하지 못했습니다.'
}
