import {renderMixedLines} from "./typography.js";

const LEFT_PARAGRAPHS = ["박세정은 세상을 관찰하고 포착하여 디지털 화면 위에 구현하는 일을 좋아하는 디자이너입니다. 출판물부터 웹까지 다양한 형식을 오가며, 각각의 프로젝트가 기술의 틀에 얽매이지 않고 고유한 시각 언어를 가질 수 있도록 접근합니다. 본질적이고 단순한 구조 안에서 예기치 않은 움직임과 질감을 찾는 것을 즐깁니다.", "현재 서울을 기반으로 활동하며 프리랜서 작업 기회를 찾고 있습니다. 그래픽, 웹, 영상, 설치 등 매체를 가리지 않고 함께 만들어갈 수 있는 작업이라면 언제든지 연락 주세요."];
const RIGHT_PARAGRAPHS = [  "Park Sejeong is a designer interested in observing the world and translating those observations into digital experiences. Working across print, web, and digital media, each project is approached as an opportunity to develop its own visual language. Particularly interested in discovering unexpected movement and texture within simple, essential structures.", "Based in Seoul. Available for freelance and collaborative opportunities across graphic design, web, video, and installation projects. Feel free to get in touch."];
const leftEl = document.getElementById("about-col-left");
const rightEl = document.getElementById("about-col-right");

if (leftEl) {
    renderMixedLines(LEFT_PARAGRAPHS, leftEl);
}
if (rightEl) {
    renderMixedLines(RIGHT_PARAGRAPHS, rightEl);
}
