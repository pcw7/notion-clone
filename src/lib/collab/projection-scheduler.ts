/**
 * 밀린 투영의 창 — 페이지마다 한 번에 하나, 처음 청한 때부터 창이 지나면 (CRDT 5d)
 *
 * 정본: X-1 프로젝터("디바운스 실행 · 페이지당 단일 워커") · §6.2-21 투영 지연 SLO(p95 < 2s) · §6.2-22 쓰기 증폭(디바운스 1s 기본)
 *
 * 협업 서버는 참여자 update 를 쌓기만 하고(`block/body-write.ts` `projection: 'deferred'`) 그 페이지의 투영을 여기에 청한다.
 *
 *   - **창은 처음 청한 때부터 잰다**(뒤따른 청으로 밀리지 않는다). 계속 타이핑하는 동안에도 창마다 한 번 투영하므로 행이 낡는
 *     시간이 창 + 투영 시간으로 묶인다 — 청할 때마다 다시 재면(trailing) 쉬지 않는 편집에서 영영 투영하지 않는다
 *   - **한 페이지에 하나만 돈다.** 도는 동안 청하면 끝난 뒤 창을 한 번 더 연다 — 도는 투영은 잠근 뒤의 본문까지만 옮긴다
 *   - 투영은 창에서 **마지막으로 청한 사람**의 세션으로 돈다(`projectPendingBody` 의 `ctx` — 행에 남길 편집자)
 *   - 실패는 기록만 하고 다른 페이지를 막지 않는다. 그 페이지는 다음 청 · 명령 · 참조를 건드린 update 가 따라잡는다
 *   - 한 프로세스 안의 줄이다. 서버가 둘이면 둘 다 돌 수 있지만 투영하는 단위가 잠근 뒤 따라잡은 것을 보고 아무것도 쓰지 않는다
 *
 * ⚠ 창이 열린 채 프로세스가 죽으면 그 페이지의 행은 다음 편집 · 명령까지 낡는다 — 밀린 페이지를 훑는 길이 없다(HANDOFF §7).
 *   내릴 때(`flush`)는 열린 창을 기다리지 않고 곧바로 돌린다.
 */

import type { SessionContext } from '../auth/session-context.ts'

/** 정본 §6.2-22 의 기본 디바운스. */
export const PROJECTION_DELAY_MS = 1000

export type ProjectionScheduler = {
  /** 이 페이지의 투영을 청한다. 창이 열려 있거나 도는 중이면 합친다. */
  request(pageId: string, ctx: SessionContext): void
  /** 열린 창을 기다리지 않고 곧바로 돌리고, 도는 것까지 모두 끝나기를 기다린다. */
  flush(): Promise<void>
}

export type ProjectionSchedulerOptions = {
  /** 투영 한 번. 던지면 기록하고 넘어간다. */
  readonly project: (pageId: string, ctx: SessionContext) => Promise<unknown>
  /** 창의 길이. 없으면 `PROJECTION_DELAY_MS`. */
  readonly delayMs?: number
  /** 검사가 시계를 바꿀 때. */
  readonly setTimer?: (run: () => void, ms: number) => unknown
  readonly clearTimer?: (timer: unknown) => void
  /** 실패 기록. 없으면 `console.error`. */
  readonly onError?: (pageId: string, error: unknown) => void
}

type Slot = {
  ctx: SessionContext
  timer: unknown
  running: Promise<void> | null
  /** 도는 동안 청했다 — 끝나면 창을 한 번 더 연다. */
  again: boolean
}

export function createProjectionScheduler(options: ProjectionSchedulerOptions): ProjectionScheduler {
  const delayMs = options.delayMs ?? PROJECTION_DELAY_MS
  const setTimer = options.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms))
  const clearTimer = options.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  const onError = options.onError ?? ((pageId: string, error: unknown) => console.error('[collab] 밀린 투영을 하지 못했다:', pageId, error))
  const slots = new Map<string, Slot>()

  const open = (pageId: string, slot: Slot): void => {
    slot.timer = setTimer(() => void run(pageId), delayMs)
  }

  const run = (pageId: string): Promise<void> => {
    const slot = slots.get(pageId)
    if (slot === undefined) return Promise.resolve()
    if (slot.running !== null) return slot.running
    if (slot.timer !== null) clearTimer(slot.timer)
    slot.timer = null
    const ctx = slot.ctx
    slot.running = options
      .project(pageId, ctx)
      .then(
        () => undefined,
        (error: unknown) => onError(pageId, error),
      )
      .finally(() => {
        slot.running = null
        if (slot.again) {
          slot.again = false
          open(pageId, slot)
        } else if (slot.timer === null) {
          slots.delete(pageId)
        }
      })
    return slot.running
  }

  return {
    request(pageId, ctx) {
      const slot = slots.get(pageId)
      if (slot === undefined) {
        const created: Slot = { ctx, timer: null, running: null, again: false }
        slots.set(pageId, created)
        open(pageId, created)
        return
      }
      slot.ctx = ctx
      if (slot.running !== null) slot.again = true
    },

    async flush() {
      // 도는 동안 청한 것은 끝난 뒤 창을 다시 연다 — 다음 바퀴가 그 창을 기다리지 않고 돌린다.
      while (slots.size > 0) {
        await Promise.all([...slots.keys()].map((pageId) => run(pageId)))
      }
    },
  }
}
