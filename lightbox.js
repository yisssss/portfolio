const LIGHTBOX_IMAGE_SELECTOR = "img, [data-lightbox-src]";
const EXCLUDED_IMAGE_SELECTOR = [
    ".header-letter-img",
    ".scroll-hint-arrow",
    ".more-arrow",
    ".tag-rail__scroll-img",
    ".work-item__thumb",
    ".project-more__thumb"
].join(",");
const RASTER_IMAGE_RE = /\.(avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i;

let lightboxRoot = null;
let lightboxImg = null;
let lastFocusedElement = null;

function isRasterImage(src) {
    return typeof src === "string" && RASTER_IMAGE_RE.test(src);
}

function getLightboxTarget(eventTarget) {
    const target = eventTarget.closest?.(LIGHTBOX_IMAGE_SELECTOR);

    if (!target) {
        return null;
    }

    const src = target.dataset?.lightboxSrc || target.currentSrc || target.src;

    if (!isRasterImage(src) || target.matches?.(EXCLUDED_IMAGE_SELECTOR)) {
        return null;
    }

    return {target, src};
}

function ensureLightbox() {
    if (lightboxRoot) {
        return;
    }

    lightboxRoot = document.createElement("div");
    lightboxRoot.className = "image-lightbox";
    lightboxRoot.setAttribute("aria-hidden", "true");

    const button = document.createElement("button");
    button.className = "image-lightbox__close";
    button.type = "button";
    button.setAttribute("aria-label", "확대 이미지 닫기");
    button.textContent = "CLOSE";

    lightboxImg = document.createElement("img");
    lightboxImg.className = "image-lightbox__img";
    lightboxImg.alt = "";

    lightboxRoot.append(button, lightboxImg);
    document.body.appendChild(lightboxRoot);

    lightboxRoot.addEventListener("click", (event) => {
        if (event.target === lightboxRoot || event.target === button) {
            closeLightbox();
        }
    });
}

function openLightbox(src) {
    ensureLightbox();

    lastFocusedElement = document.activeElement;
    lightboxImg.src = src;
    lightboxRoot.classList.add("image-lightbox--open");
    lightboxRoot.setAttribute("aria-hidden", "false");
    document.body.classList.add("image-lightbox-open");
    lightboxRoot.querySelector(".image-lightbox__close")?.focus();
}

function closeLightbox() {
    if (!lightboxRoot) {
        return;
    }

    lightboxRoot.classList.remove("image-lightbox--open");
    lightboxRoot.setAttribute("aria-hidden", "true");
    document.body.classList.remove("image-lightbox-open");
    lightboxImg.removeAttribute("src");

    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
        lastFocusedElement.focus();
    }
}

document.addEventListener("click", (event) => {
    const lightboxTarget = getLightboxTarget(event.target);

    if (!lightboxTarget) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    openLightbox(lightboxTarget.src);
}, true);

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeLightbox();
    }
});
