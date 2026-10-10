/**
 * robots.txt — 앱 경로는 막고, 공개 화면은 AI 크롤러에게 막는다 (게시 · 공유 6a-2a · F-17-11)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 공개 화면 ⑥ · 마스터 §9.4 *"공개 페이지 색인 기본값 noindex"*
 *
 * 색인 여부는 링크마다 다르다 — 그것은 공개 화면의 `<meta name="robots">` 가 말한다(여기서 `/p/` 를 막으면 크롤러가 그 meta 를 읽지
 * 못해 "noindex" 가 오히려 지켜지지 않는다). AI 크롤러는 링크마다 열 수 없으므로(토큰을 여기 적으면 주소가 퍼진다) 사이트 전체를
 * 막는다 — 앱 경로는 원래 로그인 뒤라 실제로 막히는 것은 `/p/` 다. 링크별 허용은 사이트(6c)가 경로를 가질 때.
 */

import type { MetadataRoute } from 'next'

/** 학습 · 답변용으로 긁는 것으로 알려진 크롤러. 검색 크롤러(Googlebot · Bingbot)는 넣지 않는다 — 그쪽은 meta 가 정한다. */
export const AI_CRAWLERS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'Google-Extended',
  'CCBot',
  'PerplexityBot',
  'Bytespider',
  'Applebot-Extended',
  'meta-externalagent',
  'cohere-ai',
] as const

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/p/', disallow: ['/w/', '/api/', '/login', '/invite'] },
      { userAgent: [...AI_CRAWLERS], disallow: ['/'] },
    ],
  }
}
