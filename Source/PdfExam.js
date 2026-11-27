/* PdfExam.js - Dual-Pane Bluebook PDF Exam Engine (Retina PDF Viewer + Interactive Bubble Sheet / FRQ Rubric) */
(function () {
  function initPdfState(ex) {
    if (!state.pdf) state.pdf = {};
    const cfg = state.roomSettings?.pdf || {};
    if (!state.pdf.startPage) state.pdf.startPage = cfg.startPage || ex.defaultStartPage || 1;
    if (!state.pdf.endPage) state.pdf.endPage = cfg.endPage || ex.defaultEndPage || ex.totalPages || 1;
    if (!state.pdf.currentPage || state.pdf.currentPage < state.pdf.startPage || state.pdf.currentPage > state.pdf.endPage) {
      state.pdf.currentPage = state.pdf.startPage;
    }
    if (!state.pdf.questionCount) state.pdf.questionCount = cfg.questionCount || ex.defaultQuestionCount || 25;
    if (!state.pdf.questionStartNum) state.pdf.questionStartNum = cfg.questionStartNum || ex.questionStartNum || 1;
    if (!state.pdf.sectionKind) state.pdf.sectionKind = cfg.sectionKind || ex.sectionKind || 'mcq';
    if (!state.pdf.currentQ) state.pdf.currentQ = state.pdf.questionStartNum;
    if (!state.pdf.answers) state.pdf.answers = {};
    if (!state.pdf.eliminated) state.pdf.eliminated = {};
    if (!state.pdf.marks) state.pdf.marks = {};
    if (!state.pdf.responses) state.pdf.responses = {};
    if (!state.pdf.rubricScores) state.pdf.rubricScores = {};
    if (!state.pdf.zoom) state.pdf.zoom = 1.0;
    if (typeof state.pdf.showAnswerSplit !== 'boolean') state.pdf.showAnswerSplit = false;
    if (!state.pdf.ansPage) state.pdf.ansPage = ex.answerPageStart || 1;
    return state.pdf;
  }

  function prefetchNeighborPages(pdfRel, page, endPage) {
    if (page + 1 <= endPage) {
      if (typeof window.roomPrefetchPdfPage === 'function') {
        window.roomPrefetchPdfPage(pdfRel, page + 1, 2.0);
      } else {
        const img = new Image();
        img.src = roomPdfUrl('pdf-page', { path: pdfRel, page: page + 1, scale: '2.0' });
      }
    }
  }

  window.gradePdfAttempt = function (ex, pdfState) {
    const startQ = pdfState.questionStartNum || 1;
    const count = pdfState.questionCount || 25;
    const extAns = ex.extractedAnswers || {};
    let totalKeyed = 0;
    let correct = 0;
    const missed = [];
    for (let i = 0; i < count; i++) {
      const qn = String(startQ + i);
      const userAns = pdfState.answers?.[qn] || '';
      const key = extAns[qn];
      if (key) {
        totalKeyed++;
        if (userAns === key) correct++;
        else missed.push({ origId: Number(qn), yourAnswer: userAns || '—', correctAnswer: key });
      }
    }
    return { totalKeyed, correct, missed };
  };

  function fmtSec(sec) {
    const n = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(n / 60);
    const r = n % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }

  window.renderPdfExamSection = function (section) {
    const ex = getCurrentExam();
    const s = sectionState(section);
    const p = initPdfState(ex);
    const startQ = p.questionStartNum;
    const count = p.questionCount;
    const endQ = startQ + count - 1;
    const secKind = p.sectionKind;
    const activeQ = p.currentQ;
    const hasKey = !!(ex.extractedAnswers && ex.extractedAnswers[String(activeQ)]);
    const activeAns = p.answers[String(activeQ)] || '';
    const activeKey = ex.extractedAnswers?.[String(activeQ)] || '';
    const canSeeAnsPane = !!(ex.answerPdfRel);

    const pausedBadge = s.timerPaused ? '<span class="timer-paused-badge">(Paused)</span>' : '';
    const timerDanger = s.timeRemaining !== null && s.timeRemaining <= 300 ? ' danger' : '';
    const timerText = s.timeRemaining === null
      ? '<span class="room-meta">Untimed</span>'
      : (s.timeHidden
        ? `<span class="timer-hidden-label">Timer Hidden</span>${pausedBadge}`
        : `<span class="timer timer-display${timerDanger}">${fmtSec(s.timeRemaining)}</span>${pausedBadge}`);

    const activePdfRel = p.showAnswerSplit && ex.answerPdfRel ? ex.answerPdfRel : ex.pdfRel;
    const activePdfPage = p.showAnswerSplit ? p.ansPage : p.currentPage;
    const isMarked = !!p.marks[String(activeQ)];
    const markToggleHtml = `
      <label class="pdf-mark-toggle ${isMarked ? 'is-marked' : ''}">
        <input type="checkbox" data-pdf-act="toggle-mark" ${isMarked ? 'checked' : ''}>
        <svg class="review-bookmark-ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>
        <span class="review-toggle-label">${isMarked ? 'Marked for Review' : 'Mark for Review'}</span>
      </label>`;

    let rightBody = '';
    if (secKind === 'mcq') {
      const letters = ex.subjectKey === 'psych' || ex.subjectKey === 'calc_bc' || ex.subjectKey === 'calc_ab'
        ? ['A', 'B', 'C', 'D']
        : ['A', 'B', 'C', 'D', 'E'];

      const chips = [];
      for (let i = startQ; i <= endQ; i++) {
        const ans = p.answers[String(i)];
        const mk = p.marks[String(i)];
        chips.push(`<button type="button" class="pdf-q-chip ${i === activeQ ? 'is-cur' : ''} ${ans ? 'is-ans' : ''} ${mk ? 'is-mark' : ''}" data-pdf-q="${i}">${i}${ans ? '·' + ans : ''}</button>`);
      }

      const optHtml = letters.map((L) => {
        const sel = activeAns === L;
        const elim = !!p.eliminated[`${activeQ}_${L}`];
        return `<div class="pdf-opt-row">
          <button type="button" class="pdf-bubble ${sel ? 'is-selected' : ''} ${elim ? 'is-eliminated' : ''}" data-pdf-choose="${L}">
            <span class="pdf-bubble-letter">${L}</span>
            <span class="pdf-bubble-label">Choice ${L}</span>
          </button>
          <button type="button" class="pdf-elim-btn ${elim ? 'active' : ''}" data-pdf-elim="${L}" title="Cross out ${L}">✕</button>
        </div>`;
      }).join('');

      let checkHtml = '';
      const isChecked = p.checkedQ === activeQ && hasKey;
      const isLastQ = activeQ >= endQ;
      if (isChecked) {
        const ok = activeAns === activeKey;
        checkHtml = `<div class="pdf-check-banner ${ok ? 'is-ok' : 'is-wrong'}">
          ${ok ? `✓ Correct! Choice ${activeKey}` : `✗ Your choice: ${activeAns || '—'} · Answer Key: <strong>${activeKey}</strong>`}
        </div>`;
      }

      rightBody = `
        <div class="pdf-sheet-head">
          <div class="pdf-sheet-head-info">
            <h2>Question ${activeQ} <span class="pdf-q-range">of Q${startQ}–${endQ}</span></h2>
            ${markToggleHtml}
          </div>
          ${hasKey ? (isChecked
            ? `<button type="button" class="btn room-yellow pdf-check-btn is-continue" data-pdf-act="${isLastQ ? 'finish-pdf' : 'next-q'}">${isLastQ ? 'Submit & Grade' : 'Continue →'}</button>`
            : `<button type="button" class="btn room-yellow pdf-check-btn" data-pdf-act="check-q" ${activeAns ? '' : 'disabled'}>Check Answer</button>`
          ) : ''}
        </div>
        ${checkHtml}
        <div class="pdf-bubbles-list">${optHtml}</div>
        <div class="pdf-q-grid-wrap">
          <div class="pdf-q-grid-title">Bubble Sheet (${Object.keys(p.answers).length}/${count} answered)</div>
          <div class="pdf-q-grid">${chips.join('')}</div>
        </div>`;
    } else {
      // FRQ / Written response + self-score rubric
      const frqCount = Math.max(1, Math.min(8, count));
      const chips = [];
      for (let i = startQ; i < startQ + frqCount; i++) {
        const hasResp = !!(p.responses[String(i)] || '').trim();
        const mk = p.marks[String(i)];
        chips.push(`<button type="button" class="pdf-q-chip ${i === activeQ ? 'is-cur' : ''} ${hasResp ? 'is-ans' : ''} ${mk ? 'is-mark' : ''}" data-pdf-q="${i}">Q${i}</button>`);
      }
      const curResp = p.responses[String(activeQ)] || '';
      const selfScore = p.rubricScores[String(activeQ)] ?? '';
      rightBody = `
        <div class="pdf-sheet-head">
          <div class="pdf-sheet-head-info">
            <h2>FRQ Question ${activeQ}</h2>
            ${markToggleHtml}
          </div>
          <div class="pdf-frq-chips">${chips.join('')}</div>
        </div>
        <label class="pdf-frq-label">
          <span>Your Work / Response</span>
          <textarea class="room-response" id="pdf-frq-textarea" placeholder="Write your solution or code here...">${escapeHtml(curResp)}</textarea>
        </label>
        <div class="pdf-rubric-bar">
          <span>Self-Score (0–9 pts):</span>
          <input type="number" min="0" max="15" value="${escapeHtml(String(selfScore))}" id="pdf-frq-score-inp" placeholder="—" style="width:72px;">
          ${canSeeAnsPane ? `<button type="button" class="btn btn-secondary" data-pdf-act="toggle-ans-view">${p.showAnswerSplit ? 'Back to Prompts' : 'View Answer / Scoring Key'}</button>` : ''}
        </div>`;
    }

    const appEl = document.getElementById('app');
    appEl.innerHTML = `
      <div class="exam-shell pdf-exam-shell">
        <header class="exam-header">
          <div class="header-left">
            <span class="section-title" title="${escapeHtml(ex.title)}">${escapeHtml(ex.title)}</span>
          </div>
          <div class="header-center">
            <div class="timer-wrap">${timerText}
              ${s.timeRemaining !== null ? `<button class="timer-hide-btn" type="button" data-action="toggle-hide" data-section="${section}">${s.timeHidden ? 'Show' : 'Hide'}</button>` : ''}
            </div>
          </div>
          <div class="header-right header-status">
            <div class="header-tools">
              ${typeof renderHeaderTools === 'function' ? renderHeaderTools(section) : ''}
            </div>
          </div>
        </header>

        <main class="pdf-exam-split">
          <section class="pdf-viewer-pane">
            <div class="pdf-viewer-toolbar">
              <div class="pdf-nav-group">
                <button type="button" class="pdf-tb-btn" data-pdf-act="prev-page">◀</button>
                <span class="pdf-page-ind">
                  ${p.showAnswerSplit ? 'Answer Key ' : ''}P.<input type="number" id="pdf-page-jump" value="${p.showAnswerSplit ? p.ansPage : p.currentPage}" min="1" max="${ex.totalPages || 999}"> / ${p.showAnswerSplit ? (ex.answerPageEnd || '?') : p.endPage}
                </span>
                <button type="button" class="pdf-tb-btn" data-pdf-act="next-page">▶</button>
              </div>
              <div class="pdf-tool-group">
                <button type="button" class="pdf-tb-btn" data-pdf-act="zoom-out">−</button>
                <span class="pdf-zoom-lbl">${Math.round(p.zoom * 100)}%</span>
                <button type="button" class="pdf-tb-btn" data-pdf-act="zoom-in">+</button>
                ${canSeeAnsPane ? `<button type="button" class="pdf-tb-btn ${p.showAnswerSplit ? 'is-on' : ''}" data-pdf-act="toggle-ans-view">${p.showAnswerSplit ? 'Prompt PDF' : 'Answer Key PDF'}</button>` : ''}
                <button type="button" class="pdf-tb-btn" data-pdf-act="open-ext" title="Open Original PDF">↗ PDF</button>
              </div>
            </div>
            ${ex.aiCheckRecommended ? '<div class="pdf-ai-note">注：2024 统计题库部分参考答案建议结合解析复核（可配合公式表与计算器验证）。</div>' : ''}
            <div class="pdf-canvas-scroll" id="pdf-canvas-scroll">
              <img class="pdf-exam-page-img" style="width:${Math.round(100 * p.zoom)}%;" alt="PDF Page">
            </div>
          </section>

          <aside class="pdf-answer-pane">
            ${rightBody}
          </aside>
        </main>

        <footer class="exam-footer">
          <div class="footer-left">
            <span class="student-badge">AP Exam Room · PDF Dual-Pane</span>
          </div>
          <div class="footer-right">
            <button type="button" class="btn btn-secondary" data-pdf-act="prev-q">Back</button>
            <button type="button" class="btn btn-secondary" data-pdf-act="next-q">Next</button>
            <button type="button" class="btn btn-primary" data-pdf-act="finish-pdf">Submit & Grade</button>
          </div>
        </footer>
      </div>`;

    wirePdfExamEvents(ex, p);
    const pageImgEl = appEl.querySelector('.pdf-exam-page-img');
    if (typeof window.roomRenderPdfIntoImg === 'function') {
      window.roomRenderPdfIntoImg(pageImgEl, activePdfRel, activePdfPage, 2.0);
    } else if (pageImgEl) {
      pageImgEl.src = roomPdfUrl('pdf-page', { path: activePdfRel, page: activePdfPage, scale: '2.0' });
    }
    prefetchNeighborPages(activePdfRel, activePdfPage, p.showAnswerSplit ? (ex.answerPageEnd || 999) : p.endPage);
    if (typeof mountCsaCodeEditor === 'function') mountCsaCodeEditor(appEl);
  };

  function wirePdfExamEvents(ex, p) {
    const root = document.querySelector('.pdf-exam-shell');
    if (!root) return;

    const rerender = () => { saveState(); render(); };

    const imgEl = root.querySelector('.pdf-exam-page-img');
    if (imgEl) {
      imgEl.style.cursor = 'zoom-in';
      imgEl.addEventListener('click', () => {
        if (typeof openRoomLightbox === 'function') {
          openRoomLightbox(imgEl.src, `${ex.title} — Page ${p.showAnswerSplit ? p.ansPage : p.currentPage}`);
        }
      });
    }

    const pageInp = root.querySelector('#pdf-page-jump');
    if (pageInp) {
      pageInp.addEventListener('change', () => {
        const val = Math.max(1, parseInt(pageInp.value, 10) || 1);
        if (p.showAnswerSplit) p.ansPage = Math.min(ex.answerPageEnd || val, val);
        else p.currentPage = Math.min(ex.totalPages || val, val);
        rerender();
      });
    }

    const frqTa = root.querySelector('#pdf-frq-textarea');
    if (frqTa) {
      frqTa.addEventListener('input', () => {
        p.responses[String(p.currentQ)] = frqTa.value;
        saveState();
      });
    }
    const scoreInp = root.querySelector('#pdf-frq-score-inp');
    if (scoreInp) {
      scoreInp.addEventListener('input', () => {
        p.rubricScores[String(p.currentQ)] = scoreInp.value === '' ? '' : Number(scoreInp.value);
        saveState();
      });
    }

    root.addEventListener('click', (e) => {
      const qBtn = e.target.closest('[data-pdf-q]');
      if (qBtn) {
        p.currentQ = Number(qBtn.dataset.pdfQ);
        p.checkedQ = null;
        rerender();
        return;
      }
      const chooseBtn = e.target.closest('[data-pdf-choose]');
      if (chooseBtn) {
        const L = chooseBtn.dataset.pdfChoose;
        const k = String(p.currentQ);
        p.answers[k] = p.answers[k] === L ? '' : L;
        if (!p.answers[k]) delete p.answers[k];
        p.checkedQ = null;
        rerender();
        return;
      }
      const elimBtn = e.target.closest('[data-pdf-elim]');
      if (elimBtn) {
        const k = `${p.currentQ}_${elimBtn.dataset.pdfElim}`;
        p.eliminated[k] = !p.eliminated[k];
        rerender();
        return;
      }
      const actBtn = e.target.closest('[data-pdf-act]');
      if (!actBtn) return;
      const act = actBtn.dataset.pdfAct;
      const startQ = p.questionStartNum;
      const endQ = startQ + p.questionCount - 1;
      if (act === 'prev-page') {
        if (p.showAnswerSplit) p.ansPage = Math.max(1, p.ansPage - 1);
        else p.currentPage = Math.max(1, p.currentPage - 1);
        rerender();
      } else if (act === 'next-page') {
        if (p.showAnswerSplit) p.ansPage = Math.min(ex.answerPageEnd || p.ansPage + 1, p.ansPage + 1);
        else p.currentPage = Math.min(ex.totalPages || p.currentPage + 1, p.currentPage + 1);
        rerender();
      } else if (act === 'zoom-in') {
        p.zoom = Math.min(2.0, Math.round((p.zoom + 0.15) * 100) / 100);
        rerender();
      } else if (act === 'zoom-out') {
        p.zoom = Math.max(0.6, Math.round((p.zoom - 0.15) * 100) / 100);
        rerender();
      } else if (act === 'toggle-ans-view') {
        p.showAnswerSplit = !p.showAnswerSplit;
        rerender();
      } else if (act === 'open-ext') {
        roomOpenPdfExternal(p.showAnswerSplit && ex.answerPdfRel ? ex.answerPdfRel : ex.pdfRel);
      } else if (act === 'toggle-mark') {
        const k = String(p.currentQ);
        if (p.marks[k]) delete p.marks[k];
        else p.marks[k] = true;
        rerender();
      } else if (act === 'check-q') {
        p.checkedQ = p.currentQ;
        const ok = !!(p.answers[String(p.currentQ)] && p.answers[String(p.currentQ)] === ex.extractedAnswers?.[String(p.currentQ)]);
        rerender();
        if (ok && typeof window.launchRoomConfetti === 'function') {
          const cb = document.querySelector('.pdf-check-btn');
          const r = cb?.getBoundingClientRect();
          const origins = r ? [{ x: r.left + r.width / 2, y: r.top + 8, angleMin: -162, angleMax: -108 }] : undefined;
          window.launchRoomConfetti(document.body, origins);
        }
      } else if (act === 'prev-q') {
        p.currentQ = Math.max(startQ, p.currentQ - 1);
        p.checkedQ = null;
        rerender();
      } else if (act === 'next-q') {
        p.currentQ = Math.min(endQ, p.currentQ + 1);
        p.checkedQ = null;
        rerender();
      } else if (act === 'finish-pdf') {
        if (typeof finishTest === 'function') finishTest();
      }
    });
  }

  window.renderPdfResults = function () {
    const ex = getCurrentExam();
    const p = initPdfState(ex);
    const { totalKeyed, correct, missed } = gradePdfAttempt(ex, p);
    const extAns = ex.extractedAnswers || {};
    const startQ = p.questionStartNum;
    const count = p.questionCount;
    const ansPage = p.ansPage || ex.answerPageStart || 1;

    const rows = [];
    for (let i = startQ; i < startQ + count; i++) {
      const k = String(i);
      const u = p.answers[k] || '—';
      const a = extAns[k] || '';
      const cls = a ? (u === a ? 'is-ok' : 'is-bad') : 'is-unkeyed';
      rows.push(`<div class="pdf-res-cell ${cls}">
        <span class="qn">Q${i}</span>
        <span class="ua">${u}</span>
        ${a ? `<span class="ka">Key: ${a}</span>` : ''}
      </div>`);
    }

    const appEl = document.getElementById('app');
    appEl.innerHTML = `
      <div class="results-screen pdf-results-screen">
        <header class="results-header">
          <div class="results-header-left">
            <h1 class="results-header-title">PDF Practice Results</h1>
            <p class="results-exam-name">${escapeHtml(ex.title)}</p>
          </div>
          <div class="toolbar-buttons">
            <button class="btn btn-secondary" type="button" data-action="to-intro">Back to Question Bank</button>
            <button class="btn btn-primary" type="button" data-action="restart">Retake Test</button>
          </div>
        </header>
        <div class="pdf-results-summary">
          ${totalKeyed
            ? `<div class="pdf-res-stat"><strong>${correct} / ${totalKeyed}</strong><span>Auto-Graded Accuracy (${Math.round((correct / totalKeyed) * 100)}%)</span></div>
               <div class="pdf-res-stat"><strong>${missed.length}</strong><span>Missed Questions (Added to Mistake Bank)</span></div>`
            : `<div class="pdf-res-stat"><strong>${Object.keys(p.answers).length}</strong><span>Bubbles Recorded</span></div>`}
          ${ex.answerPdfRel ? `<div class="pdf-res-stat"><button type="button" class="btn btn-secondary" id="pdf-res-open-key">Open Full Answer Key PDF ↗</button></div>` : ''}
        </div>
        <div class="pdf-results-split">
          <section class="pdf-res-answers">
            <h3>Your Bubble Sheet & Answer Comparison</h3>
            <div class="pdf-res-grid">${rows.join('')}</div>
          </section>
          <section class="pdf-res-key-pane">
            <div class="pdf-viewer-toolbar">
              <span>${ex.answerPdfRel ? 'Answer Key PDF' : 'No Separate Answer Key Paired'}</span>
              ${ex.answerPdfRel ? `<div class="pdf-nav-group">
                <button type="button" class="pdf-tb-btn" id="pdf-res-prev">◀</button>
                <span>P.${ansPage} / ${ex.answerPageEnd || '?'}</span>
                <button type="button" class="pdf-tb-btn" id="pdf-res-next">▶</button>
              </div>` : ''}
            </div>
            <div class="pdf-canvas-scroll">
              ${ex.answerPdfRel ? '<img class="pdf-exam-page-img" alt="Answer Key Page">' : '<div class="pdf-no-key-msg">No Answer Key PDF paired for this file.</div>'}
            </div>
          </section>
        </div>
      </div>`;

    if (ex.answerPdfRel) {
      const resImg = appEl.querySelector('.pdf-res-key-pane .pdf-exam-page-img');
      if (typeof window.roomRenderPdfIntoImg === 'function') {
        window.roomRenderPdfIntoImg(resImg, ex.answerPdfRel, ansPage, 2.0);
      } else if (resImg) {
        resImg.src = roomPdfUrl('pdf-page', { path: ex.answerPdfRel, page: ansPage, scale: '2.0' });
      }
    }

    document.getElementById('pdf-res-open-key')?.addEventListener('click', () => roomOpenPdfExternal(ex.answerPdfRel));
    document.getElementById('pdf-res-prev')?.addEventListener('click', () => {
      if (p.ansPage > 1) { p.ansPage--; saveState(); window.renderPdfResults(); }
    });
    document.getElementById('pdf-res-next')?.addEventListener('click', () => {
      if (p.ansPage < (ex.answerPageEnd || 999)) { p.ansPage++; saveState(); window.renderPdfResults(); }
    });
  };
})();
