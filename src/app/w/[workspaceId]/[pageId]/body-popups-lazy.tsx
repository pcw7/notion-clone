'use client'

/**
 * 본문 편집기 밖 팝업의 지연 로드 (BX-2) — 열 때만 받는다. 페이지의 첫 JS 예산을 쓰지 않는다.
 * 모두 `editable && …Ui !== null` 처럼 사용자가 연 뒤에야 그려진다(서버 렌더에는 나오지 않는다).
 */

import dynamic from 'next/dynamic'

export const ButtonBlockSettingsLazy = dynamic(() => import('./button-block-settings').then((m) => m.ButtonBlockSettings))
export const EquationEditorLazy = dynamic(() => import('./equation-editor').then((m) => m.EquationEditor))
export const LinkedDatabasePickerLazy = dynamic(() => import('./linked-database-picker').then((m) => m.LinkedDatabasePicker))
export const EmojiPickerLazy = dynamic(() => import('./emoji-picker').then((m) => m.EmojiPicker))
export const CodeLanguageMenuLazy = dynamic(() => import('./code-language-menu').then((m) => m.CodeLanguageMenu))
export const CodeCaptionEditorLazy = dynamic(() => import('./code-caption-editor').then((m) => m.CodeCaptionEditor))
export const ImageAltDialogLazy = dynamic(() => import('./image-alt-dialog').then((m) => m.ImageAltDialog))
// 제안의 카드 · 목록(SG-3) — 마크에 올리거나 "제안 n개" 를 누른 뒤에야 선다
export const SuggestionCardLazy = dynamic(() => import('./suggestion-card').then((m) => m.SuggestionCard))
export const SuggestionPanelLazy = dynamic(() => import('./suggestion-panel').then((m) => m.SuggestionPanel))
