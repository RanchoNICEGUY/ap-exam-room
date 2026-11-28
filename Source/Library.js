/* Library.js - AP Exam Room Question Bank, Subject Sidebar, Folder/Grid/List Views, Lazy Loader, Mistake Bank + Anki Push & FRQ Rubrics */
const libraryHistoryKey = 'ap-room-history-v1';
const libraryImportKey = 'ap-room-imports-v1';
const libraryMistakesKey = 'ap-room-mistakes-v1';
const libraryUiKey = 'ap-room-ui-v2';

let libraryView = 'bank'; // 'bank' | 'mistakes' | 'history' | 'settings'
let librarySearch = '';
let libraryDisplayMode = 'folder'; // 'folder' | 'grid' | 'list'
let librarySort = 'recommended'; // 'recommended' | 'title' | 'year' | 'native'
let libraryPage = 1;
let libraryPageSize = 48;
let libraryFolderPath = []; // array of folder names inside active subject
let extendedExpanded = false;
let reviewedAttempt = null;
let resultView = 'overview';
let mistakeSubjectFilter = 'all';

const CATEGORY_PRIORITY = {
  mock: 0,
  quiz: 1,
  homework: 2,
  frq: 3,
  workbook: 4,
  past: 5,
  past_exam: 5,
  sprint: 6,
  td_sprint: 6,
  progress_check: 7,
};

const naturalCollator = typeof Intl !== 'undefined' && Intl.Collator
  ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  : null;

function naturalCompare(a, b) {
  const sa = String(a ?? '');
  const sb = String(b ?? '');
  if (naturalCollator) return naturalCollator.compare(sa, sb);
  const re = /(\d+|\D+)/g;
  const pa = sa.toLowerCase().match(re) || [];
  const pb = sb.toLowerCase().match(re) || [];
  const len = Math.min(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = /^\d+$/.test(pa[i]) ? Number(pa[i]) : null;
    const nb = /^\d+$/.test(pb[i]) ? Number(pb[i]) : null;
    if (na !== null && nb !== null) {
      if (na !== nb) return na - nb;
    } else if (pa[i] !== pb[i]) {
      return pa[i] < pb[i] ? -1 : 1;
    }
  }
  return pa.length - pb.length;
}

function extractYear(title) {
  const str = String(title || '');
  const re = /(?:^|[^\d])(19[89]\d|20[0-3]\d)(?=[^\d]|$)/g;
  let best = 0;
  let m;
  while ((m = re.exec(str))) {
    const y = Number(m[1]);
    if (y > best) best = y;
  }
  return best;
}

function buildExamProgressIndex(list) {
  const historyIds = new Set();
  const latestScoreByExam = new Map();
  try {
    if (typeof allAttempts === 'function') {
      for (const a of allAttempts()) {
        if (!a || !a.examId) continue;
        historyIds.add(a.examId);
        if (!latestScoreByExam.has(a.examId) && a.graded > 0 && a.answered > 0) {
          latestScoreByExam.set(a.examId, `${a.correct}/${a.graded} · ${Math.round((a.correct / a.graded) * 100)}%`);
        }
      }
    }
  } catch (_) {}
  const map = new Map();
  for (const ex of list) {
    const id = ex.id;
    const raw = readLibrary(getStorageKey(id), {});
    const ongoing = ['mcq_exam', 'mcq_check', 'frq_exam', 'frq_check', 'break'].includes(raw.phase);
    const completed = !ongoing && (['complete', 'results'].includes(raw.phase) || historyIds.has(id));
    const bucket = ongoing ? 0 : (completed ? 2 : 1);
    const lastActive = Number(raw.mcq?.lastTick || raw.frq?.lastTick || raw.completionShownAt || 0);
    map.set(id, { bucket, ongoing, completed, lastActive, scoreText: latestScoreByExam.get(id) || '' });
  }
  return map;
}

function sortExams(list, progressMap) {
  const arr = [...list];
  const prog = progressMap || (librarySort === 'recommended' ? buildExamProgressIndex(arr) : null);
  arr.sort((a, b) => {
    if (librarySort === 'title') {
      return naturalCompare(a.title, b.title);
    }
    if (librarySort === 'year') {
      const yd = extractYear(b.title) - extractYear(a.title);
      if (yd !== 0) return yd;
      const md = (a.mode === 'native' ? 0 : 1) - (b.mode === 'native' ? 0 : 1);
      if (md !== 0) return md;
      return naturalCompare(a.title, b.title);
    }
    if (librarySort === 'native') {
      const md = (a.mode === 'native' ? 0 : 1) - (b.mode === 'native' ? 0 : 1);
      if (md !== 0) return md;
      return naturalCompare(a.title, b.title);
    }
    // 'recommended' default: In Progress (0) -> Not Started (1) -> Completed (2), then native -> category -> title
    const pa = prog.get(a.id);
    const pb = prog.get(b.id);
    if (pa && pb) {
      if (pa.bucket !== pb.bucket) return pa.bucket - pb.bucket;
      if (pa.bucket === 0 && pb.lastActive !== pa.lastActive) return pb.lastActive - pa.lastActive;
    }
    const md = (a.mode === 'native' ? 0 : 1) - (b.mode === 'native' ? 0 : 1);
    if (md !== 0) return md;
    const ca = CATEGORY_PRIORITY[a.category] ?? 9;
    const cb = CATEGORY_PRIORITY[b.category] ?? 9;
    if (ca !== cb) return ca - cb;
    return naturalCompare(a.title, b.title);
  });
  return arr;
}

function paginateList(items) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / libraryPageSize));
  if (libraryPage > totalPages) libraryPage = totalPages;
  if (libraryPage < 1) libraryPage = 1;
  const startIdx = (libraryPage - 1) * libraryPageSize;
  const endIdx = Math.min(total, startIdx + libraryPageSize);
  return {
    pageItems: items.slice(startIdx, endIdx),
    total,
    totalPages,
    page: libraryPage,
    startNum: total ? startIdx + 1 : 0,
    endNum: endIdx,
  };
}

function buildPageRange(current, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = new Set([1, totalPages]);
  for (let p = Math.max(2, current - 1); p <= Math.min(totalPages - 1, current + 1); p++) {
    pages.add(p);
  }
  if (current <= 3) { pages.add(2); pages.add(3); pages.add(4); }
  if (current >= totalPages - 2) { pages.add(totalPages - 3); pages.add(totalPages - 2); pages.add(totalPages - 1); }
  const sorted = [...pages].filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const gap = sorted[i] - sorted[i - 1];
      if (gap === 2) out.push(sorted[i - 1] + 1);
      else if (gap > 2) out.push('…');
    }
    out.push(sorted[i]);
  }
  return out;
}

function renderRoomDropdown({ id, label, value, options, pickAction, openUp = false, compact = false, ariaLabel }) {
  const cur = options.find(o => String(o.value) === String(value)) || options[0];
  return `<div class="room-dropdown ${openUp ? 'is-up' : ''} ${compact ? 'is-compact' : ''}" ${id ? `id="${escapeHtml(id)}"` : ''} data-value="${escapeHtml(String(value))}">
    <button type="button" class="room-dd-trigger" data-action="toggle-dropdown" aria-haspopup="listbox" aria-expanded="false" aria-label="${escapeHtml(ariaLabel || label || '')}">
      <span class="room-dd-label">${escapeHtml(cur ? cur.label : '')}</span>
      <svg class="room-dd-caret" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4.2 6.2 8 10l3.8-3.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <div class="room-dd-menu" role="listbox" hidden>
      ${options.map(opt => {
        const sel = String(opt.value) === String(value);
        return `<button type="button" class="room-dd-item ${sel ? 'is-selected' : ''}" role="option" aria-selected="${sel}" data-action="${escapeHtml(pickAction)}" data-value="${escapeHtml(String(opt.value))}">
          <span>${escapeHtml(opt.label)}</span>
          <svg class="room-dd-check" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>`;
      }).join('')}
    </div>
  </div>`;
}

function closeRoomDropdowns(exceptEl = null) {
  document.querySelectorAll('.room-dropdown.is-open').forEach(dd => {
    if (exceptEl && dd === exceptEl) return;
    dd.classList.remove('is-open');
    dd.querySelector('.room-dd-trigger')?.setAttribute('aria-expanded', 'false');
    const menu = dd.querySelector('.room-dd-menu');
    if (menu) menu.hidden = true;
  });
}

function renderPaginationBar(pg) {
  if (pg.total <= libraryPageSize && libraryPageSize === 48) return '';
  if (pg.total <= 48 && pg.totalPages <= 1) return '';
  const items = buildPageRange(pg.page, pg.totalPages);
  const buttonsHtml = items.map(it => {
    if (it === '…') return '<span class="room-page-ellipsis" aria-hidden="true">…</span>';
    const active = it === pg.page;
    return `<button type="button" class="room-page-btn ${active ? 'is-active' : ''}" data-action="set-page" data-page="${it}" ${active ? 'aria-current="page"' : ''}>${it}</button>`;
  }).join('');
  return `<nav class="room-pagination" aria-label="Pagination">
    <span class="room-page-info">Showing ${pg.startNum}–${pg.endNum} of ${pg.total} tests</span>
    <div class="room-page-nav">
      <button type="button" class="room-page-btn" data-action="set-page" data-page="${pg.page - 1}" ${pg.page <= 1 ? 'disabled' : ''}>◀ Prev</button>
      ${buttonsHtml}
      <button type="button" class="room-page-btn" data-action="set-page" data-page="${pg.page + 1}" ${pg.page >= pg.totalPages ? 'disabled' : ''}>Next ▶</button>
    </div>
    <div class="room-page-tools">
      <label class="room-page-jump-wrap">
        <span>Page</span>
        <input type="number" class="room-page-jump" data-action="jump-page" min="1" max="${pg.totalPages}" value="${pg.page}" aria-label="Jump to page">
        <span>/ ${pg.totalPages}</span>
      </label>
      ${renderRoomDropdown({
        id: 'room-page-size-dd',
        value: libraryPageSize,
        options: [48, 96, 150].map(sz => ({ value: sz, label: `${sz} / page` })),
        pickAction: 'pick-page-size',
        openUp: true,
        compact: true,
        ariaLabel: 'Tests per page',
      })}
    </div>
  </nav>`;
}

(function loadUiPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(libraryUiKey) || '{}');
    if (['folder', 'grid', 'list'].includes(p.displayMode)) libraryDisplayMode = p.displayMode;
    if (['recommended', 'title', 'year', 'native'].includes(p.sort)) librarySort = p.sort;
    if ([48, 96, 150].includes(Number(p.pageSize))) libraryPageSize = Number(p.pageSize);
    if (typeof p.extendedExpanded === 'boolean') extendedExpanded = p.extendedExpanded;
  } catch (_) {}
})();

function saveUiPrefs() {
  try {
    localStorage.setItem(libraryUiKey, JSON.stringify({
      displayMode: libraryDisplayMode,
      sort: librarySort,
      pageSize: libraryPageSize,
      extendedExpanded,
    }));
  } catch (_) {}
}

function readLibrary(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; }
  catch { return fallback; }
}

function restoreQuestionBank() {
  Object.assign(EXAMS, readLibrary(libraryImportKey, {}));
}

async function ensureExamLoaded(examId) {
  const ex = EXAMS[examId];
  if (!ex) return null;
  if (!ex._stub) return ex;
  const res = await fetch(roomDataUrl('data/exams/' + encodeURIComponent(examId) + '.json'));
  if (!res.ok) throw new Error('Failed to load exam data: ' + examId);
  const full = await res.json();
  EXAMS[examId] = Object.assign({}, ex, full, { _stub: false });
  if (typeof PERSEUS_FIGURES !== 'undefined') {
    for (const q of EXAMS[examId].questions || []) {
      if (q && q.perseusItem) PERSEUS_FIGURES[examId + ':' + q.origId] = q.perseusItem;
    }
  }
  return EXAMS[examId];
}

function loadGlobalMistakes() {
  return readLibrary(libraryMistakesKey, []);
}

function saveGlobalMistakes(list) {
  try {
    localStorage.setItem(libraryMistakesKey, JSON.stringify(list));
  } catch (_) {}
}

window.roomIsMistakeSaved = function (examId, origId) {
  return loadGlobalMistakes().some(m => m.examId === examId && Number(m.origId) === Number(origId));
};

window.roomToggleManualMistake = function (examId, origId) {
  const ex = EXAMS[examId];
  if (!ex) return;
  const list = loadGlobalMistakes();
  const idx = list.findIndex(m => m.examId === examId && Number(m.origId) === Number(origId));
  if (idx >= 0) {
    list.splice(idx, 1);
  } else {
    const q = (ex.questions || []).find(x => Number(x.origId) === Number(origId));
    const userAns = state?.mcq?.answers?.[origId] || state?.pdf?.answers?.[origId] || 'Bookmarked';
    const key = answerKeyOf(ex, origId) || ex.extractedAnswers?.[String(origId)] || '—';
    list.unshift({
      examId,
      subjectKey: ex.subjectKey,
      subject: ex.subject,
      title: ex.title,
      origId: Number(origId),
      topic: q?.topic || '',
      stemPreview: q ? questionPreview(q) : `${ex.title} — Question ${origId}`,
      yourAnswer: userAns,
      correctAnswer: key,
      explanationHtml: q ? (ex.explanations?.[origId] || q.rationaleHtml || '') : '',
      mode: ex.mode || 'native',
      time: Date.now(),
    });
  }
  saveGlobalMistakes(list);
  render();
};

function syncAttemptToMistakeBank(ex, snapshot) {
  const existing = loadGlobalMistakes();
  const byKey = new Map(existing.map(m => [`${m.examId}:${m.origId}`, m]));
  const now = snapshot.completionShownAt || Date.now();

  if (ex.mode === 'pdf') {
    const res = typeof gradePdfAttempt === 'function' ? gradePdfAttempt(ex, snapshot.pdf || {}) : { missed: [] };
    for (const m of res.missed) {
      const k = `${ex.id}:${m.origId}`;
      byKey.set(k, {
        examId: ex.id,
        subjectKey: ex.subjectKey,
        subject: ex.subject,
        title: ex.title,
        origId: m.origId,
        topic: 'PDF Practice',
        stemPreview: `${ex.title} — Question ${m.origId}`,
        yourAnswer: m.yourAnswer,
        correctAnswer: m.correctAnswer,
        explanationHtml: ex.answerPdfRel ? `Answer Key PDF: ${ex.answerPdfRel} (p.${ex.answerPageStart || 1})` : '',
        mode: 'pdf',
        time: now,
      });
    }
  } else {
    const scored = scoringIds(ex, snapshot);
    for (const qid of scored) {
      const userAns = snapshot.mcq?.answers?.[qid] || '';
      const key = answerKeyOf(ex, qid);
      if (key && userAns !== key) {
        const q = ex.questions.find(x => x.origId === qid);
        if (!q) continue;
        byKey.set(`${ex.id}:${qid}`, {
          examId: ex.id,
          subjectKey: ex.subjectKey,
          subject: ex.subject,
          title: ex.title,
          origId: qid,
          topic: q.topic || '',
          stemPreview: questionPreview(q),
          yourAnswer: userAns || 'Unanswered',
          correctAnswer: key,
          explanationHtml: ex.explanations?.[qid] || q.rationaleHtml || '',
          mode: 'native',
          time: now,
        });
      }
    }
  }
  saveGlobalMistakes([...byKey.values()].sort((a, b) => b.time - a.time));
}

function recordAttempt() {
  const ex = getCurrentExam();
  const attempt = attemptFrom(ex, state);
  syncAttemptToMistakeBank(ex, state);
  const attempts = readLibrary(libraryHistoryKey, []).filter(a => a.examId !== attempt.examId || a.time !== attempt.time);
  attempts.unshift(attempt);
  try { localStorage.setItem(libraryHistoryKey, JSON.stringify(attempts)); }
  catch { if (!window.webkit?.messageHandlers?.roomHistory) showHistoryStorageError(); }
  saveHistoryRows([attempt]);
}

const labels = {
  mock: 'Full-Length',
  homework: 'Homework',
  quiz: 'Unit Quiz',
  frq: 'FRQ Practice',
  workbook: 'Workbook',
  past: 'Past Exams',
  sprint: 'TD Sprint',
  progress_check: 'Progress Check',
};

const iconFileMap = {
  csa: 'csa.svg',
  micro: 'micro.svg',
  macro: 'macro.svg',
  calc_bc: 'calc_bc.svg',
  calc_ab: 'calc_bc.svg',
  precalc: 'calc_bc.svg',
  stats: 'stats.svg',
  chem: 'chem.svg',
  psych: 'psych.svg',
  mock: 'mock.svg',
  frq: 'frq.svg',
  workbook: 'workbook.svg',
  quiz: 'quiz.svg',
  homework: 'homework.svg',
  past: 'past.svg',
  sprint: 'sprint.svg',
  progress_check: 'quiz.svg',
  folder: 'folder.svg',
  grid: 'grid.svg',
  list: 'list.svg',
  anki: 'anki.svg',
  mistakes: 'mistakes.svg',
};

function roomLogo() {
  return '<img src="Assets/RoomMark.svg" alt="" class="room-logo">';
}

function roomIcon(name) {
  if (iconFileMap[name]) {
    return `<img class="room-icon" src="Assets/icons/${iconFileMap[name]}" alt="">`;
  }
  return `<img class="room-icon" src="Assets/icons/extended.svg" alt="">`;
}

function getSubjectsList() {
  if (typeof CATALOG !== 'undefined' && Array.isArray(CATALOG.subjects)) {
    return CATALOG.subjects;
  }
  const map = new Map();
  for (const ex of Object.values(EXAMS)) {
    if (!map.has(ex.subjectKey)) {
      map.set(ex.subjectKey, { key: ex.subjectKey, name: ex.subject, zh: ex.subjectZh || '', isExtended: !!ex.isExtended, examCount: 0 });
    }
    map.get(ex.subjectKey).examCount++;
  }
  return [...map.values()];
}

function examCardBadges(ex) {
  const badges = [];
  if (ex.mode === 'pdf') badges.push('<span class="room-badge is-pdf">PDF Dual-Pane</span>');
  else badges.push('<span class="room-badge is-native">Interactive</span>');
  if (ex.hasAnswers) badges.push('<span class="room-badge is-key">Answer Key</span>');
  if (ex.calculator && ex.calculator !== 'none') badges.push('<span class="room-badge is-desmos">Desmos</span>');
  if (ex.category === 'frq' || (ex.frqCount || 0) > 0) badges.push('<span class="room-badge is-frq">FRQ</span>');
  return badges.join('');
}

function examMetaLine(ex) {
  const parts = [labels[ex.category] || ex.category];
  if (ex.mode === 'pdf') {
    const pr = ex.pageRange ? `P.${ex.pageRange[0]}–${ex.pageRange[1]}` : `${ex.pageCount || ex.totalPages || 1}p`;
    parts.push(pr);
  } else {
    const mc = ex.mcqCount ?? ex.questions?.length ?? 0;
    const fc = ex.frqCount ?? ex.frqQuestions?.length ?? 0;
    if (mc) parts.push(`${mc} MCQ`);
    if (fc) parts.push(`${fc} FRQ`);
  }
  if (ex.durationSeconds) parts.push(`${Math.max(1, Math.round(ex.durationSeconds / 60))} min`);
  return parts.filter(Boolean).join(' · ');
}

function renderExamItemMarkup(ex, displayMode, progressMap) {
  let info = progressMap?.get(ex.id);
  if (!info) {
    const raw = readLibrary(getStorageKey(ex.id), {});
    const ongoing = ['mcq_exam', 'mcq_check', 'frq_exam', 'frq_check', 'break'].includes(raw.phase);
    const atts = typeof allAttempts === 'function' ? allAttempts().filter(a => a.examId === ex.id) : [];
    const completed = !ongoing && (['complete', 'results'].includes(raw.phase) || atts.length > 0);
    const scored = atts.find(a => a.graded > 0 && a.answered > 0);
    const scoreText = scored ? `${scored.correct}/${scored.graded} · ${Math.round((scored.correct / scored.graded) * 100)}%` : '';
    info = { ongoing, completed, scoreText };
  }
  const { ongoing, completed, scoreText } = info;
  const btnText = ongoing ? 'Resume' : (completed ? 'Retake' : 'Start / Setup');
  const btnCls = ongoing ? 'btn-primary' : (completed ? 'btn-done-retake' : 'room-yellow');
  const stateCls = ongoing ? 'is-ongoing' : (completed ? 'is-completed' : '');
  const catIcon = roomIcon(ex.category || 'workbook');
  const checkOverlay = completed ? '<span class="room-tile-check" aria-hidden="true">✓</span>' : '';
  const doneBadge = completed
    ? `<span class="room-badge is-done-badge">${scoreText ? '✓ ' + escapeHtml(scoreText) : '✓ Completed'}</span>`
    : '';

  if (displayMode === 'grid') {
    return `<article class="room-card ${stateCls}" data-exam-id="${escapeHtml(ex.id)}">
      <div class="room-card-top">
        <span class="room-card-icon">${catIcon}${checkOverlay}</span>
        <div class="room-card-badges">${examCardBadges(ex)}${doneBadge}</div>
      </div>
      <h3 class="room-card-title">${escapeHtml(ex.title)}</h3>
      <p class="room-card-meta">${escapeHtml(ex.subject)} · ${escapeHtml(examMetaLine(ex))}</p>
      <div class="room-card-actions">
        <button class="btn ${btnCls}" data-action="room-open" data-exam-id="${escapeHtml(ex.id)}">${btnText}</button>
      </div>
    </article>`;
  }

  return `<li class="room-row ${stateCls}" data-exam-id="${escapeHtml(ex.id)}">
    <div class="room-item">
      <span class="room-tile-icon">${catIcon}${checkOverlay}</span>
      <div>
        <div class="room-row-title-line">
          <strong>${escapeHtml(ex.title)}</strong>
          <span class="room-inline-badges">${examCardBadges(ex)}${doneBadge}</span>
        </div>
        <div class="room-meta">${escapeHtml(ex.subject)} · ${escapeHtml(examMetaLine(ex))}</div>
      </div>
    </div>
    <div class="room-row-actions">
      <button class="btn ${btnCls}" data-action="room-open" data-exam-id="${escapeHtml(ex.id)}">${btnText}</button>
    </div>
  </li>`;
}

function renderExamListMarkup(pageItems, progressMap) {
  let dividerInserted = false;
  let seenActive = false;
  const rowsHtml = [];
  for (const ex of pageItems) {
    const info = progressMap?.get(ex.id);
    const isDone = Boolean(info?.completed);
    if (!isDone) seenActive = true;
    if (librarySort === 'recommended' && !dividerInserted && isDone && seenActive) {
      dividerInserted = true;
      rowsHtml.push('<li class="room-list-divider" role="presentation"><span>✓ Completed</span></li>');
    }
    rowsHtml.push(renderExamItemMarkup(ex, 'list', progressMap));
  }
  return `<ul class="room-list">${rowsHtml.join('')}</ul>`;
}

function renderFolderHierarchy(rows, subjectSelected, progressMap) {
  const prog = progressMap || buildExamProgressIndex(rows);
  // Build folder children at current libraryFolderPath depth
  const depth = subjectSelected ? libraryFolderPath.length : 0;
  const prefixMatches = rows.filter((ex) => {
    if (!subjectSelected) return true;
    const fp = ex.folderPath || [];
    for (let i = 0; i < depth; i++) {
      if (fp[i] !== libraryFolderPath[i]) return false;
    }
    return true;
  });

  if (!subjectSelected && currentSubjectFilter === 'all') {
    const subjects = getSubjectsList().filter(s => prefixMatches.some(ex => ex.subjectKey === s.key));
    const cardHtml = (s) => {
      const count = prefixMatches.filter(ex => ex.subjectKey === s.key).length;
      return `<button type="button" class="room-folder-card" data-action="filter-subject" data-filter="${escapeHtml(s.key)}">
        <img class="room-folder-ico" src="Assets/icons/${s.icon || 'folder.svg'}" alt="">
        <div class="room-folder-info">
          <strong>${escapeHtml(s.name)}</strong>
          <span>${escapeHtml(s.zh || '')} · ${count} tests</span>
        </div>
      </button>`;
    };
    const mainList = subjects.filter(s => !s.isExtended);
    const extList = subjects.filter(s => s.isExtended).sort((a, b) => naturalCompare(a.name, b.name));
    return `<div class="room-folder-grid">${mainList.map(cardHtml).join('')}</div>
      ${extList.length ? `<details class="room-advanced"><summary>Extended Subjects (${extList.length}) · Click to expand</summary>
        <div class="room-folder-grid" style="margin-top:12px;">${extList.map(cardHtml).join('')}</div></details>` : ''}`;
  }

  const folders = new Map();
  const directItems = [];
  for (const ex of prefixMatches) {
    const fp = ex.folderPath || [];
    if (fp.length > depth) {
      const subName = fp[depth];
      let meta = folders.get(subName);
      if (!meta) {
        meta = { count: 0, ongoingCount: 0, completedCount: 0, hasNative: false, bestCat: 9, bestYear: 0 };
        folders.set(subName, meta);
      }
      meta.count++;
      const st = prog.get(ex.id);
      if (st?.ongoing) meta.ongoingCount++;
      else if (st?.completed) meta.completedCount++;
      if (ex.mode === 'native') meta.hasNative = true;
      const cp = CATEGORY_PRIORITY[ex.category] ?? 9;
      if (cp < meta.bestCat) meta.bestCat = cp;
      const yr = extractYear(ex.title);
      if (yr > meta.bestYear) meta.bestYear = yr;
    } else {
      directItems.push(ex);
    }
  }

  const folderBucket = (m) => (m.ongoingCount > 0 ? 0 : (m.completedCount < m.count ? 1 : 2));
  const sortedFolders = [...folders.entries()].sort(([nameA, ma], [nameB, mb]) => {
    if (librarySort === 'title') return naturalCompare(nameA, nameB);
    if (librarySort === 'year') {
      const ya = Math.max(extractYear(nameA), ma.bestYear);
      const yb = Math.max(extractYear(nameB), mb.bestYear);
      if (yb !== ya) return yb - ya;
      return naturalCompare(nameA, nameB);
    }
    if (librarySort === 'recommended') {
      const fd = folderBucket(ma) - folderBucket(mb);
      if (fd !== 0) return fd;
    }
    const nd = (ma.hasNative ? 0 : 1) - (mb.hasNative ? 0 : 1);
    if (nd !== 0) return nd;
    if (librarySort === 'recommended' && ma.bestCat !== mb.bestCat) return ma.bestCat - mb.bestCat;
    return naturalCompare(nameA, nameB);
  });

  const subObj = getSubjectsList().find(s => s.key === currentSubjectFilter);
  const crumbs = [
    `<button type="button" class="room-crumb" data-action="crumb-root">${escapeHtml(subObj ? subObj.name : 'All')}</button>`,
    ...libraryFolderPath.map((f, i) => `<span class="room-crumb-sep">/</span><button type="button" class="room-crumb" data-action="crumb-depth" data-depth="${i + 1}">${escapeHtml(f)}</button>`),
  ].join('');

  const folderMetaText = (m) => {
    if (m.ongoingCount > 0) return `${m.ongoingCount} in progress · ${m.count} items`;
    if (m.completedCount === m.count && m.count > 0) return `${m.count} completed`;
    if (m.completedCount > 0) return `${m.completedCount}/${m.count} done · ${m.count} items`;
    return `${m.count} item${m.count === 1 ? '' : 's'}`;
  };

  const folderCards = sortedFolders.map(([fname, meta]) => `
    <button type="button" class="room-folder-card" data-action="open-folder" data-folder="${escapeHtml(fname)}">
      <img class="room-folder-ico" src="Assets/icons/folder.svg" alt="">
      <div class="room-folder-info">
        <strong>${escapeHtml(fname)}</strong>
        <span>${folderMetaText(meta)}</span>
      </div>
    </button>`).join('');

  let itemsHtml = '';
  if (directItems.length) {
    const pg = paginateList(directItems);
    itemsHtml = `${renderExamListMarkup(pg.pageItems, prog)}${renderPaginationBar(pg)}`;
  }

  return `<nav class="room-breadcrumbs" aria-label="Folder path">${crumbs}</nav>
    ${folderCards ? `<div class="room-folder-grid">${folderCards}</div>` : ''}
    ${itemsHtml}
    ${(!folderCards && !itemsHtml) ? '<p class="room-meta">This folder has no tests matching your current search/filter.</p>' : ''}`;
}

function renderMistakesMarkup() {
  const all = loadGlobalMistakes();
  const subjs = [...new Map(all.map(m => [m.subjectKey, m.subject]))];
  const filtered = mistakeSubjectFilter === 'all' ? all : all.filter(m => m.subjectKey === mistakeSubjectFilter);
  const nativePracticeCount = filtered.filter(m => m.mode !== 'pdf').length;

  return `<div class="room-mistakes-hub">
    <div class="room-heading">
      <div>
        <h1>Mistake Bank</h1>
        <p class="room-meta">Missed questions collected automatically from your tests. Practice them as a focused set or push them directly to Anki.</p>
      </div>
      <div class="room-row-actions">
        <button type="button" class="btn room-yellow" data-action="practice-mistakes" ${nativePracticeCount ? '' : 'disabled'}>Practice Missed (${nativePracticeCount})</button>
        <button type="button" class="btn btn-primary" data-action="push-anki-mistakes" ${filtered.length ? '' : 'disabled'}>${roomIcon('anki') || ''} Push to Anki (${filtered.length})</button>
        <button type="button" class="btn btn-secondary" data-action="clear-mistakes" ${all.length ? '' : 'disabled'}>Clear</button>
      </div>
    </div>
    <div id="room-anki-status" class="room-anki-banner" hidden></div>
    <div class="room-filters">
      <button type="button" class="room-filter ${mistakeSubjectFilter === 'all' ? 'active' : ''}" data-action="filter-mistake-subj" data-filter="all">All Subjects (${all.length})</button>
      ${subjs.map(([k, name]) => `<button type="button" class="room-filter ${mistakeSubjectFilter === k ? 'active' : ''}" data-action="filter-mistake-subj" data-filter="${escapeHtml(k)}">${escapeHtml(name)}</button>`).join('')}
    </div>
    ${filtered.length ? `<ul class="room-list">${filtered.map(m => `
      <li class="room-row room-mistake-row" data-mistake-exam="${escapeHtml(m.examId)}" data-mistake-orig="${m.origId}">
        <div class="room-item">
          <span class="room-tile-icon">${roomIcon(m.subjectKey)}</span>
          <div>
            <strong>${escapeHtml(m.title)} · Q${m.origId}</strong>
            <div class="room-meta">${escapeHtml(m.stemPreview || '')}</div>
            <div class="room-meta">Your answer: <span class="room-mistake-choice is-incorrect">${escapeHtml(m.yourAnswer)}</span> · Correct: <span class="room-mistake-choice is-correct">${escapeHtml(m.correctAnswer)}</span></div>
          </div>
        </div>
        <div class="room-row-actions">
          <button type="button" class="btn btn-secondary" data-action="open-mistake-question" data-exam-id="${escapeHtml(m.examId)}" data-orig="${m.origId}">Open Q${m.origId}</button>
        </div>
      </li>`).join('')}</ul>` : '<div class="room-empty-box"><p>No missed questions recorded yet! Wrong answers from any completed test will automatically appear here.</p></div>'}
  </div>`;
}

function renderLibrary() {
  const all = Object.values(EXAMS);
  const subjects = getSubjectsList();
  const focusSet = new Set(typeof roomFocusSubjects === 'function' ? roomFocusSubjects() : []);
  const mainSubjects = subjects.filter(s => !s.isExtended).sort((a, b) => (focusSet.has(b.key) ? 1 : 0) - (focusSet.has(a.key) ? 1 : 0));
  const extSubjects = subjects.filter(s => s.isExtended);
  const attempts = allAttempts();
  const mistakesList = loadGlobalMistakes();
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  const filter = (action, key, caption, active) =>
    `<button type="button" data-action="${action}" data-filter="${escapeHtml(key)}" class="room-filter ${active ? 'active' : ''}" aria-pressed="${active}">${caption}</button>`;

  const normNum = (s) => String(s || '').toLowerCase().replace(/\b0+(\d+)\b/g, '$1');
  const qTokens = normNum(librarySearch).trim().split(/\s+/).filter(Boolean);
  const filteredRows = all.filter((ex) => {
    if (currentSubjectFilter !== 'all' && ex.subjectKey !== currentSubjectFilter) return false;
    if (currentCategoryFilter !== 'all' && ex.category !== currentCategoryFilter) return false;
    if (!qTokens.length) return true;
    const hay = normNum(`${ex.title} ${ex.subject} ${ex.subjectZh || ''} ${(ex.folderPath || []).join(' ')}`);
    return qTokens.every(t => hay.includes(t));
  });
  const progressMap = buildExamProgressIndex(filteredRows);
  const rows = sortExams(filteredRows, progressMap);

  let mainContent = '';
  if (libraryView === 'settings') {
    mainContent = roomSettingsMarkup();
  } else if (libraryView === 'stats') {
    mainContent = typeof renderStatsMarkup === 'function' ? renderStatsMarkup() : '';
  } else if (libraryView === 'history') {
    mainContent = roomHistoryMarkup(attempts);
  } else if (libraryView === 'mistakes') {
    mainContent = renderMistakesMarkup();
  } else {
    const sortSelect = renderRoomDropdown({
      id: 'room-sort',
      value: librarySort,
      options: [
        { value: 'recommended', label: 'Recommended' },
        { value: 'title', label: 'Title (A–Z)' },
        { value: 'year', label: 'Year (Newest First)' },
        { value: 'native', label: 'Interactive Native First' },
      ],
      pickAction: 'pick-sort',
      openUp: false,
      compact: false,
      ariaLabel: 'Sort tests',
    });

    const viewButtons = `
      <div class="room-view-switch" role="group" aria-label="View mode">
        <button type="button" class="room-vbtn ${libraryDisplayMode === 'folder' ? 'is-active' : ''}" data-action="set-display-mode" data-mode="folder" title="Folder View">
          <img src="Assets/icons/folder.svg" alt="" width="16" height="16"> Folders
        </button>
        <button type="button" class="room-vbtn ${libraryDisplayMode === 'grid' ? 'is-active' : ''}" data-action="set-display-mode" data-mode="grid" title="Icon Grid View">
          <img src="Assets/icons/grid.svg" alt="" width="16" height="16"> Grid
        </button>
        <button type="button" class="room-vbtn ${libraryDisplayMode === 'list' ? 'is-active' : ''}" data-action="set-display-mode" data-mode="list" title="Compact List View">
          <img src="Assets/icons/list.svg" alt="" width="16" height="16"> List
        </button>
      </div>`;

    let resultsArea = '';
    const useFolderTree = libraryDisplayMode === 'folder' && !qTokens.length && currentCategoryFilter === 'all';
    if (useFolderTree) {
      resultsArea = renderFolderHierarchy(rows, currentSubjectFilter !== 'all', progressMap);
    } else if (!rows.length) {
      resultsArea = '<div class="room-empty-box"><p>No tests match your filters. Try clearing your search or choosing another category.</p></div>';
    } else if (libraryDisplayMode === 'grid') {
      const pg = paginateList(rows);
      resultsArea = `<div class="room-cards-grid">${pg.pageItems.map(ex => renderExamItemMarkup(ex, 'grid', progressMap)).join('')}</div>${renderPaginationBar(pg)}`;
    } else {
      const pg = paginateList(rows);
      resultsArea = `${renderExamListMarkup(pg.pageItems, progressMap)}${renderPaginationBar(pg)}`;
    }

    mainContent = `
      ${roomGreeting(attempts)}
      <div class="room-bank-layout">
        <aside class="room-sidebar" aria-label="Subjects">
          <div class="room-sidebar-group">
            <button type="button" class="room-nav-item ${currentSubjectFilter === 'all' ? 'is-active' : ''}" data-action="filter-subject" data-filter="all">
              <img src="Assets/icons/mock.svg" alt="" width="22" height="22">
              <span class="room-nav-lbl">All Subjects</span>
              <span class="room-nav-cnt">${all.length}</span>
            </button>
          </div>
          <div class="room-sidebar-label">Main AP Subjects (7)</div>
          <div class="room-sidebar-group">
            ${mainSubjects.map(s => `
              <button type="button" class="room-nav-item ${currentSubjectFilter === s.key ? 'is-active' : ''}" data-action="filter-subject" data-filter="${escapeHtml(s.key)}">
                <img src="Assets/icons/${s.icon || 'folder.svg'}" alt="" width="22" height="22">
                <span class="room-nav-lbl">${escapeHtml(s.zh || s.name)}${focusSet.has(s.key) ? ' <span class="room-focus-star" title="My AP Subject">★</span>' : ''}</span>
                <span class="room-nav-cnt">${all.filter(e => e.subjectKey === s.key).length}</span>
              </button>`).join('')}
          </div>
          ${extSubjects.length ? `
            <details class="room-ext-accordion" ${extendedExpanded ? 'open' : ''}>
              <summary class="room-sidebar-label room-ext-sum">Extended Subjects (${extSubjects.length})</summary>
              <div class="room-sidebar-group">
                ${extSubjects.map(s => `
                  <button type="button" class="room-nav-item ${currentSubjectFilter === s.key ? 'is-active' : ''}" data-action="filter-subject" data-filter="${escapeHtml(s.key)}">
                    <img src="Assets/icons/${s.icon || 'extended.svg'}" alt="" width="20" height="20">
                    <span class="room-nav-lbl">${escapeHtml(s.name)}</span>
                    <span class="room-nav-cnt">${all.filter(e => e.subjectKey === s.key).length}</span>
                  </button>`).join('')}
              </div>
            </details>` : ''}
        </aside>

        <section class="room-bank-main">
          <div class="room-toolbar-top">
            <div class="room-search-wrap">
              <input id="room-search" type="search" value="${escapeHtml(librarySearch)}" placeholder="Search tests, folders, units, years...">
            </div>
            <div class="room-toolbar-controls">
              ${sortSelect}
              ${viewButtons}
            </div>
          </div>
          <div class="room-filters">
            ${filter('filter-category', 'all', `All (${rows.length})`, currentCategoryFilter === 'all')}
            ${Object.entries(labels).map(([k, v]) => filter('filter-category', k, escapeHtml(v), currentCategoryFilter === k)).join('')}
          </div>
          ${resultsArea}
        </section>
      </div>`;
  }

  document.getElementById('app').innerHTML = `
    <div class="room">
      <header class="room-header">
        <strong class="room-brand"><span class="room-mark">${roomLogo()}</span> AP Exam Room</strong>
        <nav>
          ${filter('room-view', 'bank', 'Question Bank', libraryView === 'bank')}
          ${filter('room-view', 'stats', 'Stats', libraryView === 'stats')}
          ${filter('room-view', 'mistakes', `Mistakes <span class="room-pill-badge">${mistakesList.length}</span>`, libraryView === 'mistakes')}
          ${filter('room-view', 'history', 'Test History', libraryView === 'history')}
          ${filter('room-view', 'settings', 'Settings', libraryView === 'settings')}
          <button class="btn btn-secondary" type="button" data-action="room-toggle-theme" aria-pressed="${isDark}">${isDark ? '☀ Light' : '☾ Dark'}</button>
        </nav>
      </header>
      <main class="room-content">${mainContent}</main>
    </div>
    <input type="file" id="room-file" accept=".json,application/json" hidden>
    <dialog id="room-import-dialog"><form method="dialog"><h2>Import a Question Bank</h2><p id="room-preview"></p><div class="room-row-actions"><button class="btn btn-secondary" value="cancel">Cancel</button><button class="btn btn-primary" id="room-import-confirm" value="confirm">Import Tests</button></div></form></dialog>`;

  const extAcc = document.querySelector('.room-ext-accordion');
  if (extAcc) {
    extAcc.addEventListener('toggle', () => {
      extendedExpanded = extAcc.open;
      saveUiPrefs();
    });
  }
}

function importMarkup(value) {
  const template = document.createElement('template');
  template.innerHTML = String(value ?? '');
  const allowed = /^(P|DIV|SPAN|BR|PRE|CODE|B|STRONG|I|EM|U|SUP|SUB|H[1-6]|UL|OL|LI|TABLE|THEAD|TBODY|TFOOT|TR|TD|TH|COL|COLGROUP|IMG|MATH|MROW|MN|MI|MO|MTEXT|MSUB|MSUP|MFRAC|MSQRT|MSTYLE|SEMANTICS|ANNOTATION)$/i;
  for (const el of template.content.querySelectorAll('*')) {
    if (!allowed.test(el.tagName)) { el.remove(); continue; }
    for (const attr of [...el.attributes]) {
      const image = el.tagName === 'IMG' && attr.name === 'src' && /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(attr.value);
      if (!image && !/^(alt|class|colspan|rowspan|width|height|encoding)$/.test(attr.name)) el.removeAttribute(attr.name);
    }
  }
  return template.innerHTML;
}

function normalizeImport(raw, restoring = false) {
  const sets = Array.isArray(raw) ? raw : Array.isArray(raw?.exams) ? raw.exams : [raw];
  if (!sets.length) throw Error('This file contains no tests.');
  const ids = new Set();
  return sets.map((s, i) => {
    if (!s || typeof s.title !== 'string' || !s.title.trim() || !Array.isArray(s.questions) || !s.questions.length) throw Error(`Test ${i + 1} needs a title and a nonempty questions array.`);
    const id = restoring ? s.id : 'import_' + String(s.id ?? s.title).trim().replace(/[^\p{L}\p{N}_-]+/gu, '_');
    if (restoring && (typeof id !== 'string' || !/^import_[\p{L}\p{N}_-]*$/u.test(id))) throw Error('An imported test has an invalid ID.');
    if ((!restoring && Object.hasOwn(EXAMS, id)) || ids.has(id)) throw Error(`This test already exists: ${s.title}. Use a different ID.`);
    ids.add(id);
    const answers = Object.create(null), explanations = Object.create(null), used = new Set();
    const questions = s.questions.map((q, j) => {
      if (!q || !Array.isArray(q.options ?? [])) throw Error(`Question ${j + 1} needs an options array.`);
      const origId = Number(q.origId ?? q.number ?? j + 1);
      if (!Number.isSafeInteger(origId) || origId < 1 || used.has(origId)) throw Error(`Question ${j + 1} has an invalid or duplicate number.`);
      used.add(origId);
      const stemHtml = importMarkup(q.stemHtml ?? q.stem ?? q.question), promptHtml = importMarkup(q.promptHtml);
      if (!stemHtml.trim() && !promptHtml.trim()) throw Error(`Question ${j + 1} needs a prompt.`);
      const options = (q.options ?? []).map((o, k) => {
        const letter = String(o?.letter ?? o?.sign ?? String.fromCharCode(65 + k)).toUpperCase();
        const html = importMarkup(typeof o === 'string' ? o : o?.html ?? o?.content ?? o?.text);
        if (!/^[A-Z]$/.test(letter) || !html.trim()) throw Error(`Question ${j + 1} has an invalid choice.`);
        return { letter, html };
      });
      if (new Set(options.map(o => o.letter)).size !== options.length) throw Error(`Question ${j + 1} has duplicate choice letters.`);
      const answer = String(q.correctAnswer ?? q.answer ?? s.answers?.[origId] ?? '').trim().toUpperCase();
      if (answer && answer !== 'N' && !options.some(o => o.letter === answer)) throw Error(`Question ${j + 1} has an answer that is not an available choice.`);
      if (answer && answer !== 'N') answers[origId] = answer;
      explanations[origId] = importMarkup(q.analysis || q.explanation || s.explanations?.[origId]);
      return { origId, stemHtml, promptHtml, options, topic: typeof q.topic === 'string' ? q.topic : '', rationaleHtml: importMarkup(q.rationaleHtml) };
    });
    const frqQuestions = (s.frqQuestions ?? []).map((q, j) => {
      const stemHtml = importMarkup(q.stemHtml ?? q.stem ?? q.question);
      const promptHtml = importMarkup(q.promptHtml);
      if (!stemHtml.trim() && !promptHtml.trim()) throw Error(`Free-response question ${j + 1} needs a prompt.`);
      return { origId: j + 1, stemHtml, promptHtml, scoringHtml: importMarkup(q.rubricHtml ?? q.scoringHtml ?? q.answerHtml ?? q.analysis) };
    });
    const durationSeconds = Number(s.durationSeconds ?? (Number(s.timeLimit || 30) * 60));
    const frqDurationSeconds = Number(s.frqDurationSeconds ?? 5400);
    if (![durationSeconds, frqDurationSeconds].every(n => Number.isFinite(n) && n >= 1 && n <= 21600)) throw Error('Test duration must be between 1 second and 6 hours.');
    const subject = String(s.subject || 'Custom Subject'), subjectKey = String(s.subjectKey || ({ CSA: 'csa', 'AP Computer Science A': 'csa', 微观经济: 'micro', 'AP Microeconomics': 'micro', 'AP Statistics': 'stats' }[subject] || subject));
    return {
      id, title: s.title.trim(), subject, subjectKey,
      category: ({ 课后作业: 'homework', 全真模考: 'mock', 单元Quiz: 'quiz' }[s.category] || (Object.hasOwn(labels, s.category) ? s.category : 'homework')),
      folderPath: ['Imported Tests'],
      mode: 'native',
      durationSeconds, frqDurationSeconds, breakMinutes: 10, questions, frqQuestions, hasFrq: !!frqQuestions.length, answers, explanations,
    };
  });
}

let pendingImport = [];
document.addEventListener('change', async (event) => {
  if (event.target.id !== 'room-file' || !event.target.files[0]) return;
  const file = event.target.files[0];
  const dialog = document.getElementById('room-import-dialog'), preview = document.getElementById('room-preview'), confirm = document.getElementById('room-import-confirm');
  pendingImport = [];
  confirm.hidden = true;
  try {
    if (file.size > 4_000_000) throw Error('Each import is limited to 4 MB. Split the question bank into smaller files.');
    pendingImport = normalizeImport(JSON.parse(await file.text()));
    const n = pendingImport.reduce((a, e) => a + e.questions.length + e.frqQuestions.length, 0);
    const graded = pendingImport.reduce((a, e) => a + Object.keys(e.answers).length, 0);
    preview.textContent = `${pendingImport.length} tests · ${n} questions · ${graded} with an answer key.`;
    confirm.hidden = false;
  } catch (error) { preview.textContent = error.message; }
  event.target.value = '';
  dialog.showModal();
});

async function pushMistakesToAnki(list) {
  const banner = document.getElementById('room-anki-status');
  const setBanner = (msg, ok) => {
    if (!banner) return;
    banner.hidden = false;
    banner.className = 'room-anki-banner ' + (ok ? 'is-ok' : 'is-err');
    banner.textContent = msg;
  };
  setBanner(`Connecting to AnkiConnect for ${list.length} missed question(s)...`, true);

  async function ac(action, params = {}) {
    const body = JSON.stringify({ action, version: 6, params });
    let lastErr;
    for (const port of [8765, 8766]) {
      try {
        const resTxt = await roomLocalFetch(`http://127.0.0.1:${port}`, { method: 'POST', body });
        const parsed = JSON.parse(resTxt);
        if (parsed.error) throw new Error(parsed.error);
        return parsed.result;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('AnkiConnect unreachable on 8765/8766');
  }

  try {
    await ac('version');
    const byDeck = new Map();
    for (const m of list) {
      const deck = `AP::模考错题::${m.subject || m.subjectKey}`;
      if (!byDeck.has(deck)) byDeck.set(deck, []);
      const front = `<h3>${escapeHtml(m.title)} · Q${m.origId}</h3><p>${escapeHtml(m.stemPreview || '')}</p><p><strong>Topic:</strong> ${escapeHtml(m.topic || 'General')}</p>`;
      const back = `<p><strong>Correct Answer:</strong> ${escapeHtml(m.correctAnswer)} (Your attempt: ${escapeHtml(m.yourAnswer)})</p>${m.explanationHtml || ''}`;
      byDeck.get(deck).push({
        deckName: deck,
        modelName: 'Basic',
        fields: { Front: front, Back: back },
        options: { allowDuplicate: false },
        tags: ['ap-exam-room', m.subjectKey],
      });
    }
    let added = 0;
    for (const [deck, notes] of byDeck.entries()) {
      await ac('createDeck', { deck });
      const res = await ac('addNotes', { notes });
      added += (res || []).filter(Boolean).length;
    }
    setBanner(`Pushed ${added} new card(s) to Anki (${list.length - added} already existed).`, true);
  } catch (err) {
    setBanner(`AnkiConnect Error: ${err.message}. Ensure Anki is open with AnkiConnect installed.`, false);
  }
}

async function launchMistakePractice(list) {
  const nativeList = list.filter(m => m.mode !== 'pdf');
  if (!nativeList.length) return;
  const loadedIds = [...new Set(nativeList.map(m => m.examId))];
  for (const id of loadedIds) await ensureExamLoaded(id);

  const questions = [];
  const answers = {};
  const explanations = {};
  let idx = 1;
  for (const m of nativeList.slice(0, 40)) {
    const src = EXAMS[m.examId];
    const q = src?.questions?.find(x => x.origId === m.origId);
    if (!q) continue;
    const copy = structuredClone(q);
    copy.origId = idx;
    copy.topic = `${m.title} #${m.origId}${q.topic ? ' · ' + q.topic : ''}`;
    questions.push(copy);
    if (m.correctAnswer) answers[String(idx)] = m.correctAnswer;
    if (src.explanations?.[m.origId]) explanations[String(idx)] = src.explanations[m.origId];
    idx++;
  }
  if (!questions.length) return;
  const pId = 'mistake_practice_session';
  EXAMS[pId] = {
    id: pId,
    _stub: false,
    title: `Mistake Review Set (${questions.length} Qs)`,
    subject: 'Mixed AP Review',
    subjectKey: nativeList[0].subjectKey,
    category: 'quiz',
    mode: 'native',
    durationSeconds: questions.length * 120,
    frqDurationSeconds: 0,
    hasFrq: false,
    breakMinutes: 0,
    calculator: 'graphing',
    referencePdf: '',
    referenceType: '',
    questions,
    answers,
    explanations,
    frqQuestions: [],
  };
  currentExamId = pId;
  reviewedAttempt = null;
  state = emptyState();
  startNewExam({ timing: 'untimed', feedback: true, focus: false, mcq: null, frq: null, scoreIds: null });
}

document.addEventListener('click', async (event) => {
  if (!event.target.closest('.room-dropdown')) closeRoomDropdowns();
  const b = event.target.closest('button');
  if (!b) return;
  if (b.id === 'room-import-confirm') {
    try {
      const extra = Object.assign(readLibrary(libraryImportKey, {}), Object.fromEntries(pendingImport.map(ex => [ex.id, ex])));
      localStorage.setItem(libraryImportKey, JSON.stringify(extra));
      Object.assign(EXAMS, extra);
      currentSubjectFilter = 'all'; currentCategoryFilter = 'all'; libraryFolderPath = []; librarySearch = ''; libraryPage = 1; libraryView = 'bank';
      pendingImport = []; render();
    } catch { event.preventDefault(); document.getElementById('room-preview').textContent = 'There is not enough local storage to import these tests.'; }
    return;
  }
  const act = b.dataset.action;
  if (!act) return;

  const closeMoreDropdown = () => {
    if (b.closest('.more-menu')) {
      if (typeof ui !== 'undefined') ui.moreOpen = false;
      document.querySelectorAll('.more-menu.open').forEach(m => m.classList.remove('open'));
      document.querySelectorAll('[data-action="toggle-more"].active').forEach(t => t.classList.remove('active'));
    }
  };

  if (act === 'room-toggle-theme') {
    window.roomToggleTheme?.();
    closeMoreDropdown();
    return;
  }
  if (act === 'room-toggle-desmos') { window.roomToggleDesmos?.(); closeMoreDropdown(); return; }
  if (act === 'room-toggle-ref') { window.roomToggleRef?.(); closeMoreDropdown(); return; }
  if (act === 'room-import') { document.getElementById('room-file').click(); return; }
  if (act === 'room-view' && b.dataset.filter !== libraryView) {
    libraryView = b.dataset.filter;
    render();
    return;
  }
  if (act === 'filter-subject') {
    currentSubjectFilter = b.dataset.filter;
    libraryFolderPath = [];
    libraryPage = 1;
    render();
    return;
  }
  if (act === 'filter-category') {
    currentCategoryFilter = b.dataset.filter;
    libraryPage = 1;
    render();
    return;
  }
  if (act === 'set-display-mode') {
    libraryDisplayMode = b.dataset.mode;
    libraryPage = 1;
    saveUiPrefs();
    render();
    return;
  }
  if (act === 'open-folder') {
    libraryFolderPath.push(b.dataset.folder);
    libraryPage = 1;
    render();
    return;
  }
  if (act === 'crumb-root') {
    libraryFolderPath = [];
    libraryPage = 1;
    render();
    return;
  }
  if (act === 'crumb-depth') {
    libraryFolderPath = libraryFolderPath.slice(0, Number(b.dataset.depth));
    libraryPage = 1;
    render();
    return;
  }
  if (act === 'toggle-dropdown') {
    const dd = b.closest('.room-dropdown');
    if (dd) {
      const opening = !dd.classList.contains('is-open');
      closeRoomDropdowns(opening ? dd : null);
      dd.classList.toggle('is-open', opening);
      b.setAttribute('aria-expanded', opening ? 'true' : 'false');
      const menu = dd.querySelector('.room-dd-menu');
      if (menu) menu.hidden = !opening;
    }
    return;
  }
  if (act === 'pick-sort') {
    librarySort = b.dataset.value || 'recommended';
    libraryPage = 1;
    saveUiPrefs();
    render();
    return;
  }
  if (act === 'pick-page-size') {
    const sz = Number(b.dataset.value);
    if ([48, 96, 150].includes(sz)) {
      libraryPageSize = sz;
      libraryPage = 1;
      saveUiPrefs();
      render();
    }
    return;
  }
  if (act === 'set-page') {
    const nextP = Number(b.dataset.page);
    if (Number.isFinite(nextP) && nextP >= 1 && nextP !== libraryPage) {
      libraryPage = nextP;
      render();
      document.querySelector('.room-bank-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return;
  }
  if (act === 'filter-mistake-subj') {
    mistakeSubjectFilter = b.dataset.filter;
    render();
    return;
  }
  if (act === 'practice-mistakes') {
    const all = loadGlobalMistakes();
    const list = mistakeSubjectFilter === 'all' ? all : all.filter(m => m.subjectKey === mistakeSubjectFilter);
    await launchMistakePractice(list);
    return;
  }
  if (act === 'push-anki-mistakes') {
    const all = loadGlobalMistakes();
    const list = mistakeSubjectFilter === 'all' ? all : all.filter(m => m.subjectKey === mistakeSubjectFilter);
    await pushMistakesToAnki(list);
    return;
  }
  if (act === 'clear-mistakes') {
    const prev = loadGlobalMistakes();
    if (!prev.length) return;
    saveGlobalMistakes([]);
    render();
    window.roomPushUndo?.({
      label: `Cleared ${prev.length} mistake${prev.length === 1 ? '' : 's'}`,
      undo() {
        saveGlobalMistakes(prev);
        render();
      },
    });
    return;
  }
  if (act === 'remove-mistake') {
    const eid = b.dataset.examId;
    const orig = Number(b.dataset.orig);
    const prev = loadGlobalMistakes();
    saveGlobalMistakes(prev.filter(m => !(m.examId === eid && Number(m.origId) === orig)));
    render();
    window.roomPushUndo?.({
      label: `Marked Q${orig} as mastered`,
      undo() {
        saveGlobalMistakes(prev);
        render();
      },
    });
    return;
  }
  if (act === 'open-mistake-question') {
    const eid = b.dataset.examId;
    const orig = Number(b.dataset.orig);
    const ex = await ensureExamLoaded(eid);
    if (!ex) return;
    if (ex.mode === 'pdf') {
      currentExamId = eid;
      reviewedAttempt = null;
      state = emptyState();
      startNewExam({
        timing: 'untimed', feedback: true, focus: false,
        pdf: { startPage: ex.defaultStartPage || 1, endPage: ex.defaultEndPage || ex.totalPages || 1, questionStartNum: Math.max(1, orig), questionCount: ex.defaultQuestionCount || 25, sectionKind: ex.sectionKind || 'mcq' },
      });
    } else {
      const saved = readLibrary(getStorageKey(eid), {});
      if (['complete', 'results'].includes(saved.phase)) {
        currentExamId = eid;
        reviewedAttempt = null;
        state = loadState() || emptyState();
        closeAllUi();
        openResults();
        resultView = 'question';
        state.resultsTab = 'mcq';
        state.mcq.resultQuestion = orig;
        render();
      } else {
        currentExamId = eid;
        reviewedAttempt = null;
        state = emptyState();
        startNewExam({ timing: 'untimed', feedback: true, focus: false, mcq: [orig], frq: [] });
      }
    }
    return;
  }
  if (act === 'room-toggle-mistake') {
    window.roomToggleManualMistake(b.dataset.examId || currentExamId, Number(b.dataset.orig));
    return;
  }
  if (act === 'room-open') {
    const id = b.dataset.examId;
    await ensureExamLoaded(id);
    const saved = readLibrary(getStorageKey(id), {});
    if (b.dataset.mode !== 'review' && !['mcq_exam', 'mcq_check', 'frq_exam', 'frq_check', 'break'].includes(saved.phase)) {
      roomSetup(id);
      return;
    }
    currentExamId = id;
    reviewedAttempt = null;
    state = loadState() || emptyState();
    closeAllUi();
    if (b.dataset.mode === 'review') openResults();
    else if (state.roomSettings?.focus) roomFocus(true);
    render();
    return;
  }
  if (act === 'room-results-overview') { resultView = 'overview'; render(); return; }
  if (act === 'room-exit-focus') {
    const native = window.webkit?.messageHandlers?.roomExitFocus;
    if (native) native.postMessage(true);
    else if (window.confirm('Exit Focus Mode? Your responses and timer will be preserved.')) leaveRoomFocus();
    return;
  }
  if (act === 'room-export') {
    const attempt = allAttempts()[Number(b.dataset.index)];
    if (attempt) { await ensureExamLoaded(attempt.examId); exportMistakes(attempt); }
    return;
  }
  if (act === 'room-retake') {
    const id = b.dataset.examId;
    await ensureExamLoaded(id);
    roomSetup(id);
    return;
  }
  if (act === 'room-history-open') {
    const item = allAttempts()[Number(b.dataset.index)];
    if (!item || !EXAMS[item.examId]) return;
    await ensureExamLoaded(item.examId);
    reviewedAttempt = item;
    currentExamId = item.examId;
    state = structuredClone(item.state);
    closeAllUi();
    openResults();
    render();
    return;
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'room-search') {
    const pos = event.target.selectionStart;
    librarySearch = event.target.value;
    libraryPage = 1;
    render();
    const input = document.getElementById('room-search');
    if (input) { input.focus(); input.setSelectionRange(pos, pos); }
  }
});

document.addEventListener('change', (event) => {
  const act = event.target?.dataset?.action;
  if (act === 'set-sort') {
    librarySort = event.target.value || 'recommended';
    libraryPage = 1;
    saveUiPrefs();
    render();
  } else if (act === 'set-page-size') {
    const sz = Number(event.target.value);
    if ([48, 96, 150].includes(sz)) {
      libraryPageSize = sz;
      libraryPage = 1;
      saveUiPrefs();
      render();
    }
  } else if (act === 'jump-page') {
    const maxP = Number(event.target.max) || 1;
    const targetP = Math.max(1, Math.min(maxP, parseInt(event.target.value, 10) || 1));
    libraryPage = targetP;
    render();
    document.querySelector('.room-bank-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeRoomDropdowns();
  if (event.key === 'Enter' && event.target?.dataset?.action === 'jump-page') {
    event.preventDefault();
    event.target.dispatchEvent(new Event('change', { bubbles: true }));
  }
});

function returnToLibrary() {
  document.querySelector('.room-answer-dialog')?.close();
  window.roomCloseFloatingTools?.();
  if (state.roomSettings?.focus && ['mcq_exam', 'mcq_check', 'frq_exam', 'frq_check', 'break'].includes(state.phase)) return;
  if (!reviewedAttempt && state.phase !== 'intro') saveState();
  reviewedAttempt = null;
  state = emptyState();
  closeAllUi();
  libraryView = 'bank';
  renderLibrary();
}

function roomTransition(label, done) {
  done();
}

async function roomSetup(examId) {
  const ex = await ensureExamLoaded(examId);
  const dialog = document.createElement('dialog');
  dialog.className = 'room-dialog room-setup-dialog';

  if (ex.mode === 'pdf') {
    const sP = ex.defaultStartPage || 1;
    const eP = ex.defaultEndPage || ex.totalPages || 1;
    const extCount = Object.keys(ex.extractedAnswers || {}).length;
    dialog.innerHTML = `<form method="dialog">
      <div class="room-meta">${roomIcon(ex.category)} ${escapeHtml(labels[ex.category] || 'PDF Practice')} · Dual-Pane PDF Mode</div>
      <h2>Set Up PDF Test</h2>
      <h3>${escapeHtml(ex.title)}</h3>
      <p class="room-meta">${escapeHtml(ex.subject)} · Total PDF Pages: ${ex.totalPages || eP}${extCount ? ` · <strong>${extCount} Auto-Gradable MCQ Keys Loaded</strong>` : ''}${ex.answerPdfRel ? ' · Answer Key PDF Paired' : ''}</p>
      <fieldset><legend>Section Type & Range (Start Anywhere)</legend>
        <div class="room-range-fields" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <label>Start Page <input name="startPage" type="number" min="1" max="${ex.totalPages || 999}" value="${sP}"></label>
          <label>End Page <input name="endPage" type="number" min="1" max="${ex.totalPages || 999}" value="${eP}"></label>
          <label>Start Question # <input name="questionStartNum" type="number" min="1" max="500" value="${ex.questionStartNum || 1}"></label>
          <label>Question Count <input name="questionCount" type="number" min="1" max="150" value="${ex.defaultQuestionCount || 25}"></label>
        </div>
        <div style="margin-top:8px;">
          <label><input type="radio" name="sectionKind" value="mcq" ${ex.sectionKind !== 'frq' ? 'checked' : ''}> MCQ Bubble Sheet + Auto-Check</label>
          <label><input type="radio" name="sectionKind" value="frq" ${ex.sectionKind === 'frq' ? 'checked' : ''}> FRQ Response Editor + Rubric Self-Score</label>
        </div>
      </fieldset>
      <fieldset><legend>Timing</legend>
        <label><input type="radio" name="timing" value="standard" checked> Standard time (${Math.max(5, Math.round((ex.durationSeconds || 2700) / 60))} min)</label>
        <label><input type="radio" name="timing" value="custom"> Custom minutes <input name="minutes" type="number" min="1" max="360" value="45" style="width:74px;margin-left:8px;"></label>
        <label><input type="radio" name="timing" value="untimed"> Untimed Practice</label>
      </fieldset>
      <div class="room-row-actions">
        <button class="btn btn-secondary" value="cancel" formnovalidate>Cancel</button>
        <button class="btn room-yellow" value="start">Launch PDF Exam</button>
      </div>
    </form>`;
    document.body.append(dialog);
    let settings;
    const form = dialog.querySelector('form');
    form.addEventListener('submit', (event) => {
      if (event.submitter?.value !== 'start') return;
      const startPage = Math.max(1, Number(form.elements.startPage.value) || 1);
      const endPage = Math.max(startPage, Math.min(ex.totalPages || 999, Number(form.elements.endPage.value) || startPage));
      settings = {
        timing: form.elements.timing.value,
        minutes: Number(form.elements.minutes.value) || 45,
        frqMinutes: Number(form.elements.minutes.value) || 45,
        feedback: true,
        focus: false,
        pdf: {
          startPage,
          endPage,
          questionStartNum: Math.max(1, Number(form.elements.questionStartNum.value) || 1),
          questionCount: Math.max(1, Number(form.elements.questionCount.value) || 25),
          sectionKind: form.elements.sectionKind.value,
        },
      };
    });
    dialog.addEventListener('close', () => {
      const go = dialog.returnValue === 'start' && settings;
      dialog.remove();
      if (!go) return;
      currentExamId = examId;
      reviewedAttempt = null;
      state = emptyState();
      state.pdf = null;
      startNewExam(settings);
    });
    dialog.showModal();
    return;
  }

  const known = ex.questions.filter(q => answerKeyOf(ex, q.origId)).length;
  const totalQ = ex.questions.length;
  dialog.innerHTML = `<form method="dialog"><div class="room-meta">${roomIcon(ex.category)} ${escapeHtml(labels[ex.category] || 'Practice')}</div>
    <h2>Set Up Your Test</h2><h3>${escapeHtml(ex.title)}</h3>
    <p>${escapeHtml(ex.subject)} · ${totalQ} questions${ex.frqQuestions.length ? ' · ' + ex.frqQuestions.length + ' FRQ' : ''} · ${known} with an answer key</p>
    <details class="room-advanced"><summary>View question list</summary>
      ${['mcq', 'frq'].map(section => {
        const questions = section === 'mcq' ? ex.questions : ex.frqQuestions;
        return questions.length ? `<h4>${sectionTitle(section)}</h4><ol class="room-preview-list">${questions.map(q => `<li>${escapeHtml(q.label || questionPreview(q))}</li>`).join('')}</ol>` : '';
      }).join('')}
    </details>
    <fieldset><legend>Sections to take</legend>
      <label><input type="radio" name="scope" value="both" checked> ${ex.hasFrq && totalQ ? 'Both sections' : ex.hasFrq ? 'FRQ Section II' : 'Multiple-choice questions'}</label>
      ${ex.hasFrq && totalQ ? `<label><input type="radio" name="scope" value="mcq"> Section I only</label><label><input type="radio" name="scope" value="frq"> Section II only</label>` : ''}
    </fieldset>
    <details class="room-advanced" open><summary>Start From & Custom Range</summary>
      ${totalQ ? `<div class="room-range-presets">
        <button type="button" class="room-preset-btn" data-range="">All (1–${totalQ})</button>
        ${totalQ > 10 ? `<button type="button" class="room-preset-btn" data-range="1-${Math.ceil(totalQ/2)}">First Half</button>
        <button type="button" class="room-preset-btn" data-range="${Math.ceil(totalQ/2)+1}-${totalQ}">Second Half</button>
        <button type="button" class="room-preset-btn" data-range="1-10">Q1–10</button>` : ''}
      </div>` : ''}
      <div class="room-range-fields"><label>Section I questions<input name="takeRange" placeholder="e.g. 5-${Math.max(1, totalQ)}"></label>
      ${ex.hasFrq ? `<label>Section II questions<input name="takeFrqRange" placeholder="1-${ex.frqQuestions.length}"></label>` : ''}
      <label>Score accuracy range<input name="scoreRange" placeholder="optional"></label></div>
    </details>
    <p class="room-setup-error" role="alert" hidden></p>
    <fieldset><legend>Timing</legend>
      <label><input type="radio" name="timing" value="standard" checked> Standard time (${Math.max(1, Math.round(ex.durationSeconds / 60))} min)</label>
      <label><input type="radio" name="timing" value="custom"> Custom time</label>
      <div class="room-minutes" hidden><label>Section I (minutes)<input name="minutes" type="number" min="1" max="360" value="${Math.max(1, Math.round(ex.durationSeconds / 60))}"></label>
      ${ex.hasFrq ? `<label>Section II (minutes)<input name="frqMinutes" type="number" min="1" max="360" value="${Math.max(1, Math.round((ex.frqDurationSeconds || 2700) / 60))}"></label>` : ''}</div>
      <label><input type="radio" name="timing" value="untimed"> Untimed</label>
    </fieldset>
    <fieldset><legend>Testing Options</legend>
      <label><input type="checkbox" name="feedback" ${known ? '' : 'disabled'} ${known ? 'checked' : ''}> Check answers during practice</label>
      <label><input type="checkbox" name="focus"> Focus mode</label>
    </fieldset>
    <div class="room-row-actions"><button class="btn btn-secondary" value="cancel" formnovalidate>Back to Question Bank</button><button class="btn room-yellow" value="start">Start Test</button></div>
    </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  form.querySelectorAll('.room-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      form.elements.takeRange.value = btn.dataset.range;
    });
  });
  form.addEventListener('change', () => {
    form.querySelector('.room-minutes').hidden = form.elements.timing.value !== 'custom';
    const focus = form.elements.focus.checked;
    form.elements.feedback.disabled = focus || !known;
    if (focus) form.elements.feedback.checked = false;
  });
  let settings;
  form.addEventListener('submit', event => {
    if (event.submitter?.value !== 'start') return;
    try {
      const scope = form.elements.scope.value || 'both';
      const mcq = scope === 'frq' || !totalQ ? [] : parseRoomRange(form.elements.takeRange.value, ex.questions, 'Section I');
      const frq = scope === 'mcq' || !ex.frqQuestions.length ? [] : parseRoomRange(form.elements.takeFrqRange?.value || '', ex.frqQuestions.map((_, i) => ({ origId: i + 1 })), 'Section II');
      const scoreIds = scope === 'frq' || !totalQ ? [] : parseRoomRange(form.elements.scoreRange.value, ex.questions.filter(q => !mcq || mcq.includes(q.origId)), 'Scoring range');
      settings = {
        timing: form.elements.timing.value,
        minutes: Number(form.elements.minutes.value),
        frqMinutes: Number(form.elements.frqMinutes?.value || 0),
        feedback: form.elements.feedback.checked,
        focus: form.elements.focus.checked,
        mcq,
        frq: frq?.map(i => ex.frqQuestions[i - 1].origId) ?? null,
        scoreIds,
      };
    } catch (error) {
      event.preventDefault();
      const box = form.querySelector('.room-setup-error');
      box.textContent = error.message; box.hidden = false;
    }
  });
  dialog.addEventListener('close', () => {
    const start = dialog.returnValue === 'start' && settings;
    dialog.remove();
    if (!start) return;
    currentExamId = examId;
    reviewedAttempt = null;
    state = loadState() || emptyState();
    startNewExam(settings);
  });
  dialog.showModal();
}

function roomTimer(section, fallback) {
  const setup = state.roomSettings;
  if (setup?.timing === 'untimed') return null;
  if (setup?.timing === 'custom') return (section === 'mcq' ? setup.minutes : setup.frqMinutes) * 60;
  return fallback;
}
function roomFocus(active) {
  const native = window.webkit?.messageHandlers?.roomFocus;
  if (native) { native.postMessage(Boolean(active)); return; }
  if (active) document.documentElement.requestFullscreen?.().catch(() => {});
  else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement || window.webkit?.messageHandlers?.roomFocus) return;
  if (state.roomSettings?.focus) leaveRoomFocus();
});
function canCheckAnswer(section, question) {
  return section === 'mcq' && state.roomSettings?.feedback && question.options?.length &&
    Boolean(answerKeyOf(getCurrentExam(), question.origId));
}
function playAnswerFeedback(right) {
  const sound = right ? 'correct' : 'incorrect';
  const native = window.webkit?.messageHandlers?.roomAnswerSound;
  if (native) native.postMessage(sound);
  else new Audio('Assets/answer-' + sound + '.wav').play().catch(() => {});
}
function alignAnswerDialog(dialog, anchorBtn, fallbackRect) {
  if (!dialog?.isConnected) return;
  const btnRect = anchorBtn?.isConnected ? anchorBtn.getBoundingClientRect() : fallbackRect;
  const continueBtn = dialog.querySelector('.room-answer-continue');
  const barInner = dialog.querySelector('.room-answer-bar-inner');
  if (!btnRect || !btnRect.width || !continueBtn || !barInner) return;
  continueBtn.style.minWidth = Math.ceil(btnRect.width) + 'px';
  continueBtn.style.minHeight = Math.round(btnRect.height) + 'px';
  barInner.style.paddingRight = '';
  barInner.style.paddingBottom = '';
  const contRect = continueBtn.getBoundingClientRect();
  if (Math.abs(contRect.right - btnRect.right) > 0.5 || Math.abs(contRect.bottom - btnRect.bottom) > 0.5) {
    const cs = getComputedStyle(barInner);
    const curPR = parseFloat(cs.paddingRight) || 0;
    const curPB = parseFloat(cs.paddingBottom) || 0;
    barInner.style.paddingRight = Math.max(0, Math.round(curPR + (contRect.right - btnRect.right))) + 'px';
    barInner.style.paddingBottom = Math.max(0, Math.round(curPB + (contRect.bottom - btnRect.bottom))) + 'px';
  }
}
function launchRoomConfetti(host, origins) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return () => {};
  const parent = host || document.body;
  if (!parent) return () => {};
  parent.querySelectorAll('.room-confetti-canvas').forEach(c => c.remove());
  const w = Math.max(320, window.innerWidth || 1280);
  const h = Math.max(320, window.innerHeight || 800);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.className = 'room-confetti-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  parent.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return () => {}; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const srcs = origins?.length ? origins : [
    { x: Math.round(w * 0.12), y: h - 32, angleMin: -82, angleMax: -32 },
    { x: Math.round(w * 0.88), y: h - 32, angleMin: -148, angleMax: -98 },
  ];
  const colors = ['#22c55e', '#facc15', '#3b82f6', '#fb7185', '#a855f7', '#14b8a6', '#f97316'];
  const total = 54;
  const particles = [];
  for (let i = 0; i < total; i++) {
    const src = srcs[i % srcs.length];
    const deg = src.angleMin + Math.random() * (src.angleMax - src.angleMin);
    const rad = deg * (Math.PI / 180);
    const speed = 9 + Math.random() * 7;
    particles.push({
      x: src.x + (Math.random() - 0.5) * 14,
      y: src.y + (Math.random() - 0.5) * 8,
      vx: Math.cos(rad) * speed,
      vy: Math.sin(rad) * speed,
      w: 6 + Math.random() * 5,
      h: 4 + Math.random() * 3,
      r: 3 + Math.random() * 1.5,
      circle: Math.random() < 0.28,
      color: colors[i % colors.length],
      tilt: Math.random() * Math.PI * 2,
      tiltSpeed: (Math.random() - 0.5) * 0.28,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.18,
      swayAmp: 0.35 + Math.random() * 0.55,
      swayPhase: Math.random() * Math.PI * 2,
    });
  }

  const duration = 1150;
  let rafId = 0;
  let stopped = false;
  const t0 = performance.now();

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
    canvas.remove();
  };

  function frame(now) {
    if (stopped) return;
    const elapsed = now - t0;
    if (elapsed >= duration || !canvas.isConnected) {
      stop();
      return;
    }
    ctx.clearRect(0, 0, w, h);
    const fadeStart = duration - 350;
    const alpha = elapsed > fadeStart ? Math.max(0, 1 - (elapsed - fadeStart) / 350) : 1;
    ctx.globalAlpha = alpha;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.vx *= 0.965;
      p.vy = p.vy * 0.965 + 0.34;
      p.x += p.vx + Math.sin(elapsed * 0.012 + p.swayPhase) * p.swayAmp;
      p.y += p.vy;
      p.tilt += p.tiltSpeed;
      p.rot += p.rotSpeed;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.circle) {
        ctx.beginPath();
        ctx.arc(0, 0, p.r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const sy = Math.max(0.25, Math.abs(Math.cos(p.tilt)));
        ctx.scale(1, sy);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);
  return stop;
}
window.launchRoomConfetti = launchRoomConfetti;

function roomCheckAnswer() {
  if (state.phase !== 'mcq_exam' || document.querySelector('.room-answer-dialog')) return;
  const ex = getCurrentExam();
  const q = currentQuestion('mcq');
  const selected = state.mcq.answers[q.origId];
  if (!selected || !canCheckAnswer('mcq', q)) return;
  const checkBtn = document.querySelector('.pager-btns .room-check-answer');
  const btnRect = checkBtn ? checkBtn.getBoundingClientRect() : null;
  const correct = answerKeyOf(ex, q.origId);
  const right = selected === correct;
  const last = state.mcq.currentIndex === state.mcq.order.length - 1;
  const dialog = document.createElement('dialog');
  dialog.className = 'room-dialog room-answer-dialog ' + (right ? 'is-correct' : 'is-incorrect');
  dialog.setAttribute('aria-labelledby', 'room-answer-title');
  dialog.innerHTML = `<form method="dialog" class="room-answer-form">
    <div class="room-answer-exp-panel" id="room-answer-exp-panel" aria-hidden="true">
      <div class="room-answer-exp-clip">
        <div class="room-answer-exp-inner">
          <div class="room-answer-exp-head">
            <span class="room-answer-key">Correct answer: ${escapeHtml(correct)}</span>
          </div>
          <div class="room-answer-exp-content">${roomExplanation(ex, q)}</div>
        </div>
      </div>
    </div>
    <div class="room-answer-bar">
      <div class="room-answer-bar-inner">
        <div class="room-answer-status">
          <span class="room-answer-mark-wrap">
            <span class="room-answer-mark ${right ? 'is-correct' : 'is-incorrect'}" aria-hidden="true">${right ? '✓' : '×'}</span>
            ${right ? '<span class="room-answer-sparks" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>' : ''}
          </span>
          <div class="room-answer-copy">
            <h2 id="room-answer-title">${right ? 'Correct!' : 'Incorrect'}</h2>
            ${right ? '' : `<span class="room-answer-inline-key">Correct answer: <strong>${escapeHtml(correct)}</strong></span>`}
          </div>
          <button type="button" class="room-answer-exp-btn" aria-expanded="false" aria-controls="room-answer-exp-panel">
            <span>View Explanation</span><span class="room-answer-chev" aria-hidden="true">▾</span>
          </button>
        </div>
        <div class="room-answer-actions">
          <button class="btn btn-secondary" type="submit" value="stay">Back to Question</button>
          <button class="btn room-yellow room-answer-continue" type="submit" value="continue" autofocus>${last ? 'Review Section' : 'Continue'}</button>
        </div>
      </div>
    </div>
  </form>`;
  window.getSelection()?.removeAllRanges();
  clearPalette();
  document.body.append(dialog);
  const expBtn = dialog.querySelector('.room-answer-exp-btn');
  const expPanel = dialog.querySelector('.room-answer-exp-panel');
  if (typeof enhanceQuestionMedia === 'function') enhanceQuestionMedia(expPanel);
  expBtn?.addEventListener('click', () => {
    const opening = !expPanel.classList.contains('is-open');
    expPanel.classList.toggle('is-open', opening);
    expPanel.setAttribute('aria-hidden', opening ? 'false' : 'true');
    expBtn.classList.toggle('is-open', opening);
    expBtn.setAttribute('aria-expanded', opening ? 'true' : 'false');
    if (opening && typeof typesetMath === 'function') typesetMath(expPanel);
  });
  const onResize = () => alignAnswerDialog(dialog, checkBtn, btnRect);
  window.addEventListener('resize', onResize);
  let stopConfetti = null;
  dialog.addEventListener('close', () => {
    stopConfetti?.();
    window.removeEventListener('resize', onResize);
    dialog.remove();
  }, { once: true });
  dialog.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    stopConfetti?.();
    dialog.close();
    dialog.remove();
    if (event.submitter?.value !== 'continue' || state.phase !== 'mcq_exam' ||
        getCurrentExam() !== ex || currentOrigId('mcq') !== q.origId) return;
    document.querySelector(`.pager-btns [data-action="${last ? 'go-check' : 'next'}"]`)?.click();
  });
  dialog.showModal();
  alignAnswerDialog(dialog, checkBtn, btnRect);
  if (right) {
    const markEl = dialog.querySelector('.room-answer-mark');
    const contEl = dialog.querySelector('.room-answer-continue');
    const origins = [];
    if (markEl) {
      const mr = markEl.getBoundingClientRect();
      origins.push({ x: mr.left + mr.width / 2, y: mr.top + 4, angleMin: -82, angleMax: -32 });
    }
    if (contEl) {
      const cr = contEl.getBoundingClientRect();
      origins.push({ x: cr.left + cr.width / 2, y: cr.top + 4, angleMin: -148, angleMax: -98 });
    }
    stopConfetti = launchRoomConfetti(dialog, origins);
  }
  playAnswerFeedback(right);
}
function roomSubmit(section) {
  const s = sectionState(section);
  const unanswered = s.order.filter(id => section === 'mcq'
    ? getQuestionByOrig(section, id)?.options?.length && !s.answers[id] : !s.responses?.[id]?.trim());
  const positions = unanswered.map(id => s.order.indexOf(id) + 1);
  const dialog = document.createElement('dialog');
  dialog.className = 'room-dialog';
  dialog.dataset.submit = 'true';
  dialog.innerHTML = `<form method="dialog"><h2>Submit This Section?</h2><p>${positions.length ? `You have ${positions.length} unanswered questions.` : 'You answered every available question in this section.'}</p>
    ${positions.length ? `<p class="room-meta">Unanswered question numbers: ${positions.join('、')}</p>` : ''}
    <div class="room-row-actions"><button class="btn btn-secondary" value="cancel">Keep Reviewing</button><button class="btn room-yellow" value="submit">Submit Section</button></div></form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => {
    const submit = dialog.returnValue === 'submit';
    dialog.remove();
    if (!submit || !['exam', 'check'].some(phase => state.phase === section + '_' + phase)) return;
    if (section === 'mcq') startBreak(); else finishTest();
  });
  dialog.showModal();
}
document.addEventListener('input', event => {
  const id = event.target.dataset.roomResponse;
  if (!id || state.phase !== 'frq_exam') return;
  (state.frq.responses ||= {})[id] = event.target.value;
  saveState();
});

function leaveRoomFocus() {
  if (!state.roomSettings?.focus) return;
  state.roomSettings.focus = false;
  roomFocus(false);
  saveState();
  render();
}

let databaseAttempts = [];
let historyStorageError = false;
function receiveRoomHistory(rows) {
  databaseAttempts = rows;
  historyStorageError = false;
  if (document.querySelector('.room') && libraryView !== 'settings' && !document.querySelector('dialog[open]')) renderLibrary();
}
function showHistoryStorageError() {
  historyStorageError = true;
  if (document.querySelector('.room') && libraryView !== 'settings' && !document.querySelector('dialog[open]')) renderLibrary();
}
function allAttempts() {
  const map = new Map();
  for (const a of [...databaseAttempts, ...readLibrary(libraryHistoryKey, [])]) map.set(a.examId + ':' + a.time, a);
  return [...map.values()].map(a => EXAMS[a.examId] && !EXAMS[a.examId]._stub && a.state ? attemptFrom(EXAMS[a.examId], a.state) : a).sort((a, b) => b.time - a.time);
}
function saveHistoryRows(rows) {
  window.webkit?.messageHandlers?.roomHistory?.postMessage(rows);
}
function migrateRoomHistory() {
  const rows = readLibrary(libraryHistoryKey, []);
  const keys = new Set(rows.map(a => a.examId + ':' + a.time));
  for (const ex of Object.values(EXAMS)) {
    const old = readLibrary(getStorageKey(ex.id), {});
    if (!isCompletedRoomState(old) || keys.has(ex.id + ':' + old.completionShownAt)) continue;
    rows.push(attemptFrom(ex, old));
  }
  saveHistoryRows(rows);
}
function isCompletedRoomState(snapshot) {
  return ['complete', 'results'].includes(snapshot.phase) && Number.isSafeInteger(snapshot.completionShownAt);
}
function scoringIds(ex, snapshot) {
  const ids = snapshot.mcq?.order || [];
  const scope = snapshot.roomSettings?.scoreIds;
  return ids.filter(id => (!scope || scope.includes(id)) && answerKeyOf(ex, id));
}
function attemptFrom(ex, snapshot) {
  if (ex.mode === 'pdf') {
    const g = typeof gradePdfAttempt === 'function' ? gradePdfAttempt(ex, snapshot.pdf || {}) : { totalKeyed: 0, correct: 0 };
    const pAns = Object.keys(snapshot.pdf?.answers || {}).length + Object.values(snapshot.pdf?.responses || {}).filter(v => String(v).trim()).length;
    const tot = snapshot.pdf?.questionCount || ex.defaultQuestionCount || 25;
    const elapsedSec = typeof estimateAttemptElapsedSec === 'function'
      ? estimateAttemptElapsedSec({ answered: pAns, state: snapshot }, ex)
      : null;
    return { examId: ex.id, time: snapshot.completionShownAt, correct: g.correct, graded: g.totalKeyed, answered: pAns, total: tot, elapsedSec, state: snapshot };
  }
  const mcqAnswers = snapshot.mcq?.answers || {};
  const mcqOrder = snapshot.mcq?.order || [];
  const frqResponses = snapshot.frq?.responses || {};
  const frqOrder = snapshot.frq?.order || [];
  const graded = scoringIds(ex, snapshot);
  const answered = Object.keys(mcqAnswers).length + Object.values(frqResponses).filter(s => s.trim()).length;
  const elapsedSec = typeof estimateAttemptElapsedSec === 'function'
    ? estimateAttemptElapsedSec({ answered, state: snapshot }, ex)
    : null;
  return {
    examId: ex.id,
    time: snapshot.completionShownAt,
    correct: graded.filter(id => mcqAnswers[id] === answerKeyOf(ex, id)).length,
    graded: graded.length,
    answered,
    total: mcqOrder.length + frqOrder.length,
    elapsedSec,
    state: snapshot,
  };
}
function mistakes(a) {
  const ex = EXAMS[a.examId];
  if (!ex || ex._stub) return [];
  if (ex.mode === 'pdf') return (typeof gradePdfAttempt === 'function' ? gradePdfAttempt(ex, a.state?.pdf || {}).missed : []);
  const mcqAnswers = a.state?.mcq?.answers || {};
  return scoringIds(ex, a.state).filter(id => mcqAnswers[id] && mcqAnswers[id] !== answerKeyOf(ex, id))
    .map(id => ex.questions.find(q => q.origId === id)).filter(Boolean);
}
function exportMistakes(a) {
  const ex = EXAMS[a.examId];
  const mcqAnswers = a.state?.mcq?.answers || {};
  const questions = mistakes(a).map(q => ({ ...q, correctAnswer: answerKeyOf(ex, q.origId), previousAnswer: mcqAnswers[q.origId], explanation: ex.explanations?.[q.origId] || '' }));
  const data = JSON.stringify({ schemaVersion: 1, id: a.examId + '_missed_' + a.time, title: ex.title + ' — Missed Questions', subject: ex.subject, subjectKey: ex.subjectKey, category: 'homework', questions }, null, 2);
  const native = window.webkit?.messageHandlers?.roomExport;
  if (native) { native.postMessage(data); return; }
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = (a.examId || 'exam').replace(/[^\w.-]+/g, '_') + '_missed_' + a.time + '.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function roomGreeting(attempts) {
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Hello' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = typeof roomUserName === 'function' ? roomUserName() : '';
  const goal = typeof roomDailyGoal === 'function' ? roomDailyGoal() : 20;
  const st = typeof window.computeRoomStats === 'function' ? window.computeRoomStats() : null;
  const graded = st ? st.totalGraded : attempts.reduce((n, a) => n + (a.graded || 0), 0);
  const correct = st ? st.totalCorrect : attempts.reduce((n, a) => n + (a.correct || 0), 0);
  const accVal = st
    ? (st.overallAccuracy !== null ? `${st.overallAccuracy}%` : '—')
    : (graded ? `${Math.round(correct / graded * 100)}%` : '—');
  const doneSets = st ? st.completedTotal : new Set(attempts.map(a => a.examId)).size;
  const doneSub = st ? `${st.completedNative}/${st.totalNative} interactive` : `${attempts.length} attempts`;
  const todayQs = st ? st.todayQuestions : 0;
  const todaySets = st ? st.todaySets : 0;
  const todayVal = `${todayQs} Qs`;
  const setsLabel = `${todaySets} set${todaySets === 1 ? '' : 's'}`;
  const todaySub = goal > 0
    ? (todayQs >= goal ? `Goal met ✓ (${todayQs}/${goal}) · ${setsLabel}` : `${todayQs}/${goal} daily goal · ${setsLabel}`)
    : `${setsLabel} today`;
  const streakVal = st ? `${st.currentStreak} day${st.currentStreak === 1 ? '' : 's'}` : '0 days';
  const streakSub = (st && st.longestStreak > 0) ? `Best ${st.longestStreak}d · View Stats →` : 'Start your streak →';

  return `<section class="room-welcome"><div class="room-welcome-intro"><div class="room-welcome-copy"><h1>${name ? `${greeting}, ${escapeHtml(name)}.` : `${greeting}.`}</h1>
    <p>Choose an AP subject from the sidebar, browse folders or icon cards, and practice with Bluebook Desmos, Reference Sheets, and Auto-Graded Mistake Sync.</p></div>
    ${roomPetsAllowed() ? '<div class="room-dots" aria-hidden="true"></div>' : ''}</div>
    <div class="room-metrics">
      <button type="button" class="room-metric-btn" data-action="room-view" data-filter="stats"><span class="room-metric-dt">Completed Tests</span><strong class="room-metric-dd">${doneSets}</strong><span class="room-metric-sub">${doneSub}</span></button>
      <button type="button" class="room-metric-btn" data-action="room-view" data-filter="stats"><span class="room-metric-dt">Today's Study</span><strong class="room-metric-dd">${todayVal}</strong><span class="room-metric-sub">${todaySub}</span></button>
      <button type="button" class="room-metric-btn" data-action="room-view" data-filter="stats"><span class="room-metric-dt">Overall Accuracy</span><strong class="room-metric-dd">${accVal}</strong><span class="room-metric-sub">${graded ? `${correct}/${graded} graded` : 'No graded Qs yet'}</span></button>
      <button type="button" class="room-metric-btn" data-action="room-view" data-filter="stats"><span class="room-metric-dt">Study Streak</span><strong class="room-metric-dd">${streakVal}</strong><span class="room-metric-sub">${streakSub}</span></button>
    </div></section>`;
}
function roomHistoryMarkup(attempts) {
  return `<h1>Test History</h1><p class="room-history-intro">Review your scores and responses from each completed attempt.</p>
    ${historyStorageError ? '<p role="alert">The history database is unavailable. Recent results may still be available in this app.</p>' : ''}
    ${attempts.length ? `<ul class="room-list room-history-list">${attempts.map((a, i) => {
    const ex = EXAMS[a.examId], wrong = mistakes(a);
    return `<li class="room-history-item" data-exam-id="${escapeHtml(a.examId)}" data-history-time="${Number(a.time) || 0}"><div class="room-row"><div class="room-item"><span class="room-tile-icon">${roomIcon(ex?.category)}</span>
    <div><strong>${escapeHtml(ex?.title || a.examId)}</strong><div class="room-meta">${escapeHtml(new Date(a.time).toLocaleString('en-US'))} · ${a.answered}/${a.total} answered · ${a.graded ? `Score ${a.correct}/${a.graded} · ${Math.round(a.correct / a.graded * 100)}% accuracy` : 'No auto-graded score'}</div></div></div>
    <div class="room-row-actions"><button class="btn btn-secondary" data-action="room-history-open" data-index="${i}">View Results</button></div></div>
    <details class="room-mistakes"><summary><span>Missed Questions</span><span class="room-mistake-count" aria-label="${wrong.length} missed">${wrong.length}</span></summary>
    ${wrong.length ? `<table class="room-mistake-table" aria-label="Missed questions and answers">
      <thead><tr><th scope="col">Question</th><th scope="col">Your answer</th><th scope="col">Correct answer</th></tr></thead>
      <tbody>${wrong.map(q => `<tr><th scope="row">Q${q.origId}</th>
        <td><span class="room-mistake-choice is-incorrect">${escapeHtml(q.yourAnswer || a.state.mcq?.answers?.[q.origId] || '—')}</span></td>
        <td><span class="room-mistake-choice is-correct">${escapeHtml(q.correctAnswer || answerKeyOf(ex, q.origId))}</span></td>
      </tr>`).join('')}</tbody>
    </table>` :
    '<p class="room-mistakes-empty">Open attempt or no incorrect answers recorded.</p>'}</details></li>`;
  }).join('')}</ul>` : '<p class="room-meta">Your completed tests will appear here after you submit them.</p>'}`;
}
function parseRoomRange(text, questions, field) {
  if (!text.trim()) return null;
  const available = new Set(questions.map(q => q.origId));
  const selected = new Set();
  for (const piece of text.split(',')) {
    const m = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(piece);
    if (!m) throw Error(field + ' must use question numbers, like 1-5, 8.');
    const start = Number(m[1]), end = Number(m[2] || m[1]);
    if (end < start || end - start > available.size) throw Error(field + ' has an invalid range.');
    for (let i = start; i <= end; i++) {
      if (!available.has(i)) throw Error(field + ' contains unavailable question ' + i + '.');
      selected.add(i);
    }
  }
  return [...selected];
}
function roomDirections(section) {
  const name = section === 'mcq' ? 'Section I' : 'Section II';
  const sectionData = sectionState(section);
  const duration = roomTimer(section, section === 'mcq' ? getCurrentExam().durationSeconds : getCurrentExam().frqDurationSeconds);
  return `<h2>${name} Directions</h2><p>This section contains ${sectionData.order.length} questions. ${duration === null ? 'This section is untimed.' : `You have ${Math.round(duration / 60)} minutes for this section.`}</p>
  <p>${section === 'mcq' ? 'Choose the best answer for each question.' : 'Write your response in the space provided.'}</p>`;
}
function roomExplanation(ex, question) {
  const rationale = question.rationaleHtml;
  const existing = ex.explanations?.[question.origId] || '';
  const topic = question.topic ? `<p class="room-topic"><strong>Topic</strong> ${escapeHtml(question.topic)}</p>` : '';
  const vPrefix = window.ROOM_IS_APP_WEBKIT ? '../../../' : (location.protocol.startsWith('http') ? '/' : '../');
  const rawVideo = question.videoUrl || '';
  const isAbsVideo = /^(?:https?:|data:|blob:|\/)/i.test(rawVideo);
  const vSrc = rawVideo ? (isAbsVideo ? rawVideo : vPrefix + rawVideo.replace(/^\/+/, '')) : '';
  const video = vSrc ? `<details class="room-advanced room-video-details"><summary>Video walkthrough</summary><video controls preload="none" data-src="${escapeHtml(vSrc)}"></video></details>` : '';
  const fallback = existing && !existing.includes('video-walkthrough-box') ? existing : '';
  const pdfBtn = question.sourcePdfRel ? `<div class="room-meta" style="margin-top:8px;"><button type="button" class="btn btn-secondary" onclick="roomOpenPdfExternal('${escapeHtml(question.sourcePdfRel)}')">Open Source PDF (p.${question.sourcePage || 1}) ↗</button></div>` : '';
  return topic + (rationale || fallback || '<p>No written explanation is available for this question.</p>') + pdfBtn + video;
}
document.addEventListener('toggle', (event) => {
  const det = event.target;
  if (!(det instanceof HTMLDetailsElement) || !det.classList.contains('room-video-details') || !det.open) return;
  const v = det.querySelector('video[data-src]');
  if (v && !v.getAttribute('src') && v.dataset.src) v.src = v.dataset.src;
}, true);
function openResults() {
  state.phase = 'results';
  state.resultsTab = state.mcq.order.length ? 'mcq' : 'frq';
  resultView = 'overview';
}
function questionPreview(question) {
  const snippet = htmlTextContent(question.promptHtml || question.stemHtml || question.label || question.title || '').trim();
  return snippet.length > 160 ? snippet.slice(0, 157) + '…' : snippet || question.label || 'View question';
}
function renderResultsOverview(ex) {
  const score = attemptFrom(ex, state);
  const scored = new Set(scoringIds(ex, state));
  const sections = ['mcq', 'frq'].filter(section => sectionState(section).order.length);
  return `<main class="room-content room-results-overview"><section class="room-welcome">
    <h2>Score Overview</h2>
    <p>Select a section to browse its questions. Open a question to see your response and available explanations.</p>
    <dl class="room-metrics"><div><dt>Answered</dt><dd>${score.answered}/${score.total}</dd></div>
    <div><dt>Score</dt><dd>${score.graded ? score.correct + '/' + score.graded : '—'}</dd></div>
    <div><dt>Accuracy</dt><dd>${score.graded ? Math.round(100 * score.correct / score.graded) + '%' : '—'}</dd></div>
    <div><dt>Mistake Bank</dt><dd>${loadGlobalMistakes().length}</dd></div></dl>
    </section>
    ${sections.map(section => {
      const sec = sectionState(section);
      return `<details class="room-section-list" ${section === state.resultsTab ? 'open' : ''}>
      <summary>${sectionTitle(section)} <span>${sec.order.length} questions</span></summary>
      <ol class="room-list">
        ${sec.order.map((id, index) => {
          const q = getQuestionByOrig(section, id);
          if (!q) return '';
          const selected = section === 'mcq' ? sec.answers[id] : sec.responses?.[id]?.trim();
          const status = !selected ? 'Unanswered' : section === 'frq' ? 'Answered' : scored.has(id)
            ? (selected === answerKeyOf(ex, id) ? 'Correct' : 'Incorrect') : 'Not scored';
          return `<li><button class="room-question-link" type="button" data-action="result-jump" data-tab="${section}" data-orig="${id}">
            <span class="room-question-number">${index + 1}</span><span class="room-question-preview">${escapeHtml(questionPreview(q))}</span>
            <span class="room-question-status" data-status="${status}">${status}</span></button></li>`;
        }).join('')}
      </ol></details>`;
    }).join('')}
  </main>`;
}

window.renderNativeFrqRubricBlock = function (ex, q, s) {
  if (!q) return '';
  const items = q.rubricItems || [];
  const savedMap = (state.frq.rubricChecks ||= {})[q.origId] || {};
  const earned = items.filter(it => savedMap[it.id]).reduce((sum, it) => sum + (it.points || 1), 0);
  const maxPts = q.maxScore || items.reduce((sum, it) => sum + (it.points || 1), 0) || 9;
  const checksHtml = items.map(it => `<label class="cb-rubric-row">
    <input type="checkbox" class="cb-rubric-chk" data-frq-orig="${q.origId}" data-rubric-id="${escapeHtml(it.id)}" ${savedMap[it.id] ? 'checked' : ''}>
    <span>${escapeHtml(it.label)} <strong>(+${it.points || 1})</strong></span>
  </label>`).join('');
  const vPrefix = window.ROOM_IS_APP_WEBKIT ? '../../../' : (location.protocol.startsWith('http') ? '/' : '../');
  const rawVideo = q.videoUrl || '';
  const isAbsVideo = /^(?:https?:|data:|blob:|\/)/i.test(rawVideo);
  const vSrc = rawVideo ? (isAbsVideo ? rawVideo : vPrefix + rawVideo.replace(/^\/+/, '')) : '';
  const videoHtml = vSrc ? `<details class="room-advanced room-video-details"><summary>Video walkthrough</summary><video controls preload="none" data-src="${escapeHtml(vSrc)}"></video></details>` : '';
  return `<div class="cb-rubric-panel">
    <div class="cb-rubric-head">
      <h3>AP Scoring Guidelines & Self-Check</h3>
      <span class="cb-rubric-score">Self-Score: <strong>${earned} / ${maxPts}</strong></span>
    </div>
    ${checksHtml ? `<div class="cb-rubric-list">${checksHtml}</div>` : ''}
    ${q.rubricHtml ? `<details class="room-advanced" open><summary>Canonical Solution & Scoring Key</summary>${q.rubricHtml}</details>` : ''}
    ${videoHtml}
  </div>`;
};

document.addEventListener('change', (e) => {
  const chk = e.target.closest('.cb-rubric-chk');
  if (!chk) return;
  const qid = chk.dataset.frqOrig;
  const rid = chk.dataset.rubricId;
  state.frq.rubricChecks = state.frq.rubricChecks || {};
  state.frq.rubricChecks[qid] = state.frq.rubricChecks[qid] || {};
  state.frq.rubricChecks[qid][rid] = chk.checked;
  saveState();
  render();
});

const disclosureAnimations = new WeakMap();
document.addEventListener('click', event => {
  const summary = event.target.closest('summary');
  const panel = summary?.parentElement;
  if (!panel?.matches('details:is(.room-advanced, .room-section-list, .room-mistakes)')) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !panel.animate) return;
  event.preventDefault();
  const previous = disclosureAnimations.get(panel);
  const opening = !(previous?.opening ?? panel.open);
  const currentHeight = panel.getBoundingClientRect().height;
  previous?.animation.cancel();
  panel.open = opening;
  const nextHeight = panel.getBoundingClientRect().height;
  panel.open = true;
  panel.dataset.expanded = String(opening);
  const animation = panel.animate(
    [{ height: currentHeight + 'px', overflow: 'hidden' }, { height: nextHeight + 'px', overflow: 'hidden' }],
    { duration: 320, easing: 'cubic-bezier(.22,.72,.25,1)' }
  );
  disclosureAnimations.set(panel, { opening, animation });
  animation.onfinish = () => {
    if (disclosureAnimations.get(panel)?.animation !== animation) return;
    panel.open = opening;
    delete panel.dataset.expanded;
    disclosureAnimations.delete(panel);
  };
});

(function initRoomCloudSync() {
  const META_KEY = 'ap-room-sync-meta-v1';
  const isNative = () => Boolean(window.webkit?.messageHandlers?.roomSyncPull && window.webkit?.messageHandlers?.roomSyncPush);
  const isHttp = () => location.protocol === 'http:' || location.protocol === 'https:';
  if (!isNative() && !isHttp()) {
    setTimeout(() => { window.roomMaybeOpenOnboarding?.(); }, 60);
    return;
  }

  const rawGet = Storage.prototype.getItem.bind(localStorage);
  const rawSet = Storage.prototype.setItem.bind(localStorage);
  const rawRemove = Storage.prototype.removeItem.bind(localStorage);

  function isSyncKey(k) {
    return typeof k === 'string' && (
      k === libraryHistoryKey
      || k === libraryMistakesKey
      || k === libraryImportKey
      || k === 'ap-room-preferences-v1'
      || k === libraryUiKey
      || k === 'room_theme_v1'
      || k === 'bluebook_suite_active_exam'
      || k.startsWith('bluebook_exam_state_')
    );
  }

  function loadMeta() {
    try {
      const m = JSON.parse(rawGet(META_KEY) || '{}');
      return {
        lastServerTime: Number(m.lastServerTime) || 0,
        keyTs: (m.keyTs && typeof m.keyTs === 'object') ? m.keyTs : {},
      };
    } catch {
      return { lastServerTime: 0, keyTs: {} };
    }
  }

  function saveMeta(meta) {
    try { rawSet(META_KEY, JSON.stringify(meta)); } catch (_) {}
  }

  const meta = loadMeta();
  const dirtyKeys = new Set();
  let bootstrapped = false;
  let applyingRemote = false;
  let pushTimer = null;
  let syncInFlight = false;
  let initialSyncNotified = false;

  function bumpKeyTs(k, minTs = 0) {
    const next = Math.max(Date.now(), (meta.keyTs[k] || 0) + 1, minTs);
    meta.keyTs[k] = next;
    saveMeta(meta);
    return next;
  }

  Storage.prototype.setItem = function (k, v) {
    rawSet.call(localStorage, k, v);
    if (this === localStorage && !applyingRemote && isSyncKey(k)) {
      bumpKeyTs(k);
      dirtyKeys.add(k);
      schedulePush();
    }
  };

  Storage.prototype.removeItem = function (k) {
    rawRemove.call(localStorage, k);
    if (this === localStorage && !applyingRemote && isSyncKey(k)) {
      bumpKeyTs(k);
      dirtyKeys.add(k);
      schedulePush();
    }
  };

  function safeJsonArray(raw) {
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  function mergeHistoryArrays(aList, bList) {
    const map = new Map();
    for (const item of [...(aList || []), ...(bList || [])]) {
      if (!item || !item.examId || item.time === undefined) continue;
      map.set(`${item.examId}:${item.time}`, item);
    }
    return [...map.values()].sort((a, b) => Number(b.time || 0) - Number(a.time || 0));
  }

  function mergeMistakeArrays(aList, bList) {
    const map = new Map();
    for (const item of [...(aList || []), ...(bList || [])]) {
      if (!item || !item.examId || item.origId === undefined) continue;
      const key = `${item.examId}:${Number(item.origId)}`;
      const prev = map.get(key);
      if (!prev || Number(item.time || 0) >= Number(prev.time || 0)) {
        map.set(key, item);
      }
    }
    return [...map.values()].sort((a, b) => Number(b.time || 0) - Number(a.time || 0));
  }

  async function transportPull(since) {
    if (isNative()) {
      return await window.webkit.messageHandlers.roomSyncPull.postMessage({ since });
    }
    const res = await fetch('/sync/state?since=' + encodeURIComponent(String(since)), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  }

  async function transportPush(payload, keepalive = false) {
    if (isNative()) {
      return await window.webkit.messageHandlers.roomSyncPush.postMessage(payload);
    }
    const res = await fetch('/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  }

  function buildPushPayload(keys) {
    const items = {};
    let historyRows = null;
    for (const k of keys) {
      if (!isSyncKey(k)) continue;
      const val = rawGet(k);
      const ts = meta.keyTs[k] || bumpKeyTs(k);
      if (val === null) {
        items[k] = { v: '', updatedAt: ts, deleted: true };
      } else {
        items[k] = { v: val, updatedAt: ts, deleted: false };
        if (k === libraryHistoryKey) {
          historyRows = safeJsonArray(val);
        }
      }
    }
    return { items, historyRows };
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { flushPush(); }, 120);
  }

  async function flushPush(keepalive = false) {
    clearTimeout(pushTimer);
    if (!dirtyKeys.size) return;
    const keys = [...dirtyKeys];
    dirtyKeys.clear();
    const payload = buildPushPayload(keys);
    if (!Object.keys(payload.items).length) return;
    try {
      const ack = await transportPush(payload, keepalive);
      if (ack?.serverTime) {
        meta.lastServerTime = Math.max(meta.lastServerTime, Number(ack.serverTime) || 0);
        saveMeta(meta);
      }
    } catch (_) {
      for (const k of keys) dirtyKeys.add(k);
    }
  }

  function refreshUIAfterSync(changedKeys) {
    if (!changedKeys.length) return;
    if (changedKeys.includes('room_theme_v1') && typeof window.roomInitTheme === 'function') {
      window.roomInitTheme();
    }
    if (changedKeys.includes(libraryImportKey) && typeof restoreQuestionBank === 'function') {
      restoreQuestionBank();
    }
    const activeEditing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    const activeExamKey = (typeof getStorageKey === 'function' && typeof currentExamId !== 'undefined')
      ? getStorageKey(currentExamId)
      : '';
    if (activeExamKey && changedKeys.includes(activeExamKey) && typeof state !== 'undefined') {
      if (typeof loadState === 'function' && typeof emptyState === 'function') {
        const reloaded = loadState();
        Object.assign(state, reloaded || emptyState());
      }
      if (!activeEditing && typeof render === 'function' && !document.querySelector('dialog[open]')) {
        render();
        return;
      }
    }
    if (!activeEditing && !document.querySelector('dialog[open]')) {
      if (document.querySelector('.room') && typeof renderLibrary === 'function') {
        renderLibrary();
      } else if (typeof render === 'function' && changedKeys.some(k => k === libraryHistoryKey || k === libraryMistakesKey || k === libraryUiKey)) {
        render();
      }
    }
  }

  async function pullOnce(forceFull = false) {
    if (syncInFlight) return;
    syncInFlight = true;
    try {
      const since = (!bootstrapped || forceFull || !meta.lastServerTime)
        ? 0
        : Math.max(0, meta.lastServerTime - 15000);
      const data = await transportPull(since);
      if (!data || typeof data !== 'object') return;
      const remoteItems = data.items || {};
      const remoteAttempts = Array.isArray(data.attempts) ? data.attempts : [];
      const changedKeys = [];
      let needsBootstrapPush = false;

      applyingRemote = true;
      try {
        if (remoteAttempts.length > 0) {
          databaseAttempts = remoteAttempts;
          const remoteHistEntry = remoteItems[libraryHistoryKey];
          const remoteHistArr = remoteHistEntry && !remoteHistEntry.deleted ? safeJsonArray(remoteHistEntry.v) : [];
          const localHistArr = safeJsonArray(rawGet(libraryHistoryKey));
          const mergedAll = mergeHistoryArrays(remoteAttempts, mergeHistoryArrays(remoteHistArr, localHistArr));
          const mergedStr = JSON.stringify(mergedAll);
          if (rawGet(libraryHistoryKey) !== mergedStr) {
            rawSet(libraryHistoryKey, mergedStr);
            changedKeys.push(libraryHistoryKey);
          }
          const maxTs = Math.max(Date.now(), Number(remoteHistEntry?.updatedAt || 0), meta.keyTs[libraryHistoryKey] || 0);
          meta.keyTs[libraryHistoryKey] = maxTs;
          if (!remoteHistEntry || remoteHistEntry.v !== mergedStr) {
            dirtyKeys.add(libraryHistoryKey);
            needsBootstrapPush = true;
          }
        }

        for (const [k, entry] of Object.entries(remoteItems)) {
          if (!isSyncKey(k) || !entry || typeof entry !== 'object') continue;
          const rTs = Number(entry.updatedAt) || 0;
          const lTs = Number(meta.keyTs[k]) || 0;
          const lRaw = rawGet(k);

          if (k === libraryHistoryKey || k === libraryMistakesKey) {
            const merger = k === libraryHistoryKey ? mergeHistoryArrays : mergeMistakeArrays;
            const rArr = entry.deleted ? [] : safeJsonArray(entry.v);
            const lArr = safeJsonArray(lRaw);
            const explicitClear = (entry.deleted || (rArr.length === 0 && lArr.length > 0)) && rTs > lTs && lTs > 0;
            if (explicitClear) {
              if (lRaw !== null && lArr.length > 0) {
                rawSet(k, '[]');
                changedKeys.push(k);
              }
              meta.keyTs[k] = Math.max(lTs, rTs);
              continue;
            }
            const merged = merger(rArr, lArr);
            const mergedStr = JSON.stringify(merged);
            if ((merged.length > 0 || lArr.length > 0) && mergedStr !== lRaw) {
              rawSet(k, mergedStr);
              changedKeys.push(k);
            }
            meta.keyTs[k] = Math.max(lTs, rTs);
            if (!entry.deleted && mergedStr !== (entry.v || '') && merged.length > 0) {
              bumpKeyTs(k, rTs + 1);
              dirtyKeys.add(k);
              needsBootstrapPush = true;
            }
            continue;
          }

          if (rTs > lTs) {
            if (entry.deleted) {
              if (lRaw !== null) {
                rawRemove(k);
                changedKeys.push(k);
              }
            } else if (typeof entry.v === 'string' && entry.v !== lRaw) {
              rawSet(k, entry.v);
              changedKeys.push(k);
            }
            meta.keyTs[k] = rTs;
          } else if (rTs === 0 && lRaw === null && !entry.deleted && entry.v) {
            rawSet(k, entry.v);
            meta.keyTs[k] = rTs;
            changedKeys.push(k);
          }
        }

        if (!bootstrapped) {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!isSyncKey(k) || remoteItems[k]) continue;
            const v = rawGet(k);
            if (v !== null) {
              meta.keyTs[k] = meta.keyTs[k] || Date.now();
              dirtyKeys.add(k);
              needsBootstrapPush = true;
            }
          }
        }

        if (data.serverTime) {
          meta.lastServerTime = Math.max(meta.lastServerTime, Number(data.serverTime) || 0);
        }
        saveMeta(meta);
        bootstrapped = true;
      } finally {
        applyingRemote = false;
      }

      if (needsBootstrapPush || dirtyKeys.size) {
        await flushPush();
      }
      refreshUIAfterSync(changedKeys);
    } catch (_) {
    } finally {
      syncInFlight = false;
      if (!initialSyncNotified) {
        initialSyncNotified = true;
        setTimeout(() => { window.roomMaybeOpenOnboarding?.(); }, 30);
      }
    }
  }

  window.roomSyncNow = async function () {
    await flushPush();
    await pullOnce(true);
    return { lastServerTime: meta.lastServerTime, dirty: dirtyKeys.size };
  };

  setTimeout(() => { pullOnce(true); }, 0);
  setInterval(() => {
    if (document.visibilityState === 'visible') pullOnce(false);
  }, 5000);
  window.addEventListener('focus', () => { pullOnce(false); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pullOnce(false);
    else flushPush(true);
  });
  window.addEventListener('pagehide', () => { flushPush(true); });
})();

// --- Universal Context Menu (Right-Click / Touch Long-Press) & Global Cmd+Z Undo Stack ---
(function () {
  const TOAST_MS = 3000;
  const UNDO_LIMIT = 25;
  const undoStack = [];
  let ctxEl = null;
  let toastEl = null;
  let toastTimer = null;
  let closeTimer = null;
  let activeCtxTarget = null;
  let lpTimer = null;
  let lpStart = null;
  let blockNextClickUntil = 0;

  const ICO = {
    play: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.8v10.4L13 8z" fill="currentColor"/></svg>',
    refresh: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M13.2 8a5.2 5.2 0 1 1-1.4-3.5M13.5 2.5v3h-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    trash: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2.8 4.4h10.4M6 4.4V2.9h4v1.5M4.5 4.4l.7 8.7h5.6l.7-8.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    check: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8.4l3.3 3.3L13 4.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    strike: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2.5 8h11M5.2 4.4c.5-.9 1.5-1.4 2.8-1.4 1.6 0 2.7.7 2.8 1.9M10.9 11.4c-.4 1-1.5 1.6-3 1.6-1.6 0-2.7-.6-3-1.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    bookmark: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.5h8a.8.8 0 0 1 .8.8v10.5L8 11.2l-4.8 2.6V3.3a.8.8 0 0 1 .8-.8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    calc: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3" y="2" width="10" height="12" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.2 5.2h5.6M5.5 8.5h1M8 8.5h1M10.5 8.5h0M5.5 11h1M8 11h1M10.5 11h0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    book: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 3h4.2a1.8 1.8 0 0 1 1.8 1.8V13a1.4 1.4 0 0 0-1.4-1.2H3V3zm10 0H8.8A1.8 1.8 0 0 0 7 4.8V13a1.4 1.4 0 0 1 1.4-1.2H13V3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    dockL: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="3.2" y="3.8" width="4" height="8.4" rx=".8" fill="currentColor"/></svg>',
    dockR: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="8.8" y="3.8" width="4" height="8.4" rx=".8" fill="currentColor"/></svg>',
    theme: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M12.6 10.1A5.2 5.2 0 0 1 5.9 3.4a5.2 5.2 0 1 0 6.7 6.7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    undo: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M5.5 4.2L2.5 7l3 2.8M3 7h6.5a3.5 3.5 0 0 1 0 7H7.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    folder: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2.2 4.2h4.2l1.2 1.4h6.2v7.2H2.2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    export: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2.5v7.2M5.2 5.3L8 2.5l2.8 2.8M3 10.5v2.5h10v-2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    eye: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1.8 8s2.4-4 6.2-4 6.2 4 6.2 4-2.4 4-6.2 4-6.2-4-6.2-4z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/></svg>',
    close: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  };

  function showRoomToast(msg, opts = {}) {
    if (!toastEl || !toastEl.isConnected) {
      toastEl = document.createElement('div');
      toastEl.id = 'room-toast';
      toastEl.className = 'room-toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    const dur = Math.max(800, Number(opts.duration) || TOAST_MS);
    const undoBtn = opts.undoable
      ? '<button type="button" class="room-toast-undo" data-toast-undo>Undo <kbd>⌘Z</kbd></button>'
      : '';
    toastEl.innerHTML = `<span class="room-toast-msg">${escapeHtml(msg)}</span>${undoBtn}<span class="room-toast-bar"></span>`;
    toastEl.hidden = false;
    const bar = toastEl.querySelector('.room-toast-bar');
    if (bar) {
      bar.style.animation = 'none';
      void bar.offsetWidth;
      bar.style.animation = `roomToastCountdown ${dur}ms linear forwards`;
    }
    toastEl.classList.add('is-open');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl?.classList.remove('is-open');
      setTimeout(() => {
        if (toastEl && !toastEl.classList.contains('is-open')) toastEl.hidden = true;
      }, 220);
    }, dur);
  }
  window.showRoomToast = showRoomToast;

  window.roomPushUndo = function (entry) {
    if (!entry || typeof entry.undo !== 'function') return;
    undoStack.push({ label: String(entry.label || 'Action'), undo: entry.undo });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    showRoomToast(entry.label, { undoable: true, duration: TOAST_MS });
  };

  window.roomPerformUndo = async function () {
    const entry = undoStack.pop();
    if (!entry) return false;
    try {
      await entry.undo();
      showRoomToast(`Undone · ${entry.label}`, { undoable: false, duration: TOAST_MS });
    } catch (_) {}
    return true;
  };

  function ensureCtxMenu() {
    if (ctxEl && ctxEl.isConnected) return ctxEl;
    ctxEl = document.createElement('div');
    ctxEl.id = 'room-ctx-menu';
    ctxEl.className = 'room-ctx-menu';
    ctxEl.setAttribute('role', 'menu');
    ctxEl.hidden = true;
    document.body.appendChild(ctxEl);
    return ctxEl;
  }

  function spawnCtxRipple(x, y) {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const rip = document.createElement('span');
    rip.className = 'room-ctx-ripple';
    rip.style.left = Math.round(x) + 'px';
    rip.style.top = Math.round(y) + 'px';
    document.body.appendChild(rip);
    setTimeout(() => rip.remove(), 400);
  }

  function clearActiveCtxTarget() {
    if (activeCtxTarget) {
      activeCtxTarget.classList.remove('room-ctx-target');
      activeCtxTarget = null;
    }
  }

  function closeExamContextMenu(immediate = false) {
    clearActiveCtxTarget();
    if (!ctxEl || ctxEl.hidden) return;
    clearTimeout(closeTimer);
    ctxEl.classList.remove('is-open');
    if (immediate) {
      ctxEl.classList.remove('is-closing');
      ctxEl.hidden = true;
      return;
    }
    ctxEl.classList.add('is-closing');
    closeTimer = setTimeout(() => {
      closeTimer = null;
      if (ctxEl && !ctxEl.classList.contains('is-open')) {
        ctxEl.classList.remove('is-closing');
        ctxEl.hidden = true;
      }
    }, 145);
  }

  async function restoreDeletedExamSnapshot(snap) {
    if (!snap) return;
    if (snap.prevStorageRaw !== null && snap.prevStorageRaw !== undefined) {
      localStorage.setItem(snap.storageKey, snap.prevStorageRaw);
    } else {
      localStorage.removeItem(snap.storageKey);
    }
    if (snap.prevActiveExam !== null && snap.prevActiveExam !== undefined) {
      localStorage.setItem('bluebook_suite_active_exam', snap.prevActiveExam);
    }
    if (snap.prevHistRaw !== null && snap.prevHistRaw !== undefined) {
      localStorage.setItem(libraryHistoryKey, snap.prevHistRaw);
    } else {
      localStorage.removeItem(libraryHistoryKey);
    }
    if (Array.isArray(databaseAttempts) && Array.isArray(snap.prevDbAttempts)) {
      databaseAttempts = snap.prevDbAttempts.slice();
    }
    const native = window.webkit?.messageHandlers?.roomHistory;
    if (native && (snap.clearHistory || snap.attemptTime)) {
      try { native.postMessage(snap.prevDbAttempts || []); } catch (_) {}
    }
    if (typeof renderLibrary === 'function' && document.querySelector('.room')) renderLibrary();
    await window.roomSyncNow?.();
  }

  async function deleteExamRecords(examId, opts = {}, skipUndo = false) {
    const clearProgress = opts.clearProgress !== false;
    const clearHistory = Boolean(opts.clearHistory);
    const attemptTime = opts.attemptTime ? Number(opts.attemptTime) : null;
    const ex = EXAMS[examId];
    const storageKey = getStorageKey(examId);

    const snap = {
      examId,
      storageKey,
      clearHistory,
      attemptTime,
      prevStorageRaw: localStorage.getItem(storageKey),
      prevActiveExam: localStorage.getItem('bluebook_suite_active_exam'),
      prevHistRaw: localStorage.getItem(libraryHistoryKey),
      prevDbAttempts: Array.isArray(databaseAttempts) ? databaseAttempts.slice() : [],
    };

    if (clearProgress) {
      localStorage.removeItem(storageKey);
      if (snap.prevActiveExam === examId) {
        localStorage.removeItem('bluebook_suite_active_exam');
      }
      if (typeof currentExamId !== 'undefined' && currentExamId === examId && typeof state !== 'undefined' && state.phase === 'intro') {
        state = emptyState();
      }
    }

    if (clearHistory || attemptTime) {
      const keepRow = (row) => {
        if (!row) return false;
        if (row.examId !== examId) return true;
        if (clearHistory) return false;
        return Number(row.time) !== attemptTime;
      };
      const rows = readLibrary(libraryHistoryKey, []).filter(keepRow);
      if (rows.length) localStorage.setItem(libraryHistoryKey, JSON.stringify(rows));
      else localStorage.removeItem(libraryHistoryKey);
      if (Array.isArray(databaseAttempts)) {
        databaseAttempts = databaseAttempts.filter(keepRow);
      }
      const native = window.webkit?.messageHandlers?.roomDeleteHistory;
      if (native && clearHistory) {
        try { native.postMessage({ all: false, exams: [examId] }); } catch (_) {}
      }
    }

    if (location.protocol === 'http:' || location.protocol === 'https:') {
      try {
        await fetch('/sync/delete-exam', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ examId, storageKey, clearProgress, clearHistory, attemptTime }),
        });
      } catch (_) {}
    }

    if (typeof renderLibrary === 'function' && document.querySelector('.room')) {
      renderLibrary();
    }
    const label = ex?.title || examId;
    let msg = `Updated · ${label}`;
    if (attemptTime && !clearProgress) msg = `Deleted 1 history record · ${label}`;
    else if (clearHistory && clearProgress) msg = `Cleared all records · ${label}`;
    else if (clearProgress) msg = `Cleared Resume progress · ${label}`;

    if (!skipUndo) {
      window.roomPushUndo({
        label: msg,
        async undo() { await restoreDeletedExamSnapshot(snap); },
      });
    } else {
      showRoomToast(msg);
    }
  }

  let pendingActionMap = new Map();

  function showContextMenuSpec(spec, clientX, clientY, targetEl) {
    if (!spec || !Array.isArray(spec.items) || !spec.items.length) return;
    const menu = ensureCtxMenu();
    clearTimeout(closeTimer);
    clearActiveCtxTarget();
    if (targetEl && targetEl.isConnected && !targetEl.matches('.room, .exam-screen, .pdf-exam-shell, .results-screen, .check-screen')) {
      activeCtxTarget = targetEl;
      activeCtxTarget.classList.add('room-ctx-target');
    }
    spawnCtxRipple(clientX, clientY);

    pendingActionMap = new Map();
    const bodyHtml = spec.items.map((it, idx) => {
      if (it.div) return '<div class="room-ctx-sep" role="separator"></div>';
      if (it.disabled) return `<div class="room-ctx-note">${escapeHtml(it.label)}</div>`;
      const key = 'a' + idx;
      if (typeof it.run === 'function') pendingActionMap.set(key, it.run);
      const ico = it.ico ? `<span class="room-ctx-ico">${it.ico}</span>` : '';
      const kbd = it.kbd ? `<kbd class="room-ctx-kbd">${escapeHtml(it.kbd)}</kbd>` : '';
      return `<button type="button" class="room-ctx-item ${it.danger ? 'is-danger' : ''}" role="menuitem" data-ctx-key="${key}">
        ${ico}<span class="room-ctx-lbl">${escapeHtml(it.label)}</span>${kbd}
      </button>`;
    }).join('');

    const badgeHtml = spec.badge
      ? `<span class="room-ctx-badge ${spec.badgeCls || ''}">${escapeHtml(spec.badge)}</span>`
      : '';
    menu.innerHTML = `
      <div class="room-ctx-head">
        <span class="room-ctx-title">${escapeHtml(spec.title || 'Actions')}</span>
        ${badgeHtml}
      </div>
      <div class="room-ctx-list">${bodyHtml}</div>`;

    menu.classList.remove('is-open', 'is-closing');
    menu.hidden = false;

    const mw = menu.offsetWidth || 256;
    const mh = menu.offsetHeight || 200;
    const flipX = clientX + mw + 8 > window.innerWidth;
    const flipY = clientY + mh + 8 > window.innerHeight;
    const left = Math.max(8, Math.min(window.innerWidth - mw - 8, flipX ? clientX - mw : clientX));
    const top = Math.max(8, Math.min(window.innerHeight - mh - 8, flipY ? clientY - mh : clientY));
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
    menu.style.transformOrigin = `${flipY ? 'bottom' : 'top'} ${flipX ? 'right' : 'left'}`;
    void menu.offsetWidth;
    menu.classList.add('is-open');
  }

  function ongoingIdsForSubject(subjectKey) {
    return Object.values(EXAMS)
      .filter((ex) => {
        if (subjectKey !== 'all' && ex.subjectKey !== subjectKey) return false;
        const r = readLibrary(getStorageKey(ex.id), {});
        return ['mcq_exam', 'mcq_check', 'frq_exam', 'frq_check', 'break'].includes(r.phase);
      })
      .map((ex) => ex.id);
  }

  function resolveContextSpec(rawTarget) {
    if (!rawTarget || !(rawTarget instanceof Element)) return null;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    // 1. Floating Tool Panel (Desmos / Reference Sheet)
    const floatPanel = rawTarget.closest('.room-float-panel');
    if (floatPanel) {
      const isDesmos = floatPanel.id === 'room-desmos-overlay';
      const dockedLeft = floatPanel.classList.contains('is-dock-left');
      const dockedRight = floatPanel.classList.contains('is-dock-right');
      const items = [
        {
          ico: ICO.dockL,
          label: dockedLeft ? 'Undock to Floating Window' : 'Dock to Left Side',
          run: () => floatPanel.querySelector('[data-dock-cmd="left"]')?.click(),
        },
        {
          ico: ICO.dockR,
          label: dockedRight ? 'Undock to Floating Window' : 'Dock to Right Side',
          run: () => floatPanel.querySelector('[data-dock-cmd="right"]')?.click(),
        },
        {
          ico: ICO.refresh,
          label: 'Expand / Compact Size',
          run: () => floatPanel.querySelector(isDesmos ? '[data-dact="size"]' : '[data-ract="size"]')?.click(),
        },
        { div: true },
        {
          ico: ICO.close,
          danger: true,
          label: isDesmos ? 'Close Desmos Calculator' : 'Close Reference Sheet',
          kbd: isDesmos ? 'D' : 'R',
          run: () => (isDesmos ? window.roomToggleDesmos?.(false) : window.roomToggleRef?.(false)),
        },
      ];
      return {
        targetEl: floatPanel,
        title: isDesmos ? 'Calculator · Desmos' : 'Reference Sheet',
        badge: dockedLeft ? 'Left Dock' : (dockedRight ? 'Right Dock' : 'Floating'),
        badgeCls: (dockedLeft || dockedRight) ? 'is-ongoing' : '',
        items,
      };
    }

    // 2. Test History Row
    const histRow = rawTarget.closest('.room-history-item[data-exam-id]');
    if (histRow) {
      const examId = histRow.dataset.examId;
      const histTime = histRow.dataset.historyTime ? Number(histRow.dataset.historyTime) : null;
      const ex = EXAMS[examId];
      if (!ex) return null;
      const histCount = allAttempts().filter((a) => a.examId === examId).length;
      const idx = allAttempts().findIndex((a) => a.examId === examId && Number(a.time) === Number(histTime));
      const openBtn = histRow.querySelector('[data-action="room-history-open"]');
      const hIdx = openBtn ? Number(openBtn.dataset.index) : idx;
      const items = [];
      if (hIdx >= 0) {
        items.push({ ico: ICO.eye, label: 'View Results', run: () => document.querySelector(`[data-action="room-history-open"][data-index="${hIdx}"]`)?.click() });
      }
      items.push({ ico: ICO.play, label: 'Retake Test', run: async () => { await ensureExamLoaded(examId); roomSetup(examId); } });
      if (hIdx >= 0 && typeof roomExport === 'function') {
        items.push({ ico: ICO.export, label: 'Export Missed Questions', run: () => { const a = allAttempts()[hIdx]; if (a) roomExport(a); } });
      }
      items.push({ div: true });
      items.push({ ico: ICO.trash, danger: true, label: 'Delete This Attempt', run: () => deleteExamRecords(examId, { clearProgress: false, clearHistory: false, attemptTime: histTime }) });
      if (histCount > 1) {
        items.push({ ico: ICO.trash, danger: true, label: `Delete All Records (${histCount})`, run: () => deleteExamRecords(examId, { clearProgress: true, clearHistory: true }) });
      }
      return { targetEl: histRow, title: ex.title, badge: 'History', badgeCls: 'is-done', items };
    }

    // 3. Mistake Bank Row
    const mistakeRow = rawTarget.closest('.room-mistake-row[data-mistake-exam]');
    if (mistakeRow) {
      const eid = mistakeRow.dataset.mistakeExam;
      const orig = Number(mistakeRow.dataset.mistakeOrig);
      const ex = EXAMS[eid];
      const items = [
        {
          ico: ICO.play,
          label: `Open Question Q${orig}`,
          run: () => mistakeRow.querySelector('[data-action="open-mistake-question"]')?.click(),
        },
        {
          ico: ICO.check,
          danger: true,
          label: 'Mark as Mastered (Remove)',
          run: () => {
            const prev = loadGlobalMistakes();
            saveGlobalMistakes(prev.filter((m) => !(m.examId === eid && Number(m.origId) === orig)));
            render();
            window.roomPushUndo({
              label: `Marked Q${orig} as mastered`,
              undo() { saveGlobalMistakes(prev); render(); },
            });
          },
        },
        { div: true },
        {
          ico: ICO.export,
          label: 'Push Mistake Bank to Anki',
          run: () => document.querySelector('[data-action="push-anki-mistakes"]')?.click(),
        },
      ];
      return { targetEl: mistakeRow, title: `${ex?.title || eid} · Q${orig}`, badge: 'Mistake', items };
    }

    // 4. Question Bank Exam Card or Row
    const examRow = rawTarget.closest('.room-row[data-exam-id], .room-card[data-exam-id]');
    if (examRow) {
      const examId = examRow.dataset.examId;
      const ex = EXAMS[examId];
      if (!ex) return null;
      const saved = readLibrary(getStorageKey(examId), {});
      const ongoing = ['mcq_exam', 'mcq_check', 'frq_exam', 'frq_check', 'break'].includes(saved.phase);
      const completed = ['complete', 'results'].includes(saved.phase);
      const histCount = allAttempts().filter((a) => a.examId === examId).length;
      const items = [];
      let badge = 'Not Started';
      let badgeCls = '';

      if (ongoing) {
        badge = 'In Progress';
        badgeCls = 'is-ongoing';
        items.push({ ico: ICO.play, label: 'Resume Test', run: () => examRow.querySelector('[data-action="room-open"]')?.click() });
        items.push({ ico: ICO.refresh, label: 'Start Fresh (New Setup)', run: async () => { await ensureExamLoaded(examId); roomSetup(examId); } });
        items.push({ div: true });
        items.push({ ico: ICO.trash, danger: true, label: 'Clear Progress (Remove Resume)', run: () => deleteExamRecords(examId, { clearProgress: true, clearHistory: false }) });
        if (histCount > 0) {
          items.push({ ico: ICO.trash, danger: true, label: `Delete All Records & History (${histCount})`, run: () => deleteExamRecords(examId, { clearProgress: true, clearHistory: true }) });
        }
      } else if (completed || histCount > 0) {
        badge = 'Completed';
        badgeCls = 'is-done';
        if (completed) {
          items.push({
            ico: ICO.eye,
            label: 'View Latest Results',
            run: async () => {
              await ensureExamLoaded(examId);
              currentExamId = examId;
              reviewedAttempt = null;
              state = loadState() || emptyState();
              closeAllUi();
              openResults();
              render();
            },
          });
        }
        items.push({ ico: ICO.play, label: 'Start / Setup Test', run: async () => { await ensureExamLoaded(examId); roomSetup(examId); } });
        items.push({ div: true });
        items.push({
          ico: ICO.trash,
          danger: true,
          label: histCount ? `Delete Saved Record & History (${histCount})` : 'Delete Saved Record',
          run: () => deleteExamRecords(examId, { clearProgress: true, clearHistory: true }),
        });
      } else {
        items.push({ ico: ICO.play, label: 'Start / Setup Test', run: async () => { await ensureExamLoaded(examId); roomSetup(examId); } });
        items.push({ disabled: true, label: 'No saved record to clear' });
      }
      return { targetEl: examRow, title: ex.title, badge, badgeCls, items };
    }

    // 5. Folder Card in Hierarchy View
    const folderCard = rawTarget.closest('.room-folder-card[data-folder]');
    if (folderCard) {
      const fname = folderCard.dataset.folder;
      return {
        targetEl: folderCard,
        title: fname,
        badge: 'Folder',
        items: [
          { ico: ICO.folder, label: 'Open Folder', run: () => folderCard.click() },
          { ico: ICO.refresh, label: 'Switch to Flat List View', run: () => document.querySelector('[data-action="set-display-mode"][data-mode="list"]')?.click() },
          { ico: ICO.refresh, label: 'Switch to Grid View', run: () => document.querySelector('[data-action="set-display-mode"][data-mode="grid"]')?.click() },
        ],
      };
    }

    // 6. Sidebar Subject Item
    const subjBtn = rawTarget.closest('.room-nav-item[data-action="filter-subject"]');
    if (subjBtn) {
      const skey = subjBtn.dataset.filter;
      const ongoingIds = ongoingIdsForSubject(skey);
      const labelEl = subjBtn.querySelector('.room-nav-lbl');
      const subjName = labelEl ? labelEl.textContent.trim() : 'Subject';
      const items = [
        { ico: ICO.folder, label: `Show ${subjName}`, run: () => subjBtn.click() },
        { ico: ICO.refresh, label: 'Show Flat List', run: () => { subjBtn.click(); document.querySelector('[data-action="set-display-mode"][data-mode="list"]')?.click(); } },
      ];
      if (ongoingIds.length) {
        items.push({ div: true });
        items.push({
          ico: ICO.trash,
          danger: true,
          label: `Clear All Resume (${ongoingIds.length})`,
          run: async () => {
            const snaps = ongoingIds.map((id) => ({
              id,
              key: getStorageKey(id),
              raw: localStorage.getItem(getStorageKey(id)),
            }));
            for (const id of ongoingIds) {
              await deleteExamRecords(id, { clearProgress: true, clearHistory: false }, true);
            }
            window.roomPushUndo({
              label: `Cleared ${ongoingIds.length} Resume record(s) in ${subjName}`,
              async undo() {
                for (const s of snaps) {
                  if (s.raw !== null) localStorage.setItem(s.key, s.raw);
                }
                if (typeof renderLibrary === 'function' && document.querySelector('.room')) renderLibrary();
                await window.roomSyncNow?.();
              },
            });
          },
        });
      }
      return { targetEl: subjBtn, title: subjName, badge: ongoingIds.length ? `${ongoingIds.length} Resume` : '', badgeCls: ongoingIds.length ? 'is-ongoing' : '', items };
    }

    // 7. Native MCQ Choice Option
    const optRow = rawTarget.closest('.question-option-row');
    const optCard = optRow?.querySelector('.option-card[data-action="answer"]');
    if (optCard && typeof state !== 'undefined' && state.phase === 'mcq_exam') {
      const letter = optCard.dataset.letter;
      const orig = Number(optCard.dataset.orig);
      const selected = state.mcq.answers[orig] === letter;
      const eliminated = Boolean(state.mcq.eliminated?.[orig]?.[letter]);
      const marked = Boolean(state.mcq.marks?.[orig]);
      const items = [
        {
          ico: ICO.check,
          label: selected ? `Clear Choice ${letter}` : `Select Choice ${letter}`,
          kbd: letter,
          run: () => {
            const prevAns = state.mcq.answers[orig];
            if (selected) delete state.mcq.answers[orig];
            else state.mcq.answers[orig] = letter;
            saveState();
            render();
            window.roomPushUndo({
              label: selected ? `Cleared Choice ${letter}` : `Selected Choice ${letter}`,
              undo() {
                if (prevAns !== undefined) state.mcq.answers[orig] = prevAns;
                else delete state.mcq.answers[orig];
                saveState();
                render();
              },
            });
          },
        },
        {
          ico: ICO.strike,
          label: eliminated ? `Restore Choice ${letter}` : `Cross Out Choice ${letter}`,
          run: () => {
            const prevElim = Boolean(state.mcq.eliminated?.[orig]?.[letter]);
            state.mcq.eliminated[orig] = state.mcq.eliminated[orig] || {};
            state.mcq.eliminated[orig][letter] = !prevElim;
            saveState();
            render();
            window.roomPushUndo({
              label: prevElim ? `Restored Choice ${letter}` : `Crossed out Choice ${letter}`,
              undo() {
                state.mcq.eliminated[orig] = state.mcq.eliminated[orig] || {};
                state.mcq.eliminated[orig][letter] = prevElim;
                saveState();
                render();
              },
            });
          },
        },
        { div: true },
        {
          ico: ICO.bookmark,
          label: marked ? 'Unmark for Review' : 'Mark for Review',
          kbd: 'M',
          run: () => document.querySelector('[data-action="toggle-mark"]')?.click(),
        },
      ];
      if (undoStack.length) {
        items.push({ ico: ICO.undo, label: `Undo (${undoStack[undoStack.length - 1].label})`, kbd: '⌘Z', run: () => window.roomPerformUndo() });
      }
      return { targetEl: optCard, title: `Choice ${letter}`, badge: eliminated ? 'Crossed Out' : (selected ? 'Selected' : ''), badgeCls: selected ? 'is-done' : '', items };
    }

    // 8. PDF Dual-Pane Bubble Option
    const pdfOptRow = rawTarget.closest('.pdf-opt-row');
    const pdfBubble = pdfOptRow?.querySelector('.pdf-bubble[data-pdf-choose]');
    const pdfCtx = typeof window.roomGetPdfExamState === 'function' ? window.roomGetPdfExamState() : null;
    if (pdfBubble && pdfCtx) {
      const { p } = pdfCtx;
      const letter = pdfBubble.dataset.pdfChoose;
      const qNum = p.currentQ;
      const k = String(qNum);
      const selected = p.answers[k] === letter;
      const ek = `${qNum}_${letter}`;
      const eliminated = Boolean(p.eliminated[ek]);
      const items = [
        {
          ico: ICO.check,
          label: selected ? `Clear Choice ${letter}` : `Select Choice ${letter}`,
          run: () => {
            const prevAns = p.answers[k];
            if (selected) delete p.answers[k];
            else p.answers[k] = letter;
            p.checkedQ = null;
            window.roomRenderPdfExam?.();
            window.roomPushUndo({
              label: selected ? `Cleared Q${qNum} Choice ${letter}` : `Selected Q${qNum} Choice ${letter}`,
              undo() {
                if (prevAns) p.answers[k] = prevAns;
                else delete p.answers[k];
                p.checkedQ = null;
                window.roomRenderPdfExam?.();
              },
            });
          },
        },
        {
          ico: ICO.strike,
          label: eliminated ? `Restore Choice ${letter}` : `Cross Out Choice ${letter}`,
          run: () => {
            const prevElim = Boolean(p.eliminated[ek]);
            p.eliminated[ek] = !prevElim;
            window.roomRenderPdfExam?.();
            window.roomPushUndo({
              label: prevElim ? `Restored Choice ${letter}` : `Crossed out Choice ${letter}`,
              undo() { p.eliminated[ek] = prevElim; window.roomRenderPdfExam?.(); },
            });
          },
        },
        { div: true },
        {
          ico: ICO.bookmark,
          label: p.marks[k] ? 'Unmark Question' : 'Mark for Review',
          run: () => document.querySelector('[data-pdf-act="toggle-mark"]')?.click(),
        },
      ];
      return { targetEl: pdfBubble, title: `Q${qNum} · Choice ${letter}`, items };
    }

    // 9. Navigator Question Tile / PDF Bubble Chip
    const qTile = rawTarget.closest('.question-tile[data-orig], .pdf-q-chip[data-pdf-q]');
    if (qTile) {
      if (qTile.matches('.pdf-q-chip[data-pdf-q]') && pdfCtx) {
        const { p } = pdfCtx;
        const qNum = Number(qTile.dataset.pdfQ);
        const k = String(qNum);
        const items = [
          { ico: ICO.play, label: `Jump to Q${qNum}`, run: () => qTile.click() },
          {
            ico: ICO.bookmark,
            label: p.marks[k] ? `Unmark Q${qNum}` : `Mark Q${qNum} for Review`,
            run: () => {
              const prevM = Boolean(p.marks[k]);
              if (prevM) delete p.marks[k]; else p.marks[k] = true;
              window.roomRenderPdfExam?.();
              window.roomPushUndo({ label: `Toggled Mark Q${qNum}`, undo() { if (prevM) p.marks[k] = true; else delete p.marks[k]; window.roomRenderPdfExam?.(); } });
            },
          },
        ];
        if (p.answers[k]) {
          items.push({
            ico: ICO.trash,
            danger: true,
            label: `Clear Answer Q${qNum} (${p.answers[k]})`,
            run: () => {
              const prevA = p.answers[k];
              delete p.answers[k];
              window.roomRenderPdfExam?.();
              window.roomPushUndo({ label: `Cleared Answer Q${qNum}`, undo() { p.answers[k] = prevA; window.roomRenderPdfExam?.(); } });
            },
          });
        }
        return { targetEl: qTile, title: `Question ${qNum}`, items };
      }
      const sec = qTile.dataset.section;
      const orig = Number(qTile.dataset.orig);
      const secSt = typeof sectionState === 'function' ? sectionState(sec) : null;
      const items = [{ ico: ICO.play, label: `Jump to Question ${orig}`, run: () => qTile.click() }];
      if (secSt) {
        items.push({
          ico: ICO.bookmark,
          label: secSt.marks?.[orig] ? 'Unmark for Review' : 'Mark for Review',
          run: () => {
            const prevM = Boolean(secSt.marks[orig]);
            if (prevM) delete secSt.marks[orig]; else secSt.marks[orig] = true;
            saveState();
            render();
            window.roomPushUndo({ label: `Toggled Mark Q${orig}`, undo() { if (prevM) secSt.marks[orig] = true; else delete secSt.marks[orig]; saveState(); render(); } });
          },
        });
        if (sec === 'mcq' && secSt.answers?.[orig]) {
          items.push({
            ico: ICO.trash,
            danger: true,
            label: `Clear Answer (${secSt.answers[orig]})`,
            run: () => {
              const prevA = secSt.answers[orig];
              delete secSt.answers[orig];
              saveState();
              render();
              window.roomPushUndo({ label: `Cleared Answer Q${orig}`, undo() { secSt.answers[orig] = prevA; saveState(); render(); } });
            },
          });
        }
      }
      return { targetEl: qTile, title: `Question ${orig}`, items };
    }

    // 10A. Active Exam Canvas (Native or PDF)
    const examShell = rawTarget.closest('.exam-screen, .pdf-exam-shell');
    if (examShell) {
      const ex = typeof getCurrentExam === 'function' ? getCurrentExam() : null;
      const showCalc = ex && ex.calculator && ex.calculator !== 'none';
      const showRef = ex && (ex.referencePdf || ex.referenceType);
      const isPdf = ex && ex.mode === 'pdf';
      const items = [];
      if (!isPdf) {
        const markEl = document.querySelector('[data-action="toggle-mark"]');
        items.push({ ico: ICO.bookmark, label: markEl?.checked ? 'Unmark for Review' : 'Mark for Review', kbd: 'M', run: () => markEl?.click() });
      } else {
        const pdfMark = document.querySelector('[data-pdf-act="toggle-mark"]');
        items.push({ ico: ICO.bookmark, label: pdfMark?.checked ? 'Unmark for Review' : 'Mark for Review', run: () => pdfMark?.click() });
      }
      if (showCalc) items.push({ ico: ICO.calc, label: 'Toggle Desmos Calculator', kbd: 'D', run: () => window.roomToggleDesmos?.() });
      if (showRef) items.push({ ico: ICO.book, label: 'Toggle Reference Sheet', kbd: 'R', run: () => window.roomToggleRef?.() });
      items.push({ ico: ICO.theme, label: isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode', run: () => document.querySelector('[data-action="room-toggle-theme"]')?.click() });
      if (undoStack.length) {
        items.push({ ico: ICO.undo, label: `Undo · ${undoStack[undoStack.length - 1].label}`, kbd: '⌘Z', run: () => window.roomPerformUndo() });
      }
      items.push({ div: true });
      if (!isPdf) {
        items.push({ ico: ICO.eye, label: 'Go to Check Your Work', run: () => document.querySelector('[data-action="open-nav"]')?.click() || document.querySelector('.pager-btns [data-action="go-check"]')?.click() });
      }
      items.push({ ico: ICO.close, danger: true, label: 'Exit to Question Bank', run: () => document.querySelector('[data-action="to-intro"]')?.click() });
      return { targetEl: examShell, title: ex?.title || 'Exam Tools', badge: isPdf ? 'PDF Mode' : 'Active Exam', items };
    }

    // 10B. Results / Check Your Work Canvas
    const resShell = rawTarget.closest('.results-screen, .check-screen');
    if (resShell) {
      const ex = typeof getCurrentExam === 'function' ? getCurrentExam() : null;
      const mistakeBtn = document.querySelector('[data-action="room-toggle-mistake"]');
      const copyBtn = document.querySelector('[data-action="copy-review-question"]');
      const items = [];
      if (mistakeBtn) items.push({ ico: ICO.bookmark, label: mistakeBtn.textContent.trim(), run: () => mistakeBtn.click() });
      if (copyBtn) items.push({ ico: ICO.export, label: 'Copy Question', run: () => copyBtn.click() });
      items.push({ ico: ICO.theme, label: isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode', run: () => window.roomToggleTheme?.() });
      if (resShell.matches('.check-screen')) {
        items.push({ ico: ICO.play, label: 'Return to Test', run: () => document.querySelector('[data-action="back-to-test"]')?.click() });
      } else {
        items.push({ ico: ICO.refresh, label: 'Retake Test', run: () => document.querySelector('[data-action="restart"]')?.click() });
      }
      items.push({ div: true });
      items.push({ ico: ICO.folder, label: 'Back to Question Bank', run: () => document.querySelector('[data-action="to-intro"]')?.click() });
      return { targetEl: resShell, title: ex?.title || 'Test Review', items };
    }

    // 10C. Question Bank / Library Canvas
    const roomRoot = rawTarget.closest('.room');
    if (roomRoot) {
      const items = [
        { ico: ICO.folder, label: 'Folders View', run: () => document.querySelector('[data-action="set-display-mode"][data-mode="folder"]')?.click() },
        { ico: ICO.folder, label: 'Grid View', run: () => document.querySelector('[data-action="set-display-mode"][data-mode="grid"]')?.click() },
        { ico: ICO.folder, label: 'List View', run: () => document.querySelector('[data-action="set-display-mode"][data-mode="list"]')?.click() },
        { div: true },
        { ico: ICO.export, label: 'Import JSON Bank…', run: () => document.getElementById('room-file')?.click() },
        { ico: ICO.refresh, label: 'Sync Devices Now', run: async () => { await window.roomSyncNow?.(); showRoomToast('Synced with Mac/iPad'); } },
        { ico: ICO.theme, label: isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode', run: () => document.querySelector('[data-action="room-toggle-theme"]')?.click() },
      ];
      if (undoStack.length) {
        items.push({ div: true });
        items.push({ ico: ICO.undo, label: `Undo · ${undoStack[undoStack.length - 1].label}`, kbd: '⌘Z', run: () => window.roomPerformUndo() });
      }
      return { targetEl: roomRoot, title: 'AP Exam Room', badge: libraryView, items };
    }

    return null;
  }

  document.addEventListener('contextmenu', (e) => {
    const t = e.target;
    if (t && t.closest('input, textarea, select, [contenteditable="true"]')) return;
    const sel = window.getSelection()?.toString().trim();
    if (sel && t?.closest('.stem-pane, .question-prompt, .question-combined, .explanation-box, .room-answer-exp-content')) return;

    const spec = resolveContextSpec(t);
    if (!spec) return;
    e.preventDefault();
    showContextMenuSpec(spec, e.clientX, e.clientY, spec.targetEl);
  });

  document.addEventListener('pointerdown', (e) => {
    if (ctxEl && !ctxEl.hidden && !e.target.closest('#room-ctx-menu')) {
      closeExamContextMenu();
    }
    if (e.pointerType !== 'touch') return;
    if (e.target.closest('button, input, textarea, select, summary, a, [data-action="answer"], .pdf-bubble')) return;
    const spec = resolveContextSpec(e.target);
    if (!spec) return;
    clearTimeout(lpTimer);
    lpStart = { x: e.clientX, y: e.clientY, target: e.target };
    lpTimer = setTimeout(() => {
      if (!lpStart) return;
      const freshSpec = resolveContextSpec(lpStart.target);
      if (freshSpec) {
        blockNextClickUntil = Date.now() + 600;
        showContextMenuSpec(freshSpec, lpStart.x, lpStart.y, freshSpec.targetEl);
      }
      lpStart = null;
    }, 480);
  });

  document.addEventListener('pointermove', (e) => {
    if (!lpStart) return;
    if (Math.hypot(e.clientX - lpStart.x, e.clientY - lpStart.y) > 10) {
      clearTimeout(lpTimer);
      lpStart = null;
    }
  });
  const cancelLongPress = () => { clearTimeout(lpTimer); lpStart = null; };
  document.addEventListener('pointerup', cancelLongPress);
  document.addEventListener('pointercancel', cancelLongPress);
  document.addEventListener('scroll', () => { cancelLongPress(); closeExamContextMenu(true); }, true);
  window.addEventListener('resize', () => closeExamContextMenu(true));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeExamContextMenu();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (undoStack.length > 0) {
        e.preventDefault();
        closeExamContextMenu(true);
        window.roomPerformUndo();
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (Date.now() < blockNextClickUntil) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  document.addEventListener('click', async (e) => {
    const undoBtn = e.target.closest('[data-toast-undo]');
    if (undoBtn) {
      await window.roomPerformUndo();
      return;
    }
    const item = e.target.closest('#room-ctx-menu [data-ctx-key]');
    if (!item || !ctxEl) return;
    const key = item.dataset.ctxKey;
    const fn = pendingActionMap.get(key);
    closeExamContextMenu(true);
    if (typeof fn === 'function') {
      await fn();
    }
  });
})();

// --- macOS Unified Header Window Drag & Zoom Integration ---
(function () {
  if (!window.ROOM_IS_APP_WEBKIT) return;
  document.documentElement.classList.add('is-mac-app');
  const HEADER_SEL = '.room-header, .exam-header, .results-header, .break-header';
  const INTERACTIVE_SEL = 'button, a, input, select, textarea, label, [data-action], [data-pdf-act], [data-stats-act], .room-dropdown, .room-float-panel, summary';

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.detail > 1) return;
    const hdr = e.target.closest?.(HEADER_SEL);
    if (!hdr || e.target.closest?.(INTERACTIVE_SEL)) return;
    window.webkit?.messageHandlers?.roomStartWindowDrag?.postMessage(true);
  });

  document.addEventListener('dblclick', (e) => {
    const hdr = e.target.closest?.(HEADER_SEL);
    if (!hdr || e.target.closest?.(INTERACTIVE_SEL)) return;
    window.webkit?.messageHandlers?.roomToggleZoom?.postMessage(true);
  });
})();
