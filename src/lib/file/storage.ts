/**
 * 스토리지 드라이버 — F-12-09
 *
 * 정본: 12-platform-ux.md F-12-09, CLAUDE.md 절대 제약 1
 *
 * ──────────────────────────────────────────────────────────────────────
 * 이 파일이 하는 일은 **자리를 만드는 것**이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 바이트를 어디에 두는지는 배포마다 다르다. `file.storage_key` 하나로 가리키고,
 * 실제 읽고 쓰는 일은 드라이버가 한다. 지금 있는 것은 로컬 디스크 드라이버 하나다.
 *
 * **R2(S3 호환) 드라이버는 아직 없다.** 자격증명 없이 쓰면 한 번도 돌려보지 못한 코드가
 * 들어가는데, 그건 없는 것보다 나쁘다 — 있다고 믿게 만든다. 들어올 자리는 아래
 * `FileStorage` 세 함수이고, 그때 `/content` 라우트는 바이트를 흘려보내는 대신
 * **그 자리에서 만든 서명 URL 로 302** 하면 된다(정본 불변식: 서명 URL 은 저장하지
 * 않는다). CLAUDE.md 절대 제약 1: 자체 호스팅이 필요하면 SeaweedFS(Apache-2.0),
 * 기본은 Cloudflare R2. **MinIO 는 금지**(AGPLv3 · 2026-04 아카이브).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 키는 바깥에서 온다 — 그래서 여기서 한 번 더 막는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 키는 우리가 만들지만(`storageKeyFor`), 읽을 때는 **DB 에서 읽은 값**을 받는다.
 * 그 사이에 무엇이 끼어들었든 `..` 나 절대경로가 들어오면 저장 폴더 밖을 읽고 쓰게
 * 된다. 드라이버가 자기 경계를 스스로 지킨다 — 부르는 쪽을 믿지 않는다.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

export type FileStorage = {
  /** 진단·로그용 이름. */
  readonly kind: string
  put(key: string, bytes: Uint8Array): Promise<void>
  /** 없으면 null — 예외로 만들지 않는다. 지워진 파일을 읽는 일은 정상 경로다. */
  read(key: string): Promise<Uint8Array | null>
  remove(key: string): Promise<void>
}

/**
 * 역슬래시(U+005C). **소스에 직접 쓰지 않는다** — 이 저장소를 고치는 도구들이
 * 이스케이프를 한 겹 먹어서 문자열이 닫히지 않는 일을 실제로 겪었다.
 */
const BACKSLASH = String.fromCharCode(0x5c)

/**
 * 키가 저장 폴더 안을 가리키는가. 아니면 null.
 *
 * **경로 정규화(`path.normalize`)를 쓰지 않는다.** 스토리지 키는 플랫폼 경로가 아니라
 * S3 식 키라 구분자가 늘 `/` 다. 정규화하면 윈도우에서 `ws/a.png` 가 역슬래시 형태로
 * 바뀌어 **들어온 키와 나간 키가 달라진다** — 키를 비교하거나 기록하는 쪽이 조용히
 * 어긋난다(실제로 테스트가 이걸 잡았다). 대신 세그먼트를 직접 본다.
 */
export function safeKey(key: string): string | null {
  if (key === '' || key.startsWith('/')) return null
  // 역슬래시는 리눅스에서 파일명의 일부로 통과해 버리므로 아예 받지 않는다.
  if (key.includes(BACKSLASH)) return null
  // `C:` 같은 드라이브 접두어.
  if (/^[a-zA-Z]:/.test(key)) return null
  const segments = key.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null
  return key
}

/**
 * 로컬 디스크. 개발과 단일 서버 자체 호스팅용이다.
 *
 * 여러 서버로 늘리면 이 드라이버로는 안 된다(서버마다 다른 디스크를 본다) — 그때가
 * R2 드라이버가 필요한 시점이다.
 */
export function localFileStorage(root: string): FileStorage {
  const base = resolve(root)
  const pathFor = (key: string): string | null => {
    const safe = safeKey(key)
    if (safe === null) return null
    const full = join(base, ...safe.split('/'))
    // 만든 경로를 한 번 더 확인한다 — 정규화 차이로 빠져나가는 경우를 막는 마지막 방어선.
    return full === base || full.startsWith(base + sep) ? full : null
  }

  return {
    kind: 'local',

    async put(key, bytes) {
      const full = pathFor(key)
      if (full === null) throw new Error(`저장 폴더 밖의 키입니다: ${key}`)
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, bytes)
    },

    async read(key) {
      const full = pathFor(key)
      if (full === null) return null
      try {
        return new Uint8Array(await readFile(full))
      } catch {
        return null
      }
    },

    async remove(key) {
      const full = pathFor(key)
      if (full === null) return
      await rm(full, { force: true })
    },
  }
}

let shared: FileStorage | null = null

/**
 * 이 배포의 드라이버. `FILE_STORAGE_DIR` 로 폴더를 바꾼다(기본 `var/uploads`).
 *
 * 저장 폴더는 저장소에 커밋하지 않는다(`.gitignore`). 개발 데이터를 지우려면 그 폴더를
 * 지우면 되고, DB 의 `file` 행은 남아 읽을 때 404 가 된다 — 그 상태를 조용히 넘기지
 * 않으려고 `read` 가 null 을 돌려준다.
 */
export function fileStorage(): FileStorage {
  if (shared === null) {
    shared = localFileStorage(process.env.FILE_STORAGE_DIR ?? join(process.cwd(), 'var', 'uploads'))
  }
  return shared
}

/** 테스트에서 드라이버를 갈아끼운다. */
export function setFileStorage(storage: FileStorage | null): void {
  shared = storage
}
