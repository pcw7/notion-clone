'use client'

/**
 * 탭 제목 — 내용의 이름 (플랫폼 잔여 10d-7b · F-12-13 · 정본 §3.1 [보강] 문서의 언어 · 화면 제목 ④)
 *
 * 페이지 · 데이터베이스 · 템플릿 편집 · teamspace 의 이름은 **화면이 이미 읽은 값으로 브라우저에서** 탭 제목에 쓴다. `generateMetadata` 로
 * 하지 않는다 — Next 16 은 화면에 보이는 링크마다 그 경로의 메타데이터를 미리 받는다(세그먼트의 미리받기를 꺼도). 내용의 이름은 권한을
 * 거친 읽기(세션 · 페이지)라 링크 수만큼 서버 일이 늘고, 화면을 떠나면 끊긴 미리받기가 서버 로그에 남았다(§3.3-448).
 *
 * 첫 HTML 의 `<title>` 은 기본값이다 — 이름을 싣지 않는다. 첫 로드에는 Next 가 메타데이터의 `<title>` 을 **우리 뒤에** 다시 쓰므로(흘려
 * 보내는 메타데이터), 이 화면에 있는 동안은 `<title>` 이 바뀌면 다시 쓴다. 지켜보기는 레이아웃 효과로 걸고 푼다 — 떠나는 커밋 안에서 풀려야
 * 다음 화면의 제목을 덮지 않는다(변화 알림은 커밋 뒤의 마이크로태스크에서 온다). 떠날 때 되돌리지 않으므로 클라이언트 이동으로 닿는 화면은
 * 저마다 이름이 있어야 한다(`/` · 접근 요청).
 *
 * **쓰는 것은 나중에 선 하나뿐이다** — 둘이 함께 서면(피크를 막지 않은 실수 같은) 서로의 제목을 다시 쓰며 끝없이 돌아 브라우저가 멈췄다
 * (반사실 B). 나중에 선 것이 내려가면 그 앞의 것이 다시 쓴다.
 */

import { useLayoutEffect } from 'react'

import { fullTitle } from '@/lib/nav/screen-title'

/** 탭 제목을 쥔 차례 — 마지막 것만 쓴다. */
const owners: { readonly apply: () => void }[] = []

/** 바뀐 것이 `<title>`(또는 그 안의 글)인가. */
function touchesTitle(records: readonly MutationRecord[]): boolean {
  return records.some(
    (r) =>
      r.target.nodeName === 'TITLE' ||
      r.target.parentNode?.nodeName === 'TITLE' ||
      [...r.addedNodes].some((n) => n.nodeName === 'TITLE'),
  )
}

export function DocumentTitle({ title }: { title: string }) {
  useLayoutEffect(() => {
    const wanted = fullTitle(title)
    const owner = {
      apply: () => {
        if (owners.at(-1) === owner && document.title !== wanted) document.title = wanted
      },
    }
    owners.push(owner)
    owner.apply()
    const observer = new MutationObserver((records) => {
      if (touchesTitle(records)) owner.apply()
    })
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      owners.splice(owners.indexOf(owner), 1)
      owners.at(-1)?.apply()
    }
  }, [title])
  return null
}
