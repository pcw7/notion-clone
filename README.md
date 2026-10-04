# notion-clone

[![CI](https://github.com/pcw7/notion-clone/actions/workflows/ci.yml/badge.svg)](https://github.com/pcw7/notion-clone/actions/workflows/ci.yml)

노션과 같은 기능을 하는 웹 애플리케이션입니다. **Next.js + TypeScript**로 만들고, 실시간 협업은 **Yjs(CRDT)**로 합니다.

기능 278개를 조사하고 스키마 정본을 확정한 뒤 MVP 65개부터 만들었습니다. 지금은 Phase 1(협업)을 진행하고 있습니다.

---

## 주요 기능

**편집**
- 블록 15종 — 문단 · 제목 · 목록 · 할 일 · 토글 · 인용 · 콜아웃 · 구분선 · 이미지 · 코드(문법 강조) · 목차 · 이동 경로
- `/` 메뉴 · 마크다운 단축키 · 드래그 이동 · 구조를 보존하는 복사/붙여넣기
- 페이지 아이콘(이모지 · 이미지), 버전 기록과 되돌리기

**협업**
- 같은 페이지를 여럿이 동시에 편집 — 같은 문단을 함께 쳐도 지워지지 않음
- 저장 버튼 없음 · 끊겨도 친 글은 남았다가 다시 연결되면 서버로
- 코멘트(글자 범위) · `@` 멘션 · 백링크 · 인박스 알림

**페이지와 공유**
- 무한 중첩 페이지 트리 · 사이드바 · 휴지통 · 복제
- 페이지 단위 권한 · 그룹 · 게스트 초대 · 접근 요청 · 잠금
- 팀 공간(공개 · 초대 · 비공개) · 개인 페이지
- 설정 화면 — 내 계정 · 워크스페이스 묶음, 이름 · 정책 · 사람(멤버 · 초대 · 게스트 · 그룹) · 내보내기를 한곳에서
- 테마 — 시스템 · 밝게 · 어둡게(계정마다 · `Ctrl/Cmd+Shift+L`)
- 비밀번호(선택) — 로그인 코드와 함께 · 규칙 체크리스트 · 바꾸면 다른 기기에서 로그아웃
- 2단계 인증 — 인증 앱(QR · 비밀값) · 백업 코드 6개 · 로그인할 때마다 한 번 더
- 워크스페이스 스위처 — 사이드바 머리의 이름 · Ctrl/Cmd + Shift + 숫자
- 다중 계정 — 로그아웃 없이 다른 계정 더하기 · 스위처에서 계정과 워크스페이스를 함께 바꾸기 · 계정마다 로그아웃
- 요금제 — Free · Plus · Business · Enterprise(운영자가 정한다 · 결제 연동 없음) · 버전 보존 일수 · 게스트 한도 · private teamspace · 설정의 요금제 절(지금 요금제 · 쓴 양 · 비교)

**데이터베이스**
- 표 · 목록 · 보드(칸반) 뷰, 필터 · 정렬 · 그룹
- 속성 — 제목 · 글 · 숫자 · 선택 · 상태 · 체크박스 · 날짜 · 관계형 · 롤업
- 템플릿 · 데이터 소스 여러 개 · 소스 휴지통
- 행 페이지 — 표 · 보드에서 "열기"로 열면 본문 위에 그 행의 속성이 선다 · 레이아웃 편집으로 속성을 숨기고 순서를 바꿔 모든 행에 적용

**검색과 내보내기**
- `Cmd+K` 검색 — 한국어 조사를 넘어 찾음 · 여러 말(AND) · `"구절"` · `OR` · `-제외` · 정렬(가장 잘 맞는 순 · 편집 · 만든 때), 볼 수 없는 페이지는 결과에 없음
- Markdown & CSV ZIP 내보내기 — 빠진 것은 보고서에 적힘

---

## 스택

| 영역 | 사용 |
|---|---|
| 앱 | Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 |
| 에디터 | ProseMirror (`@tiptap/pm`) · lowlight + highlight.js |
| 협업 | Yjs · y-prosemirror · Hocuspocus(자체 호스팅) |
| 데이터 | PostgreSQL 16 + pg_bigm(한국어 검색) · Valkey |

무료 라이브러리(MIT · BSD · Apache-2.0 · ISC · PostgreSQL License)만 쓰고, CI가 라이선스를 검사합니다.

---

## 시작하기

Node.js 24.7 이상이 필요합니다(비밀번호 해시에 내장 `crypto.argon2` 를 씁니다). Windows에서는 WSL2 Ubuntu 안의 Docker Engine을 씁니다(설치 방법은 [CLAUDE.md](CLAUDE.md)).

```bash
npm install
cp .env.example .env     # AUTH_SECRET 을 채운다

npm run db:up            # Postgres + Valkey
npm run db:migrate
npm run dev              # http://localhost:3000
npm run collab           # 협업 서버 (ws://localhost:3001)
```

로그인 코드는 메일 대신 `npm run dev` 터미널에 찍힙니다.

**검증**

```bash
npm run check                  # 타입 · 린트 · 라이선스 · 테스트
npm run db:verify:schema       # 스키마 불변식이 실제로 거부하는지
npm run plan:set -- <워크스페이스 id> <free|plus|business|enterprise>   # 요금제 바꾸기(운영자 · 결제 연동 없음)
npm run build && npm run e2e   # 실제 브라우저(CDP)로 화면 검증
```

---

## 진행 상황

| Phase | 목표 | 상태 |
|---|---|---|
| 0 | MVP — 혼자 쓰는 노션 | ✅ |
| 1 | 협업 — 둘이 쓰는 노션 | 진행 중 |
| 2 | 제품화 — 팀이 쓰는 노션 | |
| 3 | 확장 · 엔터프라이즈 | |

마이그레이션 48개 · 테스트 2,600개 · 브라우저 검증 1,106개 · PR 180개 머지. 조각별 진행은 [인수인계 문서](docs/HANDOFF.md)에 있습니다.

---

## 설계 원칙

- **스키마는 SQL로 씁니다.** ORM 없이 raw SQL 마이그레이션 — 부분 인덱스 · 지연 제약 트리거 같은 것을 그대로 씁니다.
- **불변식은 DB가 막습니다.** `CHECK` · 트리거를 걸고, [검증 스크립트](scripts/verify-schema.mjs)가 위반을 실제로 던져 거부되는지 봅니다.
- **권한은 쿼리 안에서 거릅니다.** 볼 수 없는 것은 목록 · 검색 · 내보내기 결과로 나오지 않습니다.
- **권한 레벨은 비교하지 않습니다.** 판정은 capability 하나(`can(caps, 'edit_content')`)로만 합니다.
- **본문의 정본은 Y.Doc입니다.** 표의 블록 행은 그 투영입니다.
- **검사는 반사실로 확인합니다.** 방어 코드를 빼고 돌려 그 검사가 실제로 떨어지는지 봅니다.
- **LLM 토큰은 하드 캡입니다.** 한도를 넘으면 자동 결제 없이 멈춥니다.

---

## 문서

| 문서 | 내용 |
|---|---|
| [인수인계](docs/HANDOFF.md) | 진행 위치 · 다음 작업 · 내린 판결 · 알려진 부채 |
| [마스터 기능 명세서](docs/notion-feature-research.md) | 기능 인벤토리 · 로드맵 · 스택 선택 근거 |
| [정본 데이터 모델](docs/research/00-canonical-data-model.md) | 스키마의 유일한 정답지 |
| [도메인 상세](docs/research/) | 블록 에디터 · 데이터베이스 · 권한 · 협업 · 검색 등 |
| [CLAUDE.md](CLAUDE.md) | 절대 제약 · 코딩 규칙 · 개발 환경 |
