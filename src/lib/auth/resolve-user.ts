/**
 * 주소 → 계정 — `resolveUserByEmail` 한 곳 (AC-2 · F-14-07)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강 AC-0] ④ ⑤ (+ [AC-2])
 *
 * 공유 · 초대의 수신과 "주소로 사람 찾기"는 모두 이 함수를 부른다 — 워크스페이스 초대(이미 멤버인가 · `invite.ts`) · 게스트 초대(이메일로
 * 페이지 주기 · `guest.ts`) · 초대 수락(이 주소가 이 계정의 것인가) · 수락 화면 · 별칭 더하기(다른 계정의 주소인가 · `account-email.ts`).
 *
 *   · **검증된 별칭은 대표와 같다**(④) — 어느 주소로 찾든 그 계정이다. 결과는 늘 계정(user_id)이고, **어느 주소로 찾았는지는 돌려주지
 *     않는다** — 부르는 쪽이 별칭과 대표를 가를 수 없게(가르면 응답이 갈리고 별칭이 드러난다 · ⑤). 저장도 user_id 다 — 별칭을 빼도 지난
 *     공유 · 멤버십은 남는다.
 *   · `user_email` 에는 검증된 주소만 산다(① · CHECK) — 남이 걸어 둔 확인 대기(`otp_challenge`)는 아무것도 받지 못한다. 조건에도 적어 둔다.
 *   · 지운 사람은 찾지 않는다.
 *   · 대기 초대는 주소로 기다린다 — 받는 때는 **수락**이다(검증 때 고쳐 쓰지 않는다 · [AC-2]). 수락은 받는 사람 행을 먼저 잡고 이것을
 *     부른다(주소 더하기 · 빼기도 사람 행을 먼저 잡는다 — 같은 순서라 교착 없이 수락과 그 주소 빼기가 겹치지 않는다).
 *
 * 로그인(로그인 코드 · 비밀번호)은 이 함수를 지나지 않는다 — 인증의 입구는 쓸 수 없게 묶인 주소(멈춘 계정)까지 따로 보아야 한다
 * (`login-code.ts` · `password.ts` — 별칭 = 대표는 거기서 이미 그렇다).
 */

import { queryMaybe } from '../db/pool.ts'
import type { Tx } from '../db/tx.ts'

/** 해석의 결과 — 계정 하나. 찾은 주소가 별칭인지 대표인지는 싣지 않는다(머리말). */
export type ResolvedAccount = {
  readonly userId: string
}

const RESOLVE_SQL = `SELECT ue.user_id
       FROM user_email ue
       JOIN "user" u ON u.id = ue.user_id AND u.deleted_at IS NULL
      WHERE ue.email = $1 AND ue.verified_at IS NOT NULL`

/** 이 주소의 주인 — 검증된 어느 주소든(대표 · 별칭) 그 계정. 없으면 null. 비교는 citext 가 대소문자를 무시한다. `tx` 가 오면 그 안에서. */
export async function resolveUserByEmail(rawEmail: string, options: { readonly tx?: Tx } = {}): Promise<ResolvedAccount | null> {
  const email = rawEmail.trim()
  if (email.length === 0) return null
  const row =
    options.tx === undefined
      ? await queryMaybe<{ user_id: string }>(RESOLVE_SQL, [email])
      : await options.tx.queryMaybe<{ user_id: string }>(RESOLVE_SQL, [email])
  return row === null ? null : { userId: row.user_id }
}
