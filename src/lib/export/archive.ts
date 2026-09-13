/**
 * 익스포트 계획 → ZIP 바이트 스트림 — F-09-14
 *
 * `planExport` 가 만든 항목을 순서대로 ZIP 에 흘려보낸다. 첨부 파일은 **흘려보내는 그때** 읽는다 —
 * 먼저 전부 읽어 두면 워크스페이스의 이미지가 메모리에 한꺼번에 오른다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 못 읽은 첨부는 멈추지 않고 센다 — 그래서 보고서가 맨 마지막이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 행은 있는데 저장소에 바이트가 없는 파일(`readFile` 이 null — 업로드가 끊긴 흔적)이 하나 있다고
 * 익스포트 전체를 실패시키면 사용자는 나머지 전부를 꺼낼 수 없다. 그 항목만 빼고 보고서의
 * `missing_attachments` 에 센다. 흘려보내며 알게 된 것까지 담아야 하므로 보고서는 마지막 항목이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * ZIP 한계에서는 멈춘다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `zip.ts` 가 던지면 그대로 던진다. 이미 흘려보낸 앞부분은 끝 레코드가 없는 조각이라 어떤 도구도
 * 온전한 ZIP 으로 읽지 않는다 — 조용히 잘린 백업이 되지 않는다. 호출자는 시작하기 전에
 * `estimateExport` 로 거른다.
 */

import { REPORT_PATH, serializeReport, type ExportPlan } from './plan.ts'
import { createZipWriter } from './zip.ts'

/** 첨부 파일의 바이트. 저장소에 없으면 `null`. */
export type ReadAttachment = (fileId: string) => Promise<Uint8Array | null>

export type StreamOptions = {
  /** ZIP 바이트 상한. 없으면 ZIP 의 한계다. */
  readonly maxBytes?: number
}

export async function* streamExportZip(
  plan: ExportPlan,
  readAttachment: ReadAttachment,
  options: StreamOptions = {},
): AsyncGenerator<Uint8Array, void, undefined> {
  // 수정 시각은 익스포트 시각 하나다 — 같은 계획이면 같은 바이트가 나온다.
  const zip = createZipWriter({
    modifiedAt: new Date(plan.report.exported_at),
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
  })

  let missing = 0
  for (const entry of plan.entries) {
    if (entry.kind === 'text') {
      yield* zip.add(entry.path, entry.text)
      continue
    }
    const bytes = await readAttachment(entry.fileId)
    if (bytes === null) {
      missing += 1
      continue
    }
    // 받는 이미지(PNG · JPEG · GIF · WebP)는 이미 압축돼 있다.
    yield* zip.add(entry.path, bytes, { compress: false })
  }

  yield* zip.add(REPORT_PATH, serializeReport({ ...plan.report, missing_attachments: missing }))
  yield zip.finish()
}
