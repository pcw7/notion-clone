# notion-clone

노션과 같은 기능을 하는 웹 애플리케이션. **TypeScript + Next.js**로 만든다.

> 코드보다 기획이 먼저 끝났습니다. 기능 **278개**를 조사·명세하고, 문서 간 모순 **26건**을 판결해 스키마 정본을 확정한 뒤, **MVP 65개 / 6~8주**로 잘라낸 상태에서 시작합니다.

---

## 문서

| 문서 | 내용 |
|---|---|
| [**마스터 기능 명세서**](docs/notion-feature-research.md) | 전체 인벤토리 · 통합 데이터 모델 · 의존 그래프 · 로드맵 · 스택 · 리스크 TOP 7 · 만들지 않을 것 20개 |
| [**정본 데이터 모델**](docs/research/00-canonical-data-model.md) | 테이블 73개. 스키마의 유일한 정답지 |
| [**기능 소유권**](docs/research/00-feature-ownership.md) | F-ID 전수 인벤토리, 확정 난이도/우선순위, MVP 목록 |
| [도메인 상세 01~17](docs/research/) | 블록 에디터 · DB · 권한 · 협업 · 검색 · AI 등 |
| [판결문](docs/research/_canon/) · [커버리지 비평](docs/research/_critique/) | 스키마 모순을 어떻게 판결했는지의 근거 |

---

## 로드맵

| Phase | 목표 | 기간 | 기능 |
|---|---|---|---|
| **0** | MVP — 혼자 쓰는 노션 | 6~8주 | 65 |
| **1** | 협업 — 둘이 쓰는 노션 | 6주 | 47 |
| **2** | 제품화 — 팀이 쓰는 노션 | 12주 | 89 |
| **3** | 확장 · 엔터프라이즈 | 12주+ | 49 |

**Phase 0 주차별**: W1 스키마·인증 → W2 계약 고정 → W3-4 블록 모델·에디터 코어 → W5 페이지 트리 → W6 내비게이션+권한 → W7 검색 → W8 DB 코어+뷰

---

## 스택

```
Next.js(App Router) + TypeScript
  ├─ 에디터   Tiptap v3 (ProseMirror)      — MIT
  ├─ 협업     Yjs + y-prosemirror           — MIT   (Phase 1)
  │           Hocuspocus 자체 호스팅        — MIT
  ├─ UI       TanStack Query/Table/Virtual  — MIT
  │           Radix UI · dnd-kit            — MIT
  ├─ DB       PostgreSQL 16 + pg_bigm       — PostgreSQL License
  ├─ 캐시·큐  Valkey + BullMQ               — BSD-3 / MIT
  └─ 파일     S3 호환 (Cloudflare R2)
```

선택 근거와 **탈락 이유**는 [마스터 문서 §6](docs/notion-feature-research.md)에 있습니다.

---

## 원칙

**무료 라이브러리만 씁니다.** MIT · BSD · Apache-2.0 · ISC · PostgreSQL License만 허용하고, AGPL · SSPL · RSAL · 유료 SaaS 의존은 금지합니다. CI가 자동으로 검사합니다.

**LLM 토큰은 하드 캡입니다.** 한도를 넘으면 자동 결제 없이 차단합니다. 초과분 후불 청구도 하지 않습니다.

자세한 건 [CLAUDE.md](CLAUDE.md).

---

## 개발

**사전 준비**: [Rancher Desktop](https://rancherdesktop.io/) (Container Engine을 `dockerd (moby)`로, Kubernetes는 끔)

```bash
npm install
cp .env.example .env    # AUTH_SECRET 을 생성해 채운다

npm run db:up           # postgres(pg_bigm) + valkey
npm run db:verify       # 확장 · collation · 한국어 2-gram 확인
npm run dev             # http://localhost:3000

npm run check           # typecheck + lint + license
```

Docker Desktop이 아니라 Rancher Desktop을 쓰는 이유는 라이선스입니다 — Docker Desktop은 조건부 무료입니다. 자세한 건 [CLAUDE.md](CLAUDE.md).
