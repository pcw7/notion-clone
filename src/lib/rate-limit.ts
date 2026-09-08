/**
 * 레이트리밋 — 고정 윈도우 카운터.
 *
 * 정본: docs/research/14-auth-accounts.md F-14-16
 *
 * 두 가지가 이 모듈의 설계를 결정한다.
 *
 * 1. **저장소는 Valkey 다. DB 가 아니다.** 명세에 명시되어 있다.
 *    인증 시도마다 DB 쓰기를 하면 로그인 트래픽이 그대로 DB 부하가 된다.
 *
 * 2. **저장소 장애 시 fail-open 이다.** 명세의 판단:
 *    "레이트리밋 저장소 장애 → fail-open(로그인 허용) vs fail-closed(전면 차단).
 *     로그인은 fail-open + 알림이 실용적 [클론 결정]"
 *    Valkey 가 죽었다고 전 사용자 로그인을 막는 것은, 막으려던 피해보다 크다.
 *    대신 그 사실을 반드시 로그에 남긴다 — 조용히 열려 있으면 공격 창이 된다.
 *
 * 고정 윈도우는 경계에서 최대 2배까지 통과시킨다(5분에 3회면 경계 전후로 6회).
 * 슬라이딩 윈도우가 정확하지만, 이 용도에서 2배는 허용 가능하고 구현이 단순하다.
 * 정확도가 필요해지면 여기만 바꾸면 된다.
 */

import { getValkey } from './valkey.ts'

export type RateLimitRule = {
  readonly limit: number
  readonly windowSeconds: number
}

export type RateLimitResult = {
  /** false 면 호출자가 요청을 거부해야 한다. */
  readonly allowed: boolean
  /** 이번 윈도우에서 남은 횟수. degraded 면 의미 없다. */
  readonly remaining: number
  /** 윈도우가 리셋되기까지 남은 초. */
  readonly resetSeconds: number
  /** 저장소 장애로 검사를 건너뛰었는가(fail-open). */
  readonly degraded: boolean
}

const OPEN = (rule: RateLimitRule): RateLimitResult => ({
  allowed: true,
  remaining: rule.limit,
  resetSeconds: rule.windowSeconds,
  degraded: true,
})

/**
 * 카운터를 1 증가시키고 한도 초과 여부를 돌려준다.
 *
 * INCR 과 EXPIRE 를 파이프라인으로 묶어 왕복을 1회로 줄인다. 첫 INCR 결과가
 * 1일 때만 TTL 을 걸어야 하는데, 파이프라인에서는 조건 분기를 할 수 없으므로
 * 항상 EXPIRE 를 건다. 그러면 매 요청마다 윈도우가 연장되어 고정 윈도우가
 * 아니라 "마지막 요청 이후 N초" 가 되어버린다 — 그래서 NX 옵션을 쓴다.
 */
export async function consume(
  namespace: string,
  identity: string,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  const key = `rl:${namespace}:${identity}`

  try {
    const results = await getValkey()
      .pipeline()
      .incr(key)
      // NX: TTL 이 아직 없을 때만 건다. 이미 있으면 연장하지 않는다.
      .expire(key, rule.windowSeconds, 'NX')
      .ttl(key)
      .exec()

    if (!results) return OPEN(rule)

    const [incrErr, countRaw] = results[0] ?? []
    const [, ttlRaw] = results[2] ?? []
    if (incrErr) throw incrErr

    const count = Number(countRaw)
    const ttl = Number(ttlRaw)

    return {
      allowed: count <= rule.limit,
      remaining: Math.max(0, rule.limit - count),
      // TTL 이 -1(무기한) 이면 EXPIRE 가 실패한 것이다. 안전하게 윈도우 값을 쓴다.
      resetSeconds: ttl >= 0 ? ttl : rule.windowSeconds,
      degraded: false,
    }
  } catch (e) {
    // fail-open. 조용히 넘어가면 안 된다 — 이 로그가 공격 창의 유일한 흔적이다.
    console.error(
      `[rate-limit] 저장소 장애로 검사를 건너뜁니다 (fail-open): ${namespace} — ${(e as Error).message}`,
    )
    return OPEN(rule)
  }
}

/**
 * 카운터를 올리지 않고 현재 상태만 본다.
 * "지금 요청하면 통과하는가"를 UI 에 보여줄 때 쓴다.
 */
export async function peek(
  namespace: string,
  identity: string,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  const key = `rl:${namespace}:${identity}`
  try {
    const client = getValkey()
    const [countRaw, ttlRaw] = await Promise.all([client.get(key), client.ttl(key)])
    const count = countRaw === null ? 0 : Number(countRaw)
    const ttl = Number(ttlRaw)
    return {
      allowed: count < rule.limit,
      remaining: Math.max(0, rule.limit - count),
      resetSeconds: ttl >= 0 ? ttl : rule.windowSeconds,
      degraded: false,
    }
  } catch (e) {
    console.error(`[rate-limit] peek 실패 (fail-open): ${namespace} — ${(e as Error).message}`)
    return OPEN(rule)
  }
}

/** 검증 성공 시 카운터를 지운다. 테스트에서도 쓴다. */
export async function reset(namespace: string, identity: string): Promise<void> {
  try {
    await getValkey().del(`rl:${namespace}:${identity}`)
  } catch {
    // 지우지 못해도 윈도우가 지나면 사라진다. 실패해도 무해하다.
  }
}
