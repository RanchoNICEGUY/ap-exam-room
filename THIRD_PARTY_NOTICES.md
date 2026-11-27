# Third-Party Notices & Icon / Trademark Attribution

**AP Exam Room (`ap-exam-room`)** is an independent, local-first AP exam practice runner.  
This project is **NOT affiliated with, endorsed by, or sponsored by College Board**, **Desmos Studio PBC**, or **Khan Academy**.

> **Important Question Bank Notice:** This repository contains **software only** plus **3 tiny 100% original sample walkthrough sets** (`Source/Data/exams/demo_*.json`). No proprietary College Board, commercial, or third-party AP question banks, answer keys, or PDF files are distributed here.

---

## 1. College Board / Bluebook®-Style Icons & Visual Assets

All trademarked or College Board / Bluebook®-styled SVG assets remain the intellectual property of their respective trademark/copyright holders (**AP®**, **College Board®**, and **Bluebook™** are registered trademarks of College Board) and are **excluded from the MIT License**.

| File Path | Asset Type / Origin | Active UI Status | Notes |
| --- | --- | --- | --- |
| `Source/Assets/Bluebook_Logo_Mark.svg` | College Board Bluebook™ logo mark | **Unused in active UI** | Retained in repository for attribution/reference; active app brand uses original `Source/Assets/RoomMark.svg` and `Source/AppIcon.svg`. |
| `Source/Assets/face-excellent.svg` | Bluebook™-style smiling completion mascot SVG | **Active** (Exam Completion screen) | Injected via `Source/build.py` on `.completion-face`. Proprietary visual motif; replace if distributing commercially. |
| `Source/Assets/book-open.svg` | Bluebook™-style 48×48 duotone UI icon | Unused legacy asset | Retained in `Source/Assets/` (`#e6f1fa` + `#1d1e1e` duotone set). |
| `Source/Assets/checklist-doc.svg` | Bluebook™-style 48×48 duotone UI icon | Unused legacy asset | Retained in `Source/Assets/`. |
| `Source/Assets/clock.svg` | Bluebook™-style 48×48 UI icon | Unused legacy asset | Retained in `Source/Assets/`. |
| `Source/Assets/download.svg` | Bluebook™-style 48×48 UI icon | Unused legacy asset | Retained in `Source/Assets/`. |
| `Source/Assets/graph-bar.svg` | Bluebook™-style 48×48 duotone UI icon | Unused legacy asset | Retained in `Source/Assets/`. |
| `Source/Assets/laptop-check.svg` | Bluebook™-style 48×48 duotone UI icon | Unused legacy asset | Retained in `Source/Assets/`. |
| `Source/Assets/lock.svg` | Bluebook™-style 48×48 UI icon | Unused legacy asset | Retained in `Source/Assets/`. |
| `Source/Assets/practice.svg` | Bluebook™-style 48×48 duotone UI icon | Unused legacy asset | Retained in `Source/Assets/`. |

### Original Project Branding & Subject Icons (MIT-Compatible)

| File Path | Description |
| --- | --- |
| `Source/AppIcon.svg`, `Source/Icon/*`, `Source/Assets/AppIcon-*.png` | Original macOS/Web App icon designed specifically for **AP 模考室 / AP Exam Room** (indigo gradient book/frame emblem with gold bookmark ribbon). |
| `Source/Assets/RoomMark.svg` | Original sidebar/header mark derived from `AppIcon.svg`. |
| `Source/Assets/icons/*.svg` (`calc_bc.svg`, `chem.svg`, `csa.svg`, `desmos.svg`, `reference.svg`, `stats.svg`, etc.) | Minimal custom 24×24 geometric duotone subject & toolbar icons created for this project (`#eef2ff` / `#153455` / `#324EC7` / `#fddb00`). |
| `Source/Assets/answer-correct.wav`, `Source/Assets/answer-incorrect.wav` | Synthesized local UI sound cues. |

---

## 2. Bundled Third-Party Libraries & Engines

| Component | Path(s) | License / Terms | Attribution |
| --- | --- | --- | --- |
| **Desmos® Calculator API** | `Source/Assets/desmos.js` | Proprietary / Desmos API Terms (Trial API key included; **not MIT**) | Desmos Studio PBC — embedded for Graphing & Scientific Calculator. An original offline canvas graphing & scientific calculator fallback is built into `Source/BluebookTools.js` if `desmos.js` is absent or offline without trial bundle. |
| **KaTeX** | `Source/Assets/katex.min.js`, `Source/Assets/katex.min.css`, `Source/Assets/fonts/*.woff2` | MIT License | Khan Academy / KaTeX Contributors |
| **Mozilla PDF.js** | `Source/Assets/pdfjs/` | Apache License 2.0 | Mozilla and individual contributors |
| **Perseus Renderer** | Embedded in `Source/template.html` | MIT License | Khan Academy |
| **Three.js** | `Source/Pets/vendor/three.module.js`, `GLTFLoader.js`, `BufferGeometryUtils.js` | MIT License | Three.js Authors |
| **3D Companion Models & Portraits** | `Source/Pets/models/*.glb`, `Source/Pets/portraits/*.png`, `Source/Assets/RoomPets.js` | Separate non-MIT 3D character assets (retained for local study-companion widget) | Replace or disable via Settings (`roomPetsAllowed`) before commercial redistribution. |
