/**
 * 협업 서버 주소 — 서버 렌더가 화면에 실어 준다 (CRDT 6d조각)
 *
 * `NEXT_PUBLIC_*` 로 두지 않는다 — 그것은 **빌드할 때** 값이 박혀, 같은 빌드를 다른 포트 · 다른 배포에 쓸 수 없다.
 * e2e 는 앱과 협업 서버를 검사 전용 포트로 함께 띄운다(`scripts/e2e-editor.mjs`).
 */
export function collabServerUrl(): string {
  return process.env.COLLAB_URL ?? 'ws://localhost:3001'
}
