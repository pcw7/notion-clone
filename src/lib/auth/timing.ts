/**
 * 응답 시간 정규화.
 *
 * 정본 F-14-16: "계정 열거 — /auth/identify 와 /auth/reset 응답을 존재 여부와
 * 무관하게 동일하게. **응답 시간도 상수화**"
 *
 * 응답 본문을 똑같이 만들어도 시간이 다르면 열거가 된다. 계정이 있으면
 * challenge 를 만들고 메일을 보내느라 수십~수백 ms 가 더 걸리는데, 이 차이는
 * 자동화 도구로 충분히 측정 가능하다.
 *
 * 그래서 **최소 소요 시간**을 정해두고 그보다 빨리 끝나면 남은 만큼 기다린다.
 * 최소 시간을 넘긴 경우까지 맞출 수는 없으므로 완전한 상수 시간은 아니다 —
 * 정규화(normalization)이지 상수화가 아니다. 실제 소요가 최소값을 자주 넘으면
 * 최소값을 올려야 한다는 신호다.
 */

/** 인증 엔드포인트의 최소 응답 시간. 관측된 정상 처리 시간보다 넉넉해야 한다. */
export const AUTH_MIN_RESPONSE_MS = Number(process.env.AUTH_MIN_RESPONSE_MS ?? 300)

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * `fn` 을 실행하되 최소 `minMs` 가 지난 뒤에 결과를 돌려준다.
 *
 * 예외도 같은 규칙을 따른다 — 실패가 빠르면 그 자체로 신호가 되기 때문이다.
 */
export async function withMinimumDuration<T>(
  fn: () => Promise<T>,
  minMs: number = AUTH_MIN_RESPONSE_MS,
): Promise<T> {
  const started = Date.now()
  try {
    const result = await fn()
    const remaining = minMs - (Date.now() - started)
    if (remaining > 0) await sleep(remaining)
    return result
  } catch (e) {
    const remaining = minMs - (Date.now() - started)
    if (remaining > 0) await sleep(remaining)
    throw e
  }
}
