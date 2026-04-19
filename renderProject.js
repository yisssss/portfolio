import { projects } from "./data.js";
import { renderMixedLines } from "./typography.js";

// ── 1. URL 파라미터로 프로젝트 조회 ────────────────────────────────────────
const params  = new URLSearchParams(window.location.search);
const id      = params.get("id");
const project = projects.find(p => p.id === id);

if (!project) {
    document.title = "Not Found — PARK SEJEONG";
    document.querySelector(".project-main").innerHTML =
        `<p style="padding:220px 64px 0;font-size:13px;color:#e8261c;">
            Project not found. <a href="./index.html" style="color:inherit;">← Back</a>
         </p>`;
} else {
    renderProject(project);
}

// ── 2. 전체 렌더링 오케스트레이터 ──────────────────────────────────────────
function renderProject(p) {
    setPageTitle(p);
    renderIntroTitle(p);
    renderIntroMeta(p);
    renderImageBlocks(p.imageBlocks || []);
    renderSideMeta(p);
    renderBodyText(p);
    renderFooter(p);
}

// ── 3. 페이지 <title> + SVG aria-label ─────────────────────────────────────
function setPageTitle(p) {
    document.title = `${p.title} — PARK SEJEONG`;
    const svg = document.getElementById("proj-title-svg");
    if (svg) svg.setAttribute("aria-label", p.title);
}

// ── 4. 대형 SVG 타이틀 ─────────────────────────────────────────────────────
function renderIntroTitle(p) {
    const textEl = document.getElementById("proj-title-text");
    if (textEl) textEl.textContent = p.title;
}

// ── 5. 인트로 메타 칸 (Col 1, Col 4, Col 5) ────────────────────────────────
function renderIntroMeta(p) {
    const hasTeam = Array.isArray(p.teammates) && p.teammates.length > 0;

    // Col 1
    const col1 = document.getElementById("proj-meta-col1");
    if (col1) {
        col1.innerHTML =
            `<p class="proj-label">${hasTeam ? "PROJECT (+TEAM)" : "PROJECT"}</p>
             <p class="proj-name">${p.title}</p>
             <p class="proj-sub">${p.category || p.subtitle || ""}</p>`;
    }

    // Col 4: 연도
    const colYear = document.getElementById("proj-meta-year");
    if (colYear) {
        colYear.innerHTML =
            `<p class="proj-label">YEAR</p>
             <p class="proj-value">${p.year || ""}</p>`;
    }

    // Col 5: 서비스 (services 배열 또는 tags 배열 fallback)
    const colSvc = document.getElementById("proj-meta-services");
    if (colSvc) {
        const svcList = (p.services || p.tags || []).join(",<br>");
        colSvc.innerHTML =
            `<p class="proj-label">SERVICES</p>
             <p class="proj-value">${svcList}</p>`;
    }
}

// ── 6. 이미지 블록 동적 생성 ───────────────────────────────────────────────
//
//  imageBlock 스키마:
//  {
//    layout : "full-bleed" | "padded"   — 좌우 여백 유무
//    hero   : true | false              — true 시 뷰포트 높이에 맞는 대형 이미지
//    count  : 1 | 2 | 3                — 한 줄 이미지 개수
//    images : string[]                  — 이미지 경로 (없으면 null → 플레이스홀더)
//  }
function renderImageBlocks(imageBlocks) {
    const container = document.getElementById("proj-image-blocks");
    if (!container) return;
    container.innerHTML = "";

    imageBlocks.forEach(block => {
        // 외부 래퍼: full-bleed vs padded
        const wrap = document.createElement("div");
        wrap.className = [
            "img-block",
            `img-block--${block.layout || "full-bleed"}`,
            block.hero ? "img-block--hero" : ""
        ].filter(Boolean).join(" ");

        // 이너 그리드
        const grid = document.createElement("div");
        grid.className = `img-block__grid img-block__grid--count-${block.count || 1}`;
        grid.style.gridTemplateColumns = `repeat(${block.count || 1}, 1fr)`;

        const srcs = block.images || Array(block.count || 1).fill(null);
        srcs.forEach(src => {
            const cell = document.createElement("div");
            cell.className = "img-block__img";

            if (src) {
                const img = document.createElement("img");
                img.src  = src;
                img.alt  = "";
                img.loading = "lazy";
                cell.appendChild(img);
            }
            grid.appendChild(cell);
        });

        wrap.appendChild(grid);
        container.appendChild(wrap);
    });
}

// ── 7. 본문 Col 1: 메타 + 팀원 ─────────────────────────────────────────────
function renderSideMeta(p) {
    const el = document.getElementById("proj-side-meta");
    if (!el) return;

    const hasTeam = Array.isArray(p.teammates) && p.teammates.length > 0;

    let html =
        `<div>
            <p class="proj-label">${hasTeam ? "PROJECT (+TEAM)" : "PROJECT"}</p>
            <p class="proj-name">${p.title}</p>
            <p class="proj-sub">${p.category || p.subtitle || ""}</p>
         </div>`;

    if (hasTeam) {
        const names = p.teammates
            .map(name => `<p class="proj-value">${name}</p>`)
            .join("");
        html += `<div><p class="proj-label">TEAMMATE</p>${names}</div>`;
    }

    el.innerHTML = html;
}

// ── 8. 본문 텍스트: typography.js 의 renderMixedLines 으로 연동 ─────────────
function renderBodyText(p) {
    const leftEl  = document.getElementById("proj-col-left");
    const rightEl = document.getElementById("proj-col-right");

    const leftParas  = p.content?.leftCol  || [];
    const rightParas = p.content?.rightCol || [];

    // typography.js 는 기존 innerHTML 을 지우고 span 분리 렌더링
    if (leftEl  && leftParas.length)  renderMixedLines(leftParas,  leftEl);
    if (rightEl && rightParas.length) renderMixedLines(rightParas, rightEl);
}

// ── 9. 하단 링크 + 관련 작업물 ─────────────────────────────────────────────
function renderFooter(p) {
    renderVisitLink(p);
    renderRelated(p);
}

function renderVisitLink(p) {
    const link = document.getElementById("proj-visit-link");
    if (!link) return;

    if (p.websiteLink) {
        link.href        = p.websiteLink;
        link.textContent = "VISIT THE WEBSITE ↗";
        link.style.display = "";
    } else {
        link.style.display = "none";
    }
}

function renderRelated(p) {
    const el = document.getElementById("proj-more");
    if (!el) return;

    const myTags = p.tags || [];
    const related = projects
        .filter(proj => proj.id !== p.id && proj.tags?.some(t => myTags.includes(t)))
        .slice(0, 2);

    if (!related.length) return;

    const gridHtml = related.map(proj => `
        <a class="work-item" href="./project.html?id=${proj.id}">
            <div class="work-item__thumb project-more__thumb"></div>
            <div class="work-item__meta">
                <span class="work-item__title">${proj.title}</span>
                <span class="work-item__year">${proj.year}</span>
            </div>
            <p class="work-item__subtitle">${proj.subtitle}</p>
        </a>
    `).join("");

    el.innerHTML =
        `<p class="project-more__label">MORE <img src="./assets/svg/right arrow.svg" class="more-arrow" alt=""></p>
         <div class="project-more__grid">${gridHtml}</div>`;
    el.style.display = "";
}
