/**
 * GET · POST /api/account/deletion — 계정 삭제 (AD-2 · F-14-13)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 AD-2] ⑤ — 로그인한 사람 자신만, 워크스페이스와 무관한 계정 경로다
 * (`SessionContext` 가 아니라 로그인 세션으로 묻는 계정 명령).
 *
 *   GET   미리보기 — `{ email, workspaces: [{ id, name, outcome, reason?, teamspaces? }] }`
 *   POST  `{ confirmEmail }` — 400 email_mismatch · 409 blocked(+ 미리보기) · 성공이면 세션 쿠키를 지우고 `{ ok: true }`
 */

import { deleteAccount, previewAccountDeletion } from '@/lib/auth/account-deletion'
import { applyAccountsPlan, readAccounts } from '@/lib/auth/accounts-cookie'
import { planLogout } from '@/lib/auth/account-set'
import { getCurrentUser } from '@/lib/auth/current-user'

const unauthenticated = () => Response.json({ error: 'unauthenticated' }, { status: 401 })

export async function GET(): Promise<Response> {
  const user = await getCurrentUser()
  if (user === null) return unauthenticated()
  const preview = await previewAccountDeletion(user.userId)
  if (preview === null) return unauthenticated()
  return Response.json(preview)
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser()
  if (user === null) return unauthenticated()
  let body: { confirmEmail?: unknown } = {}
  try {
    body = ((await request.json()) ?? {}) as typeof body
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const result = await deleteAccount(user.userId, { confirmEmail: body.confirmEmail })
  if (!result.ok) {
    if (result.reason === 'blocked') return Response.json({ error: 'blocked', ...result.preview }, { status: 409 })
    if (result.reason === 'email_mismatch') return Response.json({ error: 'email_mismatch' }, { status: 400 })
    return unauthenticated()
  }

  // 세션은 이미 폐기됐다 — 쿠키를 정리한다(함께 로그인한 다른 계정이 있으면 그쪽이 지금 계정이 된다)
  const accounts = await readAccounts()
  const plan = planLogout({ active: accounts.active, others: accounts.others, scope: { kind: 'current' } })
  await applyAccountsPlan(plan, accounts, 'account_deleted')
  return Response.json({ ok: true, signedIn: plan.active !== null })
}
