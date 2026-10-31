/**
 * 올린 파일의 메타(이름 · 크기 · MIME) 를 파일 id 로 읽고 기억한다 — 파일 블록 노드 뷰(F-1b · 정본 §3.4 [보강 F-1] ⑧)
 *
 * 블록에는 `file_id` 만 있다(①). 노드 뷰는 그릴 때마다 묻지 않고 한 번 읽은 답을 id 로 기억한다 — 파일은 id 로 불변이다(내용을 바꾸면 새
 * 파일이다). 못 읽은 것(없다 · 권한 · 연결)은 기억하지 않는다 — 다음 그리기가 다시 묻는다. 같은 id 를 동시에 여럿이 물으면 한 요청을 나눈다.
 *
 * 순수 모듈이다 — 읽는 함수를 밖에서 받는다(화면은 `GET /files/{id}` · 검사는 가짜).
 */

export type FileMeta = {
  readonly name: string | null
  readonly size: number
  readonly mime: string
}

export type FileMetaSource = {
  /** 메타를 준다 — 모르면 묻고 기억한다. 못 읽으면 null(기억하지 않는다). */
  readonly get: (fileId: string) => Promise<FileMeta | null>
  /** 이미 아는 값 — 묻지 않는다(첫 그리기가 깜빡이지 않게). */
  readonly peek: (fileId: string) => FileMeta | null
}

export function fileMetaSource(load: (fileId: string) => Promise<FileMeta | null>): FileMetaSource {
  const known = new Map<string, FileMeta>()
  const pending = new Map<string, Promise<FileMeta | null>>()
  return {
    peek: (fileId) => known.get(fileId) ?? null,
    get: (fileId) => {
      const have = known.get(fileId)
      if (have !== undefined) return Promise.resolve(have)
      const inflight = pending.get(fileId)
      if (inflight !== undefined) return inflight
      const request = load(fileId)
        .then((meta) => {
          if (meta !== null) known.set(fileId, meta)
          return meta
        })
        .catch(() => null)
        .finally(() => {
          pending.delete(fileId)
        })
      pending.set(fileId, request)
      return request
    },
  }
}

/** `GET /files/{id}` 의 답을 메타로 — 모양이 틀리면 null. */
export function fileMetaOfResponse(payload: unknown): FileMeta | null {
  const file = (payload as { file?: unknown } | null | undefined)?.file
  if (typeof file !== 'object' || file === null) return null
  const f = file as { name?: unknown; size?: unknown; mime?: unknown }
  if (typeof f.size !== 'number' || !Number.isFinite(f.size)) return null
  return {
    name: typeof f.name === 'string' && f.name !== '' ? f.name : null,
    size: f.size,
    mime: typeof f.mime === 'string' ? f.mime : 'application/octet-stream',
  }
}
