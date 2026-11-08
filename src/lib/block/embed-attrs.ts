/**
 * 임베드 iframe 의 격리 속성 — F-09-10 (44번 트랙 EM-1 · 정본 §3.4 [보강 EM-1] ③)
 *
 * 규칙 모듈(`embed-source.ts`)과 나눈 까닭: 공개 화면의 "불러오기" 조각(클라이언트)이 속성만 필요한데 규칙 전체를 번들에 싣지 않게.
 */

/** 위 창 옮기기(`allow-top-navigation*`) · 경고창(`allow-modals`) · 내려받기는 주지 않는다. */
export const EMBED_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation'
export const EMBED_ALLOW = 'fullscreen; picture-in-picture; encrypted-media; clipboard-write'
/** 리퍼러는 출처만 — YouTube 는 리퍼러가 없으면 재생을 거부한다. */
export const EMBED_REFERRER_POLICY = 'strict-origin-when-cross-origin'
