/**
 * ZIP 쓰기 — F-09-14 (익스포트 산출물)
 *
 * 정본: 09-api-integrations.md F-09-14 — *"수 GB ZIP 은 메모리에 올릴 수 없다 → 스트리밍 ZIP
 *       생성"* · PKWARE APPNOTE.TXT §4.3 (파일 헤더 · 중앙 디렉터리 · 끝 레코드)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 의존성을 넣지 않았다
 * ──────────────────────────────────────────────────────────────────────
 *
 * ZIP 은 헤더 세 종류와 CRC-32 하나다. 압축(raw deflate)과 CRC-32 는 `node:zlib` 에 있다
 * (`zlib.crc32` 는 Node 20.15 · 22.2 부터). 우리가 쓰는 것은 "항목을 순서대로 흘려보내는
 * 쓰기" 하나라, 라이브러리를 설정하는 코드보다 이 파일이 짧다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 항목 하나씩 압축을 끝낸 뒤 헤더를 쓴다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 스트리밍 ZIP 의 흔한 방식은 크기를 모른 채 헤더를 쓰고 데이터 뒤에 서술자(플래그 3번 비트)로
 * 적는 것이다. 여기서는 항목 **하나**를 압축한 뒤 크기를 알고 헤더를 쓴다. 메모리는 가장 큰
 * 항목 하나만큼만 쓰고(본문 1MB · 이미지 5MiB 상한이 이미 있다) 전체는 올리지 않는다.
 * 서술자를 제대로 읽지 못하는 도구 문제가 아예 생기지 않는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * ZIP64 가 없다 — 넘으면 던진다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 항목 65,534개 · 4GiB 미만. 넘치는 순간 멈추고 잘라서 내보내지 않는다 — 잘린 ZIP 은
 * F-09-14 가 경고한 *"구멍 난 백업"* 이다. 익스포트 조립이 예산을 미리 세어 범위를 줄이라고
 * 말하는 것이 맞고, 이 파일은 그 약속이 깨졌을 때의 마지막 방어다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 파일 이름은 UTF-8 이고 그렇다고 표시한다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 범용 플래그 11번 비트가 없으면 압축 해제 도구가 이름을 시스템 코드페이지(한국어 Windows 는
 * CP949)로 읽어 한글 파일 이름이 깨진다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 경로를 믿지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `../` · 절대 경로 · 역슬래시 · 드라이브 문자는 풀 때 대상 폴더 **밖**에 쓰는 zip slip 이다.
 * 이름은 조립 단계가 이미 소독하지만 여기서 한 번 더 막는다. 대소문자 · 유니코드 정규화만 다른
 * 두 경로, 같은 이름의 파일과 폴더도 거부한다 — Windows · macOS 에서 풀면 하나가 다른 하나를
 * 덮거나 풀기 자체가 실패한다.
 */

import { crc32, deflateRawSync } from 'node:zlib'

/** `0xFFFF` 는 "ZIP64 레코드를 보라"는 표지라 쓸 수 없다. */
export const MAX_ZIP_ENTRIES = 0xfffe
/** 크기 · 위치 필드의 `0xFFFFFFFF` 도 ZIP64 표지다. */
export const MAX_ZIP_BYTES = 0xfffffffe

const MAX_NAME_BYTES = 0xffff
const LOCAL_HEADER = 30
const CENTRAL_HEADER = 46
const END_RECORD = 22

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_END = 0x06054b50

/** 2.0 — deflate 를 푸는 데 필요한 판. "만든 곳"의 윗바이트 0 은 MS-DOS(외부 속성 0 = 보통 파일)다. */
const VERSION = 20
const FLAG_UTF8 = 0x0800
const METHOD_STORE = 0
const METHOD_DEFLATE = 8

export type ZipErrorCode = 'unsafe_path' | 'duplicate_path' | 'too_many_entries' | 'too_large' | 'finished'

export class ZipError extends Error {
  // 파라미터 프로퍼티를 쓰지 않는다 — node 의 strip-only TypeScript 가 지원하지 않는다.
  readonly code: ZipErrorCode

  constructor(code: ZipErrorCode, message: string) {
    super(message)
    this.name = 'ZipError'
    this.code = code
  }
}

export type ZipEntryOptions = {
  /** 이미 압축된 형식(PNG · JPEG)은 `false` — 헛수고를 줄인다. 줄지 않으면 어차피 저장으로 쓴다. */
  readonly compress?: boolean
}

export type ZipWriterOptions = {
  /**
   * 모든 항목의 수정 시각. 기본은 지금이다.
   *
   * DOS 시각에는 시간대가 없다. **UTC 로 적는다** — 서버의 시간대에 따라 같은 익스포트가 다른
   * 바이트가 되지 않게 한다.
   */
  readonly modifiedAt?: Date
  /** 전체 바이트 상한. ZIP 의 한계(`MAX_ZIP_BYTES`)보다 작게만 둘 수 있다. */
  readonly maxBytes?: number
}

export type ZipWriter = {
  /**
   * 항목 하나를 넣고 **흘려보낼 바이트**(로컬 헤더 · 데이터)를 돌려준다.
   *
   * 저장(store)이면 넘겨받은 배열을 복사하지 않고 그대로 돌려준다 — 흘려보내기 전에 고치지 않는다.
   * 던지면 아무것도 바뀌지 않는다. 그 항목만 빼고 계속 쓰거나 `finish` 할 수 있다.
   */
  add(path: string, data: Uint8Array | string, options?: ZipEntryOptions): readonly Uint8Array[]
  /** 중앙 디렉터리 + 끝 레코드. 이후 `add` · `finish` 는 던진다. */
  finish(): Uint8Array
  /** 지금까지 `add` 가 돌려준 바이트 수. */
  readonly bytesWritten: number
  readonly entryCount: number
}

const encoder = new TextEncoder()

/** MS-DOS 날짜 · 시각. 1980–2107 밖은 양끝으로 붙인다. 초는 2초 단위다. */
export function dosDateTime(at: Date): { readonly time: number; readonly date: number } {
  const year = at.getUTCFullYear()
  if (year < 1980) return { time: 0, date: (1 << 5) | 1 }
  if (year > 2107) return { time: (23 << 11) | (59 << 5) | 29, date: (127 << 9) | (12 << 5) | 31 }
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  }
}

/** 풀 때 대상 폴더 밖으로 나가거나 플랫폼이 거부하는 경로면 던진다. */
export function assertSafeEntryPath(path: string): void {
  const fail = (why: string): never => {
    throw new ZipError('unsafe_path', `안전하지 않은 경로 ${JSON.stringify(path)} — ${why}`)
  }
  if (path === '') fail('비어 있다')
  for (const ch of path) {
    const code = ch.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) fail('제어 문자가 있다')
  }
  if (path.includes('\\')) fail('역슬래시 — Windows 에서 경로 구분자로 풀린다')
  if (path.includes(':')) fail('콜론 — 드라이브 문자이거나 NTFS 대체 스트림이다')
  if (path.startsWith('/')) fail('절대 경로다')
  for (const segment of path.split('/')) {
    if (segment === '') fail('빈 경로 조각이 있다(`//` 또는 끝의 `/`)')
    if (segment === '.' || segment === '..') fail('`.` · `..` 조각이 있다')
  }
  if (encoder.encode(path).length > MAX_NAME_BYTES) fail('이름이 너무 길다')
}

/** 대소문자 · 정규화만 다른 이름을 같게 본다. 풀리는 파일 시스템(NTFS · APFS)이 그렇게 본다. */
function collisionKey(path: string): string {
  return path.normalize('NFC').toLowerCase()
}

export function createZipWriter(options: ZipWriterOptions = {}): ZipWriter {
  const stamp = dosDateTime(options.modifiedAt ?? new Date())
  const maxBytes = Math.min(options.maxBytes ?? MAX_ZIP_BYTES, MAX_ZIP_BYTES)

  const central: Uint8Array[] = []
  let centralSize = 0
  let offset = 0
  let count = 0
  let finished = false
  const files = new Set<string>()
  const folders = new Set<string>()

  const assertOpen = (): void => {
    if (finished) throw new ZipError('finished', '이미 끝낸 ZIP 에는 더 쓸 수 없다')
  }

  return {
    get bytesWritten() {
      return offset
    },
    get entryCount() {
      return count
    },

    add(path, data, entry = {}) {
      assertOpen()
      assertSafeEntryPath(path)

      // ── 충돌. 풀었을 때 같은 자리를 차지하는 것은 전부 거부한다 ──
      const key = collisionKey(path)
      const parents = key.split('/').slice(0, -1).map((_, i, all) => all.slice(0, i + 1).join('/'))
      if (files.has(key) || folders.has(key)) {
        throw new ZipError('duplicate_path', `풀면 같은 자리를 차지하는 경로가 이미 있다: ${JSON.stringify(path)}`)
      }
      const blocked = parents.find((parent) => files.has(parent))
      if (blocked !== undefined) {
        throw new ZipError('duplicate_path', `폴더 자리에 같은 이름의 파일이 이미 있다: ${JSON.stringify(path)}`)
      }
      if (count >= MAX_ZIP_ENTRIES) {
        throw new ZipError('too_many_entries', `ZIP 항목은 ${MAX_ZIP_ENTRIES}개를 넘을 수 없다`)
      }

      const raw = typeof data === 'string' ? encoder.encode(data) : data
      if (raw.length > MAX_ZIP_BYTES) throw new ZipError('too_large', 'ZIP64 없이는 4GiB 를 넘는 항목을 쓸 수 없다')

      const name = encoder.encode(path)
      const checksum = crc32(raw)
      let method = METHOD_STORE
      let body: Uint8Array = raw
      if (entry.compress !== false && raw.length > 0) {
        const deflated = deflateRawSync(raw)
        if (deflated.length < raw.length) {
          method = METHOD_DEFLATE
          body = deflated
        }
      }

      const localSize = LOCAL_HEADER + name.length + body.length
      const recordSize = CENTRAL_HEADER + name.length
      // 끝 레코드까지 들어가야 한다. 다 흘려보낸 뒤 `finish` 에서 넘치면 받은 쪽에는 이미 망가진
      // 파일이 있다.
      if (offset + localSize + centralSize + recordSize + END_RECORD > maxBytes) {
        throw new ZipError('too_large', `ZIP 이 상한(${maxBytes}바이트)을 넘는다`)
      }

      const header = new Uint8Array(LOCAL_HEADER + name.length)
      const h = new DataView(header.buffer)
      h.setUint32(0, SIG_LOCAL, true)
      h.setUint16(4, VERSION, true)
      h.setUint16(6, FLAG_UTF8, true)
      h.setUint16(8, method, true)
      h.setUint16(10, stamp.time, true)
      h.setUint16(12, stamp.date, true)
      h.setUint32(14, checksum, true)
      h.setUint32(18, body.length, true)
      h.setUint32(22, raw.length, true)
      h.setUint16(26, name.length, true)
      h.setUint16(28, 0, true) // 추가 필드 없음
      header.set(name, LOCAL_HEADER)

      const record = new Uint8Array(recordSize)
      const r = new DataView(record.buffer)
      r.setUint32(0, SIG_CENTRAL, true)
      r.setUint16(4, VERSION, true) // 만든 곳
      r.setUint16(6, VERSION, true) // 풀기에 필요한 판
      r.setUint16(8, FLAG_UTF8, true)
      r.setUint16(10, method, true)
      r.setUint16(12, stamp.time, true)
      r.setUint16(14, stamp.date, true)
      r.setUint32(16, checksum, true)
      r.setUint32(20, body.length, true)
      r.setUint32(24, raw.length, true)
      r.setUint16(28, name.length, true)
      // 30 추가 필드 · 32 주석 길이 · 34 디스크 번호 · 36 내부 속성 · 38 외부 속성 — 전부 0
      r.setUint32(42, offset, true)
      record.set(name, CENTRAL_HEADER)

      // 여기서부터 상태를 바꾼다. 위의 검사가 하나라도 던지면 아무것도 바뀌지 않았다.
      files.add(key)
      for (const parent of parents) folders.add(parent)
      central.push(record)
      centralSize += record.length
      offset += localSize
      count += 1

      return [header, body]
    },

    finish() {
      assertOpen()
      finished = true

      const out = new Uint8Array(centralSize + END_RECORD)
      let at = 0
      for (const record of central) {
        out.set(record, at)
        at += record.length
      }
      const e = new DataView(out.buffer, at)
      e.setUint32(0, SIG_END, true)
      // 4 이 디스크 번호 · 6 중앙 디렉터리가 시작하는 디스크 — 0
      e.setUint16(8, count, true)
      e.setUint16(10, count, true)
      e.setUint32(12, centralSize, true)
      e.setUint32(16, offset, true)
      // 20 주석 길이 — 0
      return out
    },
  }
}
