/**
 * 공개 화면의 신고 — 사유 · 실패 문구 (게시 · 공유 6b-1b · F-17-08 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 공개 페이지 신고 ⑧
 *       17-ops-governance.md F-17-08 — 사유 넷(`Phishing or spam` / `Inappropriate content` / `DMCA takedown request` / `Other`)
 */

import type { ReportReason } from '@/lib/moderation/report'

/** 사유 넷 — 화면의 순서. */
export const REPORT_REASON_OPTIONS: readonly { readonly value: ReportReason; readonly label: string; readonly hint: string }[] = [
  { value: 'phishing_spam', label: '피싱 · 스팸', hint: '로그인 정보를 노리거나 원치 않는 광고를 퍼뜨립니다.' },
  { value: 'inappropriate', label: '부적절한 내용', hint: '폭력 · 혐오 · 괴롭힘 · 불법 콘텐츠 등.' },
  { value: 'dmca', label: '저작권 침해(DMCA)', hint: '저작권자이거나 그 대리인입니다.' },
  { value: 'other', label: '기타', hint: '위에 없는 문제입니다.' },
]

/** DMCA 를 고른 사람에게 — 신고는 받되 공식 통지 절차가 따로 있다(17 *"별도 DMCA 정책 페이지의 공식 통지 절차로 안내"*). */
export const DMCA_NOTE =
  '저작권 침해 신고는 이 신고와 함께 운영자의 공식 저작권 통지 절차가 필요합니다. 접수 뒤 운영자가 그 절차를 안내합니다.'

const FAILURE: Readonly<Record<string, string>> = {
  invalid_reason: '신고 사유를 하나 고르세요.',
  detail_too_long: '설명은 2000자까지 쓸 수 있습니다.',
  rate_limited: '신고가 너무 잦습니다. 잠시 뒤에 다시 시도하세요.',
  bad_origin: '이 화면에서 보낸 신고만 받습니다.',
}

/** 실패 까닭을 사람의 말로 — 자기 칸만 읽는다(`'constructor'` 같은 값이 원형의 함수를 꺼내지 않게). */
export function reportFailureMessage(reason: unknown): string | null {
  return typeof reason === 'string' && Object.hasOwn(FAILURE, reason) ? FAILURE[reason]! : null
}
