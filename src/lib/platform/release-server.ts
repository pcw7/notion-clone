/**
 * 새 버전 알림 — 서버가 아는 배포의 표지 (플랫폼 잔여 10h-1 · F-12-17 · 정본 §3.10 끝 [보강] 새 버전 알림 ①)
 *
 * 배포가 준 값(`APP_RELEASE`) · 없으면 빌드의 `.next/BUILD_ID` · 그것도 없으면(개발) 모른다. **프로세스마다 한 번** 읽는다 — 배포는 프로세스를
 * 바꾼다. 저장하지 않는다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { resolveRelease } from './release.ts'

let cached: { readonly value: string | null } | null = null

export function currentRelease(): string | null {
  cached ??= { value: resolveRelease(process.env.APP_RELEASE, readBuildId) }
  return cached.value
}

function readBuildId(): string | null {
  try {
    return readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8')
  } catch {
    return null
  }
}
