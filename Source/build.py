#!/usr/bin/env python3
"""Build script for AP Exam Room: strips 12MB inline EXAMS bloat, embeds Data/catalog.json stub index,
and injects RoomCharts.js, BluebookTools.js, PdfExam.js, Library.js, Settings.js, and Library.css."""
import json
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
source = root / "template.html" if (root / "template.html").exists() else (root.parent / "大陆统计_2026.html")
out = Path(sys.argv[1])
catalog_path = root / "Data" / "catalog.json"

assert catalog_path.exists(), f"Missing {catalog_path}. Run ingest scripts first."
catalog_json = catalog_path.read_text()

s = source.read_text()

# 1. Replace massive inline EXAMS JSON with lightweight CATALOG + lazy-load stubs
m_exams = re.search(r"\bconst EXAMS\s*=\s*", s)
assert m_exams, "const EXAMS = not found"
start = m_exams.end()
_, size = json.JSONDecoder().raw_decode(s[start:])
stub_init = (
    "Object.fromEntries(CATALOG.exams.map(e => [e.id, Object.assign({}, e, "
    "{_stub:true,questions:[],answers:{},explanations:{},frqQuestions:[],hasFrq:(e.frqCount||0)>0,breakMinutes:10})]))"
)
s = (
    s[: m_exams.start()]
    + f"const CATALOG = {catalog_json.replace('</script', '<\\\\/script')};\n    const EXAMS = "
    + stub_init
    + s[start + size :]
)


def change(a, b):
    global s
    cnt = s.count(a)
    assert cnt == 1, f"Expected 1 occurrence (found {cnt}) for:\n{a[:180]}"
    s = s.replace(a, b, 1)


change(
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n'
    '  <meta name="apple-mobile-web-app-capable" content="yes" />\n'
    '  <meta name="apple-mobile-web-app-status-bar-style" content="default" />\n'
    '  <meta name="apple-mobile-web-app-title" content="AP 模考室" />\n'
    '  <link rel="apple-touch-icon" sizes="180x180" href="Assets/AppIcon-180.png" />\n'
    '  <link rel="manifest" href="manifest.json" />',
)
change("<title>大陆统计 001 Mock Exam</title>", "<title>AP 模考室 · AP Exam Room</title>")
change(
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
    '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", Arial, sans-serif',
)

# 2. Inject modular frontend scripts before let currentExamId
injected_js = "\n".join(
    [
        (root / "RoomCharts.js").read_text(),
        (root / "BluebookTools.js").read_text(),
        (root / "PdfExam.js").read_text(),
        (root / "Library.js").read_text(),
        (root / "Settings.js").read_text(),
        "restoreQuestionBank();",
    ]
)
change("    let currentExamId = localStorage", injected_js + "\n    let currentExamId = localStorage")

change(
    "if (!EXAMS[currentExamId]) currentExamId = 'stats_001';",
    "if (!EXAMS[currentExamId]) currentExamId = (CATALOG.exams[0] && CATALOG.exams[0].id) || 'stats_001';",
)
change(
    "function getCurrentExam() {\n      return EXAMS[currentExamId] || EXAMS['stats_001'];",
    "function getCurrentExam() {\n      return EXAMS[currentExamId] || EXAMS['stats_001'] || Object.values(EXAMS)[0];",
)

change("    function renderIntro() {", "    function renderIntro() { renderLibrary(); }\n    function renderOriginalIntro() {")
change("    function saveState() {", "    function saveState() {\n      if (reviewedAttempt) return;")
change("        state.phase = 'intro';\n        saveState();\n        render();", "        returnToLibrary();")
change(
    "      state.completionShownAt = Date.now();\n      saveState();",
    "      state.completionShownAt = Date.now();\n      recordAttempt();\n      saveState();",
)
change(
    "if (action === 'restart') { startNewExam(); return; }",
    "if (action === 'restart') { roomSetup(currentExamId); return; }",
)
change("function startNewExam() {", "function startNewExam(settings = {}) {")
change("      fresh.phase = 'mcq_exam';", "      fresh.phase = 'mcq_exam';\n      fresh.roomSettings = settings;\n      if (settings.pdf) fresh.pdf = Object.assign({ answers:{}, eliminated:{}, marks:{}, responses:{}, rubricScores:{}, zoom:1.0 }, settings.pdf, { currentPage: settings.pdf.startPage, currentQ: settings.pdf.questionStartNum });")
change(
    "      fresh.mcq.timeRemaining = ex.durationSeconds;\n      fresh.mcq.timerStarted = true;\n      fresh.mcq.examEndAt = Date.now() + ex.durationSeconds * 1000;",
    """      const duration = settings.timing==='untimed' ? null : settings.timing==='custom' ? settings.minutes*60 : ex.durationSeconds;
      fresh.mcq.timeRemaining = duration;
      fresh.mcq.timerStarted = duration!==null;
      fresh.mcq.examEndAt = duration===null ? null : Date.now() + duration * 1000;""",
)
change(
    "      fresh.mcq.order = ex.questions.map(q => q.origId);\n      fresh.frq.order = ex.frqQuestions ? ex.frqQuestions.map(q => q.origId) : [];",
    """      fresh.mcq.order = ex.mode === 'pdf' ? [1] : ex.questions.filter(q=>!settings.mcq || settings.mcq.includes(q.origId)).map(q=>q.origId);
      fresh.frq.order = ex.mode === 'pdf' ? [] : (ex.frqQuestions||[]).filter(q=>!settings.frq || settings.frq.includes(q.origId)).map(q=>q.origId);""",
)
change(
    "      ui.directionsSection = 'mcq';\n      saveState();",
    """      if (ex.mode !== 'pdf' && !state.mcq.order.length && state.frq.order.length) { resumeBreak(); return; }
      ui.directionsSection = 'mcq';
      saveState();""",
)
change("      Object.assign(state, fresh);", "      Object.assign(state, fresh);\n      roomFocus(Boolean(settings.focus));")
change(
    "      state.frq.timeRemaining = ex.frqDurationSeconds || 5400;\n      state.frq.timerStarted = true;\n      state.frq.examEndAt = Date.now() + state.frq.timeRemaining * 1000;",
    """      state.frq.timeRemaining = roomTimer('frq',ex.frqDurationSeconds || 5400);
      state.frq.timerStarted = state.frq.timeRemaining!==null;
      state.frq.examEndAt = state.frq.timerStarted ? Date.now() + state.frq.timeRemaining * 1000 : null;""",
)
change("      recordAttempt();", "      roomFocus(false);\n      recordAttempt();")

change("    let state = loadState() || emptyState();", "    let state = loadState() || emptyState();\n    let forceLibrary = true;")
change(
    "    function render() {",
    "    function render() {\n      if (forceLibrary) { forceLibrary=false; state=emptyState(); renderLibrary(); migrateRoomHistory(); return; }",
)

# 3. Header Tools: add Bluebook Desmos Calculator, Reference Sheet & Dark Mode chips
old_header_tools = """function renderHeaderTools(section) {
      return `
        <button class="switch-exam-btn" type="button" data-action="to-intro" style="margin-right:12px;">试卷列表</button>
        <button class="tool-chip ${ui.moreOpen ? 'active' : ''}" type="button" data-action="toggle-more" data-section="${section}"><span class="tool-icon icon-more"></span><span>More</span></button>
        <div class="more-menu ${ui.moreOpen ? 'open' : ''}">
          <button class="menu-item" type="button" data-action="toggle-notes" data-section="${section}">${ui.notesSection === section ? 'Close Highlights &amp; Notes' : 'Open Highlights &amp; Notes'}</button>
          <button class="menu-item" type="button" data-action="stop-timing" data-section="${section}">${sectionState(section).timerPaused ? 'Resume Timing' : 'Stop Timing'}</button>
          ${section === 'frq' ? '<button class="menu-item" type="button" data-action="submit" data-section="frq">Submit Section II</button>' : ''}
          <button class="menu-item" type="button" data-action="to-intro" style="color:#c73648;">Exit to Exam List</button>
        </div>`;
    }"""

new_header_tools = """function renderHeaderTools(section) {
      const ex = getCurrentExam();
      const isPdf = ex && ex.mode === 'pdf';
      const secState = sectionState(section);
      const showCalc = ex && ex.calculator && ex.calculator !== 'none';
      const showRef = ex && (ex.referencePdf || ex.referenceType);
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      return `
        <button class="switch-exam-btn" type="button" data-action="to-intro">Question Bank</button>
        ${showCalc ? `<button class="tool-chip" type="button" data-action="room-toggle-desmos" title="Calculator (D)"><img src="${roomIconUrl('desmos.svg')}" alt="" width="16" height="16"><span>Calculator</span></button>` : ''}
        ${showRef ? `<button class="tool-chip" type="button" data-action="room-toggle-ref" title="Reference Sheet (R)"><img src="${roomIconUrl('reference.svg')}" alt="" width="16" height="16"><span>Reference</span></button>` : ''}
        <button class="tool-chip" type="button" data-action="room-toggle-theme" aria-pressed="${isDark}" title="Toggle Dark Mode"><span>${isDark ? '☀ Light' : '☾ Dark'}</span></button>
        <button class="tool-chip ${ui.moreOpen ? 'active' : ''}" type="button" data-action="toggle-more" data-section="${section}"><svg class="tool-svg-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/></svg><span>More</span></button>
        <div class="more-menu ${ui.moreOpen ? 'open' : ''}">
          <button class="menu-item" type="button" data-action="room-toggle-desmos">Open Desmos Calculator</button>
          ${!isPdf ? `<button class="menu-item" type="button" data-action="toggle-notes" data-section="${section}">${ui.notesSection === section ? 'Close Highlights &amp; Notes' : 'Open Highlights &amp; Notes'}</button>` : ''}
          ${secState.timerStarted ? `<button class="menu-item" type="button" data-action="stop-timing" data-section="${section}">${secState.timerPaused ? 'Resume Timing' : 'Stop Timing'}</button>` : ''}
          ${section === 'frq' && !isPdf ? '<button class="menu-item" type="button" data-action="submit" data-section="frq">Submit Section II</button>' : ''}
          ${state.roomSettings?.focus ? '<button class="menu-item" type="button" data-action="room-exit-focus">Exit Focus Mode</button>' : '<button class="menu-item menu-item-danger" type="button" data-action="to-intro">Exit to Question Bank</button>'}
        </div>`;
    }"""
change(old_header_tools, new_header_tools)

# 4. Delegate PDF mode inside renderSectionExam + call media/code/math enhancers
change(
    "    function renderSectionExam(section) {\n      const ex = getCurrentExam();",
    "    function renderSectionExam(section) {\n      const ex = getCurrentExam();\n      if (ex.mode === 'pdf' && typeof renderPdfExamSection === 'function') { renderPdfExamSection(section); return; }",
)
change(
    "      mountPerseusFigures();\n      typesetMath().then(() => {",
    "      mountPerseusFigures();\n      enhanceQuestionMedia(document.getElementById('app'));\n      mountCsaCodeEditor(document.getElementById('app'));\n      typesetMath().then(() => {",
)

# 5. Native exam mechanics patches
change(
    "const nextAction = isMcq ? 'next' : 'frq-next';",
    "const lastQuestion = s.currentIndex === s.order.length - 1;\n      const nextAction = lastQuestion ? 'go-check' : isMcq ? 'next' : 'frq-next';",
)
change(
    "${isMcq ? 'Next' : (s.currentIndex === s.order.length - 1 ? 'Review' : 'Next')}",
    "${lastQuestion ? 'Review' : 'Next'}",
)
change(
    'class="timer-wrap">${s.timeHidden',
    'class="timer-wrap">${s.timeRemaining === null ? \'<span class="room-meta">Untimed</span>\' : s.timeHidden',
)
needle = "选择题选项缺失，可直接跳到下一题。</span></div>`) : ``}"
change(
    needle,
    "选择题选项缺失，可跳过本题。</span></div>`) : `<label>Response<textarea class=\\\"room-response\\\" data-room-response=\\\"${q.origId}\\\">${escapeHtml(s.responses?.[q.origId]||'')}</textarea></label>`}",
)
change(
    "if (action === 'submit') { const sec=target.dataset.section; if(sec === 'mcq') startBreak(); else finishTest(); return; }",
    "if (action === 'submit') { roomSubmit(target.dataset.section); return; }",
)
change(
    "The timer is still running. You can quickly review",
    "${s.timeRemaining===null?'This section is untimed.':'The timer is still running.'} You can quickly review",
)
change("    function startBreak() {", "    function startBreak() {\n      document.querySelector('.room-dialog[data-submit]')?.close();")
change("    function finishTest() {", "    function finishTest() {\n      document.querySelector('.room-dialog[data-submit]')?.close();")
change(
    "      const unanswered = section === 'mcq' ? s.order.filter(id => !s.answers[id]).length : 0;",
    "      const unanswered = s.order.filter(id => section==='mcq' ? getQuestionByOrig(section,id)?.options?.length && !s.answers[id] : !s.responses?.[id]?.trim()).length;",
)
change(
    "${section === 'mcq' ? `Unanswered questions: ${unanswered} / ${s.order.length}` : `Marked for review: ${marked} / ${s.order.length}`}",
    "Unanswered questions: ${unanswered} · Marked for review: ${marked}",
)
change("      if (!ex.hasFrq) {\n        finishTest();", "      if (!state.frq.order.length) {\n        finishTest();")
change("      const keyedIds = s.order.filter(id => answerKeyOf(ex, id));", "      const keyedIds = scoringIds(ex,state);")
change("state.phase='results'; state.resultsTab=target.dataset.tab || 'mcq';", "openResults();")
change(
    '<div class="${timerClass}" data-role="timer-text">${currentTimerText(section)}</div>',
    '<div class="${timerClass}" data-role="timer-text">${currentTimerText(section)}${s.timerPaused ? \' <span class="timer-paused-badge">(Paused)</span>\' : \'\'}</div>',
)
change(
    "if (action === 'stop-timing') { const sec=target.dataset.section; const s=sectionState(sec); if(s.timerStarted){ s.timerPaused = !s.timerPaused; if(s.timerPaused) s.timeRemaining=Math.max(0,Math.ceil((s.examEndAt-Date.now())/1000)); else s.examEndAt=Date.now()+s.timeRemaining*1000; s.lastTick=Date.now(); saveState(); render(); } return; }",
    "if (action === 'stop-timing') { const sec=target.dataset.section; const s=sectionState(sec); if(s.timerStarted){ s.timerPaused = !s.timerPaused; if(s.timerPaused) s.timeRemaining=Math.max(0,Math.ceil((s.examEndAt-Date.now())/1000)); else s.examEndAt=Date.now()+s.timeRemaining*1000; s.lastTick=Date.now(); ui.moreOpen=false; saveState(); render(); } return; }",
)
change(
    """<label class="review-toggle"><input type="checkbox" data-action="toggle-mark" data-section="${section}" data-orig="${q.origId}" ${s.marks[q.origId] ? 'checked' : ''}><span>Mark for Review</span></label>""",
    """<label class="review-toggle ${s.marks[q.origId] ? 'is-marked' : ''}"><input type="checkbox" data-action="toggle-mark" data-section="${section}" data-orig="${q.origId}" ${s.marks[q.origId] ? 'checked' : ''}><svg class="review-bookmark-ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg><span class="review-toggle-label">${s.marks[q.origId] ? 'Marked for Review' : 'Mark for Review'}</span></label>""",
)
change(
    """      if (target.dataset.action === 'toggle-mark') {
        const sec=target.dataset.section; const orig=target.dataset.orig; const marks = sectionState(sec).marks;
        if (target.checked) marks[orig] = true; else delete marks[orig];
        saveState();
      }""",
    """      if (target.dataset.action === 'toggle-mark') {
        const sec=target.dataset.section; const orig=target.dataset.orig; const marks = sectionState(sec).marks;
        if (target.checked) marks[orig] = true; else delete marks[orig];
        const lbl = target.closest('.review-toggle');
        if (lbl) {
          lbl.classList.toggle('is-marked', target.checked);
          const span = lbl.querySelector('.review-toggle-label');
          if (span) span.textContent = target.checked ? 'Marked for Review' : 'Mark for Review';
        }
        saveState();
      }""",
)
change(
    "${q.promptHtml ? `<div class=\"prompt\">${getPromptHtml(q)}</div>` : ''}",
    "${q.promptHtml ? `<div class=\"prompt\">${getPromptHtml(q)}</div>` : ''}${s.responses?.[q.origId] ? `<div class=\"explanation-box\"><h3>Your Response</h3><p style=\"white-space:pre-wrap;font-family:ui-monospace,monospace;\">${escapeHtml(s.responses[q.origId])}</p></div>` : ''}${typeof renderNativeFrqRubricBlock==='function'?renderNativeFrqRubricBlock(ex,q,s):''}",
)

# 6. UI labels & results hooks
for a, b in {
    "AP 模考室": "AP Exam Room",
    "正在打开试卷详情": "Opening test details",
    "返回试卷列表": "Back to Question Bank",
    "试卷列表": "Question Bank",
    "本题未收录选项": "Choices unavailable",
    "该条目在原卷中属于 Section II 自由作答题（FRQ），选择题选项缺失，可跳过本题。": "This source entry does not include multiple-choice options. You can skip it.",
    "本卷暂无标准答案，无法自动评分。": "This attempt has no scorable questions.",
    "其中 ${ungradedIds.length} 题缺少可用标准答案（题面残缺或实为简答题），不计入评分。": "${ungradedIds.length} questions have no answer key and are excluded.",
    "已作答（无标准答案）": "Answered without an answer key",
    "该条目在原卷中属于 Section II 自由作答题，选择题选项缺失。": "The source does not include choices for this question.",
    "本题无标准答案（题面残缺或实为简答题），不计入评分": "No answer key for this question",
    "本卷暂无标准答案": "No answer key available",
}.items():
    s = s.replace(a, b)

change(
    """<button class="results-tab-btn ${isMcq ? 'active' : ''}" type="button" data-action="switch-tab" data-tab="mcq">Section I (MCQ)</button>""",
    """${state.mcq.order.length ? `<button class="results-tab-btn ${isMcq ? 'active' : ''}" type="button" data-action="switch-tab" data-tab="mcq">Section I (MCQ)</button>` : ''}""",
)
change("${ex.hasFrq ? `<button class=\"results-tab-btn", "${state.frq.order.length ? `<button class=\"results-tab-btn")
change("College Board · Bluebook Mock Exam Suite", "AP Exam Room · Test Results")
change("${section === 'mcq' ? mcq : frq}</div>", """${roomDirections(section)}</div>""")
change('class="completion-btn" type="button" data-action="view-results"', 'class="btn btn-primary" type="button" data-action="view-results"')
change(
    'class="completion-btn" type="button" data-action="to-intro" style="background:#fff;color:#1e293b;border:2px solid #cbd5e1;margin-top:12px;">Back to Exam List',
    'class="btn btn-secondary" type="button" data-action="to-intro">Back to Question Bank',
)
change('<div class="completion-actions">', '<img class="completion-face" src="Assets/face-excellent.svg" alt="">\n                <div class="completion-actions">')
change('<span class="results-header-title">AP Exam Room · Test Results</span>', '<h1 class="results-header-title">Test Results</h1>')
change('<span style="font-size:14px;color:#64748b;margin-left:14px;">${ex.title}</span>', '<p class="results-exam-name">${escapeHtml(ex.title)}</p>')
change('<div class="results-tabs">', '<div class="results-tabs" role="group" aria-label="Review section">')
for title in [
    '<span>${ex.title}</span>',
    '${ex.title} · ${s.timeRemaining',
    'Section I (${ex.title})',
    '${ex.title} · Section I Review',
    'Section II (${ex.title})',
]:
    change(title, title.replace('${ex.title}', '${escapeHtml(ex.title)}'))
for tab, active in [("mcq", "isMcq"), ("frq", "!isMcq")]:
    s = s.replace(f'data-action="switch-tab" data-tab="{tab}"', f'aria-pressed="${{{active}}}" data-action="switch-tab" data-tab="{tab}"', 1)
s = s.replace('<div class="toolbar-buttons" style="display:flex;gap:10px;">', '<div class="toolbar-buttons">')
s = s.replace(
    '<div class="toolbar-buttons"><button class="switch-exam-btn" type="button" data-action="to-intro">Back to Question Bank</button></div>',
    '<div class="toolbar-buttons"><button class="btn btn-primary" type="button" data-action="restart">Retake Test</button></div>',
)
change(
    '                <button class="switch-exam-btn" type="button" data-action="to-intro">Back to Question Bank</button>\n                <button class="btn btn-primary" type="button" data-action="restart">Restart Test</button>',
    '                <button class="btn btn-secondary" type="button" data-action="room-toggle-mistake" data-exam-id="${escapeHtml(ex.id)}" data-orig="${q.origId}">${roomIsMistakeSaved(ex.id, q.origId) ? "★ Saved in Mistakes" : "☆ Save to Mistakes"}</button>\n                <button class="btn btn-primary" type="button" data-action="restart">Retake Test</button>',
)
change("${normalizeExplanationHtml(ex.explanations[String(q.origId)])}", "${roomExplanation(ex,q)}")
change('<h1>Congratulations!</h1>', '<div class="room-mark completion-brand">${roomLogo()}</div><h1>You’re All Finished!</h1>')
change('${ex.title} · The exam is over. Stop writing now—place your booklet face down.', 'You submitted ${escapeHtml(ex.title)}. Your answers and results are saved in Test History.')
change(
    "    function renderResults() {\n      const ex = getCurrentExam();",
    "    function renderResults() {\n      const ex = getCurrentExam();\n      if (ex.mode === 'pdf' && typeof renderPdfResults === 'function') { renderPdfResults(); return; }",
)
change(
    "      typesetMath();\n      mountPerseusFigures();\n    }",
    "      enhanceQuestionMedia(document.getElementById('app'));\n      mountPerseusFigures();\n      typesetMath();\n    }",
)
change("${isMcq ? renderMcqResultsPanel() : renderFrqResultsPanel()}", "${resultView==='overview' ? renderResultsOverview(ex) : isMcq ? renderMcqResultsPanel() : renderFrqResultsPanel()}")
change("if (action === 'switch-tab') { state.resultsTab", "if (action === 'switch-tab') { resultView='overview'; state.resultsTab")
change("if (action === 'result-jump') { const tab", "if (action === 'result-jump') { resultView='question'; const tab")
change(
    '<div class="results-tabs" role="group" aria-label="Review section">',
    """<div class="results-tabs" role="group" aria-label="Review section">
              ${resultView==='question' ? '<button class="results-tab-btn" type="button" data-action="room-results-overview">← Overview</button>' : ''}""",
)
change(
    "${lastQuestion ? 'Review' : 'Next'}</button></div></div></div>",
    """${lastQuestion ? 'Review' : 'Next'}</button>${canCheckAnswer(section,q) ? `<button class="btn room-yellow room-check-answer" type="button" data-action="room-check-answer" ${s.answers[q.origId]?'':'disabled'}>Check Answer</button>` : ''}</div></div></div>""",
)
change("      if (action === 'answer')", "      if (action === 'room-check-answer') { roomCheckAnswer(); return; }\n      if (action === 'answer')")
s = s.replace("document.querySelector('.room-dialog[data-submit]')?.close();", "document.querySelector('.room-dialog[data-submit], .room-answer-dialog')?.close();")
s = s.replace("</head>", '<link rel="stylesheet" href="Assets/katex.min.css">\n<style>\n' + (root / "Library.css").read_text() + "\n</style></head>", 1)

# 7. Inject KaTeX, Desmos + RoomPets
change(
    "      ui.referenceOpen = false;\n      clearPalette();",
    "      ui.referenceOpen = false;\n      clearPalette();\n      window.roomCloseFloatingTools?.({ immediate: true });",
)
change(
    "      else renderIntro();\n      updateFloatingPalette();\n    }",
    "      else renderIntro();\n      updateFloatingPalette();\n      window.roomSyncFloatingToolsForPhase?.(state.phase);\n    }",
)

change("</body>", '<script src="Assets/katex.min.js"></script>\n<script src="Assets/desmos.js" defer></script>\n<script src="Assets/RoomPets.js" defer></script>\n</body>')
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(s)
print(f"BUILD_PY_OK size_kb={out.stat().st_size // 1024}")
