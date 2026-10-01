/**
 * 클립보드에 글자를 쓴다 — 블록 메뉴의 "블록 링크 복사"와 코드 블록의 "복사"가 함께 쓴다 (8a-2 에서 `block-menu.tsx` 에서 옮겼다).
 *
 * ⚠ 브라우저에서만 부른다(`navigator` · `document`).
 *
 * `navigator.clipboard` 는 **보안 컨텍스트**(https · localhost)에만 있다. 같은 네트워크의 다른 기기에서 `http://192.168.…:3000`
 * 으로 열면 없다 — 그때는 예전 방식(`execCommand('copy')`)으로 한 번 더 시도한다. 둘 다 실패하면 false 를 돌려주고, 부르는 쪽이
 * 알린다(손으로 복사할 수 있게).
 *
 * `navigator.clipboard.writeText` 는 **부를 때마다** 찾는다 — 모듈을 읽을 때 붙잡아 두면 e2e 가 심는 가짜(실제 클립보드 없이
 * 복사를 확인한다)가 먹지 않는다.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 권한 거부 — 아래 방식으로 한 번 더.
    }
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  return ok
}
