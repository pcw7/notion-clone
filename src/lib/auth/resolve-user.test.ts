/**
 * 별칭의 울타리 — 소스를 훑는다 (AC-2 · F-14-07 · 정본 §3.2 [보강 AC-0] ④ ⑤ [AC-2])
 *
 *   · **주소 → 사람은 `resolveUserByEmail` 한 곳** — `user_email` 에서 사람을 찾는 읽기는 해석기와 자기 주소의 자리(설정의 이메일 · 로그인 ·
 *     계정 지우기)뿐이다. 다른 자리가 주소로 사람을 직접 찾으면 별칭을 대표와 다르게 다루게 된다(전에 수락 화면이 대표만 견주었다).
 *   · **다른 사람에게는 대표만** — 사람의 주소를 싣는 조인은 대표 행으로만(`primary_email_id` · `is_primary`). `user_id` 로만 조인하면 그 사람의
 *     별칭이 모두 따라 나온다.
 *
 * DB 시험(`alias-resolution.db.test.ts`)이 실제 화면의 읽기를 보고, 이 시험은 그 목록 밖에 새 자리가 생기는 것을 막는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../../', import.meta.url))

/** `user_email` 을 사람 쪽에서 읽어도 되는 자리 — 까닭과 함께. 늘리려면 정본 [AC-2] 를 먼저 고친다. */
const OWN_ADDRESS_FILES: Readonly<Record<string, string>> = {
  'lib/auth/resolve-user.ts': '해석기 — 주소 → 계정의 한 곳',
  'lib/auth/account-email.ts': '자기 주소 목록 · 개수 · 대표로 · 빼기(설정의 이메일)',
  'lib/auth/login-code.ts': '로그인 코드 — 인증의 입구는 쓸 수 없게 묶인 주소까지 본다',
  'lib/auth/password.ts': '비밀번호 로그인 — 인증의 입구',
  'lib/auth/account-deletion.ts': '계정 지우기 — 자기 주소를 지운다',
}

const toKey = (file: string) => relative(SRC, file).split(sep).join('/')

let cached: string[] | null = null
function sources(): string[] {
  cached ??= (readdirSync(SRC, { recursive: true }) as string[])
    .map((entry) => join(SRC, entry))
    .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file))
    .filter((file) => !toKey(file).startsWith('lib/testing/'))
  return cached
}

type Hit = { readonly file: string; readonly line: number; readonly text: string }

function userEmailReads(): Hit[] {
  const hits: Hit[] = []
  for (const file of sources()) {
    const body = readFileSync(file, 'utf8')
    for (const match of body.matchAll(/\b(FROM|JOIN)\s+user_email\b[\s\S]{0,140}/g)) {
      const line = body.slice(0, match.index).split('\n').length
      hits.push({ file: toKey(file), line, text: match[0] })
    }
  }
  return hits
}

test('★ user_email 을 읽는 자리는 대표 행 조인 아니면 자기 주소의 자리뿐이다(별칭이 남에게 새지 않게 · 해석은 한 곳)', () => {
  // 대표 행 조인 — 그 줄의 ON 이 대표를 가리킨다(여러 줄의 ON 은 보수적으로 막는다 — 한 줄로 쓴다)
  const primaryJoin = (hit: Hit) => hit.text.startsWith('JOIN') && /\bON\b.*\b(primary_email_id|is_primary)\b/.test(hit.text.split('\n')[0] ?? '')
  const offenders = userEmailReads()
    .filter((hit) => !(hit.file in OWN_ADDRESS_FILES) && !primaryJoin(hit))
    .map((hit) => `${hit.file}:${hit.line}  ${hit.text.split('\n')[0]}`)
  assert.deepEqual(offenders, [], '주소로 사람을 찾으면 resolveUserByEmail 을 · 사람의 주소를 실으면 대표 행으로만 조인한다')
})

test('허용 목록은 낡지 않았다 — 각 자리에 실제로 user_email 읽기가 있다', () => {
  const files = new Set(userEmailReads().map((hit) => hit.file))
  for (const file of Object.keys(OWN_ADDRESS_FILES)) assert.ok(files.has(file), `${file} 에 user_email 읽기가 없다 — 목록에서 뺀다`)
})

test('주소 → 사람을 찾는 곳이 해석기를 부른다 — 초대 · 게스트 초대 · 수락 · 별칭 더하기', () => {
  const callers = sources()
    .filter((file) => readFileSync(file, 'utf8').includes('resolveUserByEmail('))
    .map(toKey)
    .sort()
  assert.deepEqual(callers, ['lib/auth/account-email.ts', 'lib/auth/resolve-user.ts', 'lib/workspace/guest.ts', 'lib/workspace/invite.ts'])
})
