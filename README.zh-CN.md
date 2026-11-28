<p align="center">
  <img src="Source/Icon/master-1024.png" width="112" height="112" alt="AP 模考室图标">
</p>

<h1 align="center">AP 模考室 · AP Exam Room</h1>

<p align="center">
  <a href="README.md">English</a> | <strong>简体中文</strong>
</p>

<p align="center">
  <strong>本地优先、Bluebook 风格的跨平台 AP 刷题与模考软件（支持 macOS 原生应用、Windows 零依赖独立版与 Web / iPad 局域网）。</strong><br>
  <em>纯软件开源仓库，不包含任何真实 AP 题库、真题卷或商用 PDF；内置 3 套 100% 原创演示样例（Demo）用于界面与功能演示。</em>
</p>

---

## 免责声明（Disclaimer）

1. **非官方与无关联声明**  
   **AP 模考室（AP Exam Room）** 为独立开源学习工具，与 **College Board**、**Desmos Studio PBC**、**Khan Academy** 或 **Mozilla** **没有任何隶属、授权、赞助或官方合作关系**。
2. **商标归属**  
   **AP®**、**Advanced Placement®**、**College Board®** 与 **Bluebook™** 均为 College Board 的注册商标；**Desmos®** 为 Desmos Studio PBC 的注册商标。上述名称与风格引用仅用于说明软件交互灵感及内置兼容组件，商标版权归原权利人所有。
3. **仅含软件程序、不含任何真实题库**  
   本仓库及所有 Release 压缩包**仅包含软件源码、可执行包装与 3 套自编原创最小演示卷**（`Source/Data/exams/demo_calc_bc.json`、`demo_stats.json`、`demo_csa.json`），不包含任何 College Board 官方真题、第三方商用模考题库、标准答案集或课程 PDF/视频。  
   用户通过 **Question Bank → Import JSON** 或本地目录关联方式自行导入的试题与 PDF 文件，其版权合法性与合规使用由**用户本人全权负责**。
4. **“按现状”提供与责任限制**  
   本软件依据 [LICENSE](LICENSE) **按“现状”（AS IS）提供，不附带任何明示或暗示担保**。软件内的计时机制、界面样式与自动批改结果**不等同于 College Board 官方 Bluebook™ 机考评分与考场规则**；因软件故障、误操作或浏览器清理导致的数据丢失或备考偏差，作者不承担任何责任（建议定期在 **Settings → Download Backup** 导出本地备份）。

---

## CB / Bluebook® 风格图标与第三方素材标注

所有非原创图标及嵌入的第三方开源/试用库均已在 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 逐项列明，**不适用本仓库的 MIT 开源协议**：

| 文件 / 路径 | 来源与性质 | 当前界面使用状态 | 许可范围说明 |
| --- | --- | --- | --- |
| `Source/Assets/face-excellent.svg` | College Board / Bluebook™ 风格完卷笑脸插画 | **使用中**（完卷提示页 `.completion-face`） | CB 风格视觉素材（**非 MIT**）；如需商用再分发请自行替换 |
| `Source/Assets/Bluebook_Logo_Mark.svg` | College Board Bluebook™ 品牌标识 | **未启用**（仅保留原文件备查） | CB 商标图形（**非 MIT**）；软件实际使用原创 `RoomMark.svg` |
| `Source/Assets/book-open.svg`、`checklist-doc.svg`、`clock.svg`、`download.svg`、`graph-bar.svg`、`laptop-check.svg`、`lock.svg`、`practice.svg` | Bluebook™ 风格 48×48 双色 SVG 图标 | **未启用**（历史残留参考素材） | CB 风格 SVG 素材（**非 MIT**），按原样保留并标注来源 |
| `Source/AppIcon.svg`、`Source/Icon/*`、`Source/Assets/RoomMark.svg`、`Source/Assets/icons/*.svg` | 原创 **AP 模考室** App 图标与科目/工具栏几何图标 | **使用中** | 本项目原创图标（兼容 MIT） |
| `Source/Assets/desmos.js` | Desmos® Calculator API（含试用 Key） | **使用中**（内含开源画布兜底） | Desmos Studio PBC 专有条款（**非 MIT**） |
| `Source/Assets/pdfjs/` | Mozilla PDF.js | **使用中**（Windows / Web PDF 引擎） | Apache License 2.0 |
| `Source/Assets/katex.*`、`Source/Assets/fonts/` | KaTeX 数学公式渲染库 | **使用中** | MIT License |
| Perseus 渲染器（内嵌于 `Source/template.html`） | Khan Academy Perseus | **使用中** | MIT License |
| `Source/Pets/`、`Source/Assets/RoomPets.js` | Three.js（MIT）+ 3D 伴学小宠模型与头像 | **使用中**（可在 Settings 关闭） | Three.js 为 MIT；`.glb`/`.png` 角色模型为独立非 MIT 素材 |

---

## 下载 Release 预编译版本（`v1.1.0`）

macOS、Windows（零依赖）与跨平台便携网页版均已在 [GitHub Releases](https://github.com/RanchoNICEGUY/ap-exam-room/releases/latest) 发布：

| 平台 | Release 安装包 | 运行依赖 | 说明 |
| --- | --- | --- | --- |
| **Windows 10 / 11** | `AP-Exam-Room-Windows-ZeroDep-v1.1.0.zip` | 系统自带 PowerShell + Edge / Chrome | **零额外依赖**（无需 Python / Node / 管理员权限），解压后双击 `Start-APExamRoom.bat` 即用 |
| **macOS**（桌面原生端） | `AP-Exam-Room-macOS-v1.1.0.zip` | macOS 13+ | 原生 Swift + `WKWebView` + PDFKit 封装（`AP 模考室.app`），统一透明标题栏，首次打开需清除隔离属性（见下方） |
| **跨平台 Web / iPad** | `AP-Exam-Room-Portable-Web-v1.1.0.zip` | Python 3 + 现代浏览器 | 运行 `python3 dev_server.py --lan` 可在同一 Wi-Fi 下的 iPad Safari 添加到主屏幕使用 |

### 各平台安装与使用说明

#### 1. Windows 零依赖版（推荐 Windows 用户）
1. 下载并解压 `AP-Exam-Room-Windows-ZeroDep-v1.1.0.zip` 到任意本地文件夹（例如 `D:\AP-Exam-Room\`）。
2. 双击 **`Start-APExamRoom.bat`**：将自动通过 PowerShell 启动本地 HTTP 服务并在独立浏览器应用窗口中打开。
3. *（可选）* 双击 `设置题库PDF路径.bat` 选择你自备的本地 PDF 题库目录，程序内置离线 PDF.js 直接渲染。
4. *（可选）* 安装任意免费 JDK（`javac.exe`，如 Eclipse Temurin JDK 17/21）后，即可在 AP CSA FRQ 中点击 **Run Java** 本地编译运行。

#### 2. macOS 原生客户端
1. 下载解压 `AP-Exam-Room-macOS-v1.1.0.zip`，将 `AP 模考室.app` 拖入 `/Applications`。
2. 由于开源版采用本地自签名（Ad-hoc）而非 Apple 付费公证，首次打开若提示“已损坏”或“无法验证开发者”，请在终端执行一次清理隔离属性：
   ```bash
   xattr -cr "/Applications/AP 模考室.app"
   open "/Applications/AP 模考室.app"
   ```
   或直接从源码编译（需已安装 Xcode 命令行工具与 Python 3）：
   ```bash
   cd Source && bash build-app.sh
   ```

#### 3. iPad / 跨平台局域网模式
```bash
python3 dev_server.py --lan   # 在局域网暴露 http://<本机IP>:18990/index.html
```
使用 iPad Safari 打开同一局域网地址，点击 **分享 → 添加到主屏幕** 即可作为全屏 PWA 使用。

---

## 核心功能亮点

- **学习统计与交互热力图（`Stats.js`）**：类 Anki 年度刷题热力图（支持题目数/套卷数切换）、每日目标圆环、分科目完成度、正确率及单题耗时统计（`min/Q`）。
- **首次引导与个人学习目标（`Settings.js`）**：内置新手引导弹窗，支持昵称预览、跟随系统的浅色/深色主题、每日刷题目标（`10–50 Qs/day`）与重点学科侧边栏置顶。
- **高度还原的机考作答体验**：双栏/单栏自适应题面、KaTeX 公式渲染、持久化 `ABC` 选项划除、Mark for Review 书签、文本高亮与草稿笔记抽屉、题号网格导航，macOS 端配备一体化透明标题栏并自动联动系统 `NSAppearance`。
- **可流畅拖拽与动画侧边停靠的工具弹窗**：Desmos 图形/科学计算器（附离线画布兜底）与公式速查弹窗全面支持 Pointer Events 拖拽、拖至左右边缘触发半透明停靠预览与主区域平滑让位、拖拽分隔条调宽，且进入 *Check Your Work* 等非作答页面时自动全部收起。
- **练习即时反馈 + 撒花动画**：开启练习模式点击 **Check Answer** 弹出全宽反馈底栏，**Continue** 零像素对齐覆盖原按钮实现原位连续点击，展开平滑解析抽屉并触发音效与 2× 视网膜画布撒花特效。
- **AP CSA Java 交互编辑器**：支持输入 Java 方法或片段并调用本机 `javac` / `java` 实时输出编译/运行结果，支持 FRQ 视频讲解懒加载抽屉。
- **双栏 PDF 刷题模式**：macOS 使用原生 PDFKit（`pdf_helper.swift`），Windows 与便携 Web 使用内置离线 PDF.js，右侧配套交互答题卡与 FRQ 评分细则核对。
- **错题本、历史记录与 Anki 一键导出**：SQLite 多端同步持久化（`History.swift` / `dev_server.py`）、错题一键收藏与专项重练、JSON 备份还原及 AnkiConnect 推送。

---

## 全界面截图展示

以下 18 张 2× Retina 截图均基于仓库自带的 **3 套原创演示卷（Demo）** 在无头 Chromium 下实拍：

### 1. 首次引导、题库首页与开考设置

| 首次使用引导设置 | 题库主页（浅色） | 题库主页（深色） | 模考 / 练习设置弹窗 |
| :---: | :---: | :---: | :---: |
| ![Onboarding Wizard](docs/screenshots/00-onboarding-wizard.png) | ![Question Bank Light](docs/screenshots/01-question-bank-light.png) | ![Question Bank Dark](docs/screenshots/02-question-bank-dark.png) | ![Test Setup](docs/screenshots/03-test-setup-dialog.png) |

### 2. 作答区、即时批改与侧边停靠弹窗

| Section I 单选作答界面 | 即时批改反馈（撒花 + 展开解析） | Desmos 右侧停靠 + 公式窗浮动（浅色） |
| :---: | :---: | :---: |
| ![Exam MCQ](docs/screenshots/04-exam-mcq-light.png) | ![Practice Feedback](docs/screenshots/05-practice-feedback-correct.png) | ![Desmos Dock Right Light](docs/screenshots/06-desmos-side-dock-light.png) |

| Desmos 左侧停靠（深色） | 题号快速跳转导航 | Check Your Work（弹窗自动收起） |
| :---: | :---: | :---: |
| ![Desmos Dock Left Dark](docs/screenshots/07-desmos-side-dock-dark.png) | ![Navigator](docs/screenshots/08-question-navigator.png) | ![Check Your Work](docs/screenshots/09-check-your-work.png) |

### 3. 休息倒计时、AP CSA Java 编辑器与完卷页

| 节间休息倒计时 | AP CSA Java FRQ 编辑器 | 完卷页（含已标注的 CB 风格 `face-excellent.svg`） |
| :---: | :---: | :---: |
| ![Break Screen](docs/screenshots/10-break-screen.png) | ![CSA FRQ](docs/screenshots/11-frq-csa-code-editor.png) | ![Completion](docs/screenshots/12-completion-screen.png) |

### 4. 学习统计热力图、成绩总览、错题本、测试历史与设置

| 学习统计与热力图 | 成绩复盘总览 | 错题本与 Anki 推送 | 模考历史记录 | 应用设置与备份 |
| :---: | :---: | :---: | :---: | :---: |
| ![Stats Dashboard](docs/screenshots/17-stats-dashboard.png) | ![Results](docs/screenshots/13-test-results-overview.png) | ![Mistake Bank](docs/screenshots/14-mistake-bank.png) | ![Test History](docs/screenshots/15-test-history.png) | ![Settings](docs/screenshots/16-settings.png) |

---

## 导入自定义题库

支持通过 **Question Bank → Import JSON** 导入单个不超过 4 MB 的 UTF-8 `.json` 自定义试卷文件，完整字段定义与示例见：[`docs/JSON_IMPORT_FORMAT.md`](docs/JSON_IMPORT_FORMAT.md)。
