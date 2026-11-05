"use client";

/**
 * 알림 받기 — 페이지 메뉴("···")의 라디오 셋 (39번 트랙 NM-1 · F-05-17 · 정본 §3.8 [보강 NM-1] ④)
 *
 * 모든 코멘트 · 답글과 멘션(기본) · 끄기. 볼 수 있는 사람이면 누구나(게스트도) 고른다 — 라우트가 다시 묻는다. 지금 값은 서버가 그릴 때
 * 읽어 내려 준다(따로 불러오지 않는다). 고르면 화면이 먼저 바뀌고 거부되면 되돌린다. "끄기"는 이 페이지의 멘션 · 답글도 막는다 — 팬아웃이
 * 처음부터 그렇게 한다(N1)이므로 화면이 그렇게 말한다.
 *
 * 메뉴 카드는 `role="group"` 이라 줄 역할은 `radio`(+ `radiogroup`)로 둔다 — `menuitemradio` 는 `menu` 안에서만 맞다.
 */

import { useRef, useState } from "react";

import type { PageSubscriptionLevel } from "@/lib/notification/subscription";
import { MENU_ROW } from "./page-menu";

const OPTIONS: readonly {
  readonly level: PageSubscriptionLevel;
  readonly label: string;
  readonly hint?: string;
}[] = [
  { level: "all_comments", label: "모든 코멘트" },
  { level: "replies_and_mentions", label: "답글과 멘션" },
  { level: "none", label: "끄기", hint: "멘션과 답글도 받지 않습니다" },
];

export function NotifyMeControl({
  workspaceId,
  pageId,
  initial,
}: {
  workspaceId: string;
  pageId: string;
  initial: PageSubscriptionLevel;
}) {
  const [level, setLevel] = useState<PageSubscriptionLevel>(initial);
  const [error, setError] = useState<string | null>(null);
  // 빠르게 연달아 고르면 마지막 요청만 화면을 쥔다 — 늦게 돌아온 앞 응답이 되돌림으로 덮지 않는다
  const seq = useRef(0);

  const choose = async (next: PageSubscriptionLevel): Promise<void> => {
    if (next === level) return;
    const before = level;
    const mine = ++seq.current;
    setLevel(next);
    setError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/pages/${pageId}/subscription`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ level: next }),
        },
      );
      if (!res.ok && mine === seq.current) {
        setLevel(before);
        setError("알림 설정을 저장하지 못했습니다.");
      }
    } catch {
      if (mine === seq.current) {
        setLevel(before);
        setError("연결에 실패했습니다.");
      }
    }
  };

  return (
    <div
      className="flex flex-col"
      data-testid="notify-me"
      role="radiogroup"
      aria-label="알림 받기"
    >
      <div className="px-2 pb-0.5 pt-1 text-xs text-neutral-400">알림 받기</div>
      {OPTIONS.map(({ level: value, label, hint }) => (
        <div key={value} className="flex flex-col">
          <button
            type="button"
            role="radio"
            aria-checked={level === value}
            data-testid={`notify-me-${value}`}
            onClick={() => void choose(value)}
            className={`${MENU_ROW} justify-between`}
          >
            {label}
            <span
              aria-hidden
              className="w-4 text-center text-blue-600 dark:text-blue-400"
            >
              {level === value ? "✓" : ""}
            </span>
          </button>
          {hint !== undefined && (
            <p className="px-2 pb-1 text-xs leading-snug text-neutral-400">
              {hint}
            </p>
          )}
        </div>
      ))}
      {error !== null && (
        <p
          role="alert"
          data-testid="notify-me-error"
          className="px-2 py-1 text-xs text-red-600"
        >
          {error}
        </p>
      )}
    </div>
  );
}
