/**
 * 오프라인 편집기의 코드를 받아 두기 — 내려받기 뒤에 한 번 (OF-2 · F-12-04 · 정본 §3.7 [보강 OF-1] ②)
 *
 * 서비스 워커는 **받은 정적 파일만** 캐시한다(`public/sw.js` — 먼저 캐시). 껍데기(`/offline`)의 청크는 워커가 설치 때 받아 두지만, 껍데기가
 * 지연 로드하는 오프라인 편집기의 청크는 누가 한 번 받아야 캐시에 들어간다 — 받아 두지 않으면 네트워크 없이 열 수 없다.
 *
 * **껍데기 안에서 받는다** — 앱의 화면은 껍데기를 숨은 틀(iframe · `/offline#warm`)로 열고, 껍데기가 자기 `import()` 로 편집기를 받은 뒤
 * 답한다(`postMessage`). 앱의 화면에서 같은 모듈을 `import()` 해도 같은 파일을 받는다는 보장이 없다 — 번들러는 지연 청크를 부르는 쪽(그
 * 화면이 이미 가진 모듈)에 따라 다르게 자른다. 네트워크 없이 부를 것은 껍데기의 `import()` 이므로 그것을 그대로 한 번 부른다.
 *
 * 워커가 화면을 맡은 뒤에 연다 — 맡지 않은 틀의 요청은 워커를 거치지 않아 캐시에 들어가지 않는다(첫 방문의 등록 직후). 워커가 없으면
 * (개발 서버 · 지원하지 않는 브라우저) 잠깐 기다리고 그대로 연다 — 캐시는 없지만 실패는 아니다.
 *
 * ⚠ 같은 빌드 안에서만 맞다 — 배포로 청크 이름이 바뀌어도 워커는 설치 때의 껍데기를 그대로 쓴다(`public/sw.js` 머리). 껍데기를 바꾸면
 * `VERSION` 을 올려 다시 설치하게 한다 — 그때 받아 둔 편집기 청크는 옛 캐시와 함께 지워진다(다시 내려받으면 다시 받는다).
 */

import { OFFLINE_URL } from './sw-policy.ts'

/** 껍데기를 받아 두기 틀로 여는 표시(주소의 해시) — 서버는 같은 정적 화면을 준다. */
export const WARM_HASH = '#warm'
/** 껍데기가 앱에 보내는 답의 종류. */
export const WARM_MESSAGE = 'nc-offline-warm'

export type WarmReply = { readonly type: typeof WARM_MESSAGE; readonly ok: boolean }

/** 이 껍데기가 받아 두기 틀인가 — 해시가 맞고 다른 화면 안에 열렸다. */
export function isWarmFrame(hash: string, framed: boolean): boolean {
  return framed && hash === WARM_HASH
}

export function isWarmReply(data: unknown): data is WarmReply {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === WARM_MESSAGE && typeof (data as { ok?: unknown }).ok === 'boolean'
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 앱의 화면에서 — 껍데기를 숨은 틀로 열어 편집기 청크를 받게 하고 답을 기다린다. 받았으면 true. */
export async function warmOfflineEditor(timeoutMs = 20_000): Promise<boolean> {
  if ('serviceWorker' in navigator) await Promise.race([navigator.serviceWorker.ready, sleep(3000)])
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.hidden = true
    frame.tabIndex = -1
    frame.setAttribute('aria-hidden', 'true')
    frame.dataset.testid = 'offline-warm-frame'
    const finish = (ok: boolean): void => {
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      frame.remove()
      resolve(ok)
    }
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin || event.source !== frame.contentWindow || !isWarmReply(event.data)) return
      finish(event.data.ok)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    window.addEventListener('message', onMessage)
    frame.src = `${OFFLINE_URL}${WARM_HASH}`
    document.body.append(frame)
  })
}
