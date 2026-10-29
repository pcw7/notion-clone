-- 데이터베이스 블록도 휴지통에 간다 — 26번 트랙 인라인 데이터베이스 I-1 (F-04-14)
--
-- 정본: docs/research/00-canonical-data-model.md §3.5 [보강 I-1] ④ · 판결 X-3
--
-- 0006 의 `ck_lifecycle_page` 는 페이지만 휴지통에 갈 수 있게 했다(본문 블록은 지우고, 페이지는 버린다 — X-3). 인라인 데이터베이스는
-- 페이지 본문의 참조 노드로 서므로(하위 페이지와 같은 모양) 본문에서 참조를 지우면 하위 페이지처럼 **휴지통으로** 가야 한다 — 지우면
-- CASCADE 로 데이터 소스 · 속성 · 뷰 · 행이 통째로 사라진다. 부모 페이지를 버릴 때도 함께 간다. 그래서 데이터베이스 블록에도 휴지통 상태를
-- 연다. 본문 블록(문단 · 목록 …)은 여전히 live 만이다.
--
-- 기존 행: 바뀌는 것이 없다(넓히기만 한다). 프로브는 verify-schema 의 [41b].

ALTER TABLE block DROP CONSTRAINT ck_lifecycle_page;
ALTER TABLE block
  ADD CONSTRAINT ck_lifecycle_page CHECK (type IN ('page', 'database') OR lifecycle = 'live');
