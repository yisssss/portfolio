/**
 * typography.js
 *
 * 다국어 혼합 텍스트 파싱 및 렌더링 유틸리티.
 *
 * 사용 예시:
 *   import { renderMixedText, renderTitle, parseText } from "./typography.js";
 *
 *   // 본문 렌더링 (한글 / 영문 자동 분리)
 *   renderMixedText("안녕하세요! Hello, world.", document.querySelector(".my-body"));
 *
 *   // 제목 렌더링 (Gonela, 90pt, 5pt stroke)
 *   renderTitle("PORTFOLIO", document.querySelector(".my-title"));
 *
 *   // 파싱만 할 경우
 *   const segments = parseText("디자인 Design 2025");
 *   // → [{ type:"ko", text:"디자인" }, { type:"en", text:" Design 2025" }]
 */

/**
 * 한글 음절·자모 유니코드 범위를 포함하는 정규식.
 * - AC00-D7A3: 완성형 한글 음절 (가 ~ 힣)
 * - 1100-11FF: 한글 자모 (ㄱ ~ ㅣ 옛 자형 포함)
 * - 3130-318F: 한글 호환 자모 (ㄱ ~ ㅣ 현대)
 * - A960-A97F: 한글 자모 확장 A
 * - D7B0-D7FF: 한글 자모 확장 B
 */
const KO_BLOCK_RE = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]+/g;

/**
 * rawText를 한글(ko)과 비한글(en) 세그먼트 배열로 분리한다.
 *
 * @param {string} rawText
 * @returns {{ type: "ko" | "en", text: string }[]}
 */
export function parseText(rawText) {
    if (!rawText) {
        return [];
    }

    const segments = [];
    let lastIndex = 0;
    let match;

    KO_BLOCK_RE.lastIndex = 0;

    while ((match = KO_BLOCK_RE.exec(rawText)) !== null) {
        if (match.index > lastIndex) {
            segments.push({ type: "en", text: rawText.slice(lastIndex, match.index) });
        }

        segments.push({ type: "ko", text: match[0] });
        lastIndex = KO_BLOCK_RE.lastIndex;
    }

    if (lastIndex < rawText.length) {
        segments.push({ type: "en", text: rawText.slice(lastIndex) });
    }

    return segments;
}

/**
 * rawText를 파싱해 containerEl 내부에
 * .text-en / .text-ko <span> 들을 렌더링한다.
 * containerEl에 .text-body 클래스를 자동으로 추가한다.
 *
 * @param {string}      rawText
 * @param {HTMLElement} containerEl
 */
export function renderMixedText(rawText, containerEl) {
    containerEl.classList.add("text-body");
    containerEl.replaceChildren();

    const fragment = document.createDocumentFragment();

    parseText(rawText).forEach(({ type, text }) => {
        const span = document.createElement("span");

        span.className = type === "ko" ? "text-ko" : "text-en";
        span.textContent = text;
        fragment.append(span);
    });

    containerEl.append(fragment);
}

/**
 * 여러 줄(배열)로 이루어진 혼합 텍스트를 렌더링한다.
 * 각 항목은 <p class="text-body"> 로 감싼다.
 *
 * @param {string[]}    lines
 * @param {HTMLElement} containerEl
 */
export function renderMixedLines(lines, containerEl) {
    containerEl.replaceChildren();

    const fragment = document.createDocumentFragment();

    lines.forEach((line) => {
        const p = document.createElement("p");

        renderMixedText(line, p);
        fragment.append(p);
    });

    containerEl.append(fragment);
}

/**
 * 영문 제목을 Gonela 폰트로 렌더링한다.
 * containerEl에 .text-title 클래스를 추가하고 textContent를 설정한다.
 *
 * @param {string}      text
 * @param {HTMLElement} containerEl
 * @param {{ strokeColor?: string }} [options]
 */
export function renderTitle(text, containerEl, { strokeColor = "currentColor" } = {}) {
    containerEl.classList.add("text-title");
    containerEl.style.webkitTextStroke = `5pt ${strokeColor}`;
    containerEl.textContent = text;
}
