/**
 * "복제"가 서버에 묻고 사람에게 말하는 법 — 복제 6b조각 (F-02-09)
 *
 * 엔진은 `lib/block/duplicate.ts` 다. 여기 있는 것은 **무엇을 말해 주는가** 하나다 — 복제는 조용히 끝나면 안 되는 경우가
 * 둘 있다.
 *
 *   볼 수 없는 하위 페이지가 빠졌다   사본에 없는 것이 생겼다. 개수만 말한다(제목은 서버도 주지 않는다)
 *   너무 커서 거부됐다                413. 고칠 수 있는 요청이 아니라 크기의 문제다
 *
 * **빠진 것이 있으면 사본으로 옮겨 가지 않는다.** 옮겨 가면 그 말이 화면과 함께 사라진다 — 사이드바에 선 사본을 눌러
 * 들어가는 것은 한 번 더 누르는 일일 뿐이고, "일부가 빠졌다"는 한 번 놓치면 다시 알 길이 없다.
 *
 * 문구를 여기 모으는 이유는 부르는 자리가 둘이어서다(페이지 우상단 · 사이드바). 두 벌이면 한쪽만 고쳐진다.
 */

/** 복제한 뒤 할 말과, 사본으로 바로 옮겨 갈지. */
export type DuplicateNote = {
  /** 사람에게 보일 한 줄. 빠진 것이 없으면 `null` — 말할 것이 없다. */
  readonly text: string | null
  /** 사본으로 옮겨 가는가. 빠진 것이 있으면 멈춰서 말한다(머리말). */
  readonly navigate: boolean
}

export function duplicateNote(skipped: number): DuplicateNote {
  // ★ `skipped > 0` 을 **부정으로** 묻는다. `<= 0` 은 `NaN` 에서 false 라 "NaN개는 복제하지 못했습니다"가 샌다
  //   (검사가 잡았다 — 서버가 그 값을 주지 않는 날이 오면 그렇게 된다).
  if (!(skipped > 0)) return { text: null, navigate: true }
  return {
    text: `사본을 만들었습니다. 볼 수 없는 하위 페이지 ${skipped}개는 복제하지 못했습니다.`,
    navigate: false,
  }
}

/** 실패의 이유를 사람의 말로. 서버의 코드(`DuplicateErrorCode`)와 같은 어휘를 쓴다. */
export function duplicateError(status: number, error: unknown): string {
  switch (error) {
    case 'not_found':
      return '페이지를 찾을 수 없습니다. 그사이 지워졌을 수 있습니다.'
    case 'target_not_found':
      return '복제할 위치를 찾을 수 없습니다.'
    case 'cycle':
      return '페이지를 자기 자신 안으로 복제할 수 없습니다.'
    case 'too_deep':
      return '더 깊은 하위 페이지를 만들 수 없습니다.'
    case 'too_large':
      return '너무 커서 한 번에 복제할 수 없습니다.'
  }
  return status >= 500 ? '서버에서 처리하지 못했습니다.' : '복제하지 못했습니다.'
}

export type DuplicateOutcome =
  | { readonly ok: true; readonly pageId: string; readonly note: DuplicateNote }
  | { readonly ok: false; readonly message: string }

/** 복제를 청한다. 자리는 주지 않는다 — 서버가 원본 바로 뒤에 둔다(F-02-09). */
export async function requestDuplicate(workspaceId: string, pageId: string): Promise<DuplicateOutcome> {
  try {
    const res = await fetch(`/api/workspaces/${workspaceId}/pages/${pageId}/duplicate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    const body = (await res.json().catch(() => null)) as { page?: { id?: string }; skipped?: number; error?: unknown } | null
    if (!res.ok || typeof body?.page?.id !== 'string') {
      return { ok: false, message: duplicateError(res.status, body?.error) }
    }
    return { ok: true, pageId: body.page.id, note: duplicateNote(Number(body.skipped ?? 0)) }
  } catch {
    return { ok: false, message: '연결에 실패했습니다.' }
  }
}
