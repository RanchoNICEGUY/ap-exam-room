/* Stats.js - Anki-Style Study Statistics, Subject Progress, Pace (min/Q) & Interactive Review Heatmap */
(function () {
  let statsHeatmapYear = new Date().getFullYear();
  let statsHeatmapMetric = 'questions'; // 'questions' | 'sets'
  let hmTipEl = null;

  function toLocalDayKey(ms) {
    if (!ms) return '';
    const d = new Date(Number(ms));
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function makeLocalDayKey(year, month0, day) {
    return `${year}-${String(month0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function parseDayKeyUtc(key) {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }

  function estimateAttemptElapsedSec(attempt, ex) {
    const answered = Number(attempt?.answered || 0);
    if (answered <= 0) return null;

    const recorded = Number(attempt?.elapsedSec);
    if (Number.isFinite(recorded) && recorded > 0) {
      return Math.max(1, Math.min(14400, Math.round(recorded)));
    }

    const st = attempt?.state || {};
    if (Number.isFinite(st.startedAt) && Number.isFinite(st.completionShownAt) && st.completionShownAt > st.startedAt) {
      const wall = Math.round((st.completionShownAt - st.startedAt) / 1000);
      if (wall >= 2 && wall <= 14400) return wall;
    }

    const rs = st.roomSettings || {};
    if (rs.timing === 'untimed') return null;

    // Retroactive timed MCQ recovery
    if (st.mcq?.timerStarted && typeof st.mcq.timeRemaining === 'number') {
      const initSec = (rs.timing === 'custom' && Number(rs.minutes) > 0)
        ? Number(rs.minutes) * 60
        : Number(ex?.durationSeconds || 1800);
      const diff = initSec - st.mcq.timeRemaining;
      if (diff > 5 && diff < initSec) {
        return Math.min(14400, Math.round(diff));
      }
    }

    // Retroactive timed FRQ recovery when MCQ wasn't timed
    if (st.frq?.timerStarted && typeof st.frq.timeRemaining === 'number') {
      const initSec = (rs.timing === 'custom' && Number(rs.frqMinutes) > 0)
        ? Number(rs.frqMinutes) * 60
        : Number(ex?.frqDurationSeconds || ex?.durationSeconds || 1800);
      const diff = initSec - st.frq.timeRemaining;
      if (diff > 5 && diff < initSec) {
        return Math.min(14400, Math.round(diff));
      }
    }
    return null;
  }
  window.estimateAttemptElapsedSec = estimateAttemptElapsedSec;

  function formatPaceMin(avgMinPerQ) {
    if (avgMinPerQ === null || !Number.isFinite(avgMinPerQ) || avgMinPerQ <= 0) return '—';
    return `${avgMinPerQ < 10 ? avgMinPerQ.toFixed(1) : Math.round(avgMinPerQ)} min`;
  }

  function formatDurationCompact(sec) {
    if (!sec || sec <= 0) return '0m';
    const mins = Math.round(sec / 60);
    if (mins < 60) return `${Math.max(1, mins)}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  window.computeRoomStats = function () {
    const allExams = Object.values(EXAMS || {});
    const attempts = typeof allAttempts === 'function' ? allAttempts() : [];
    const prog = typeof buildExamProgressIndex === 'function' ? buildExamProgressIndex(allExams) : new Map();
    const subjectsList = typeof getSubjectsList === 'function' ? getSubjectsList() : [];
    const todayKey = toLocalDayKey(Date.now());

    let completedTotal = 0;
    let completedNative = 0;
    let totalNative = 0;
    const subjCounts = new Map();

    for (const s of subjectsList) {
      subjCounts.set(s.key, {
        key: s.key,
        name: s.name,
        zh: s.zh || s.name,
        icon: s.icon || 'extended.svg',
        isExtended: Boolean(s.isExtended),
        doneNative: 0,
        totalNative: 0,
        doneAll: 0,
        totalAll: 0,
        correct: 0,
        graded: 0,
        timedSec: 0,
        timedQs: 0,
        attemptsCount: 0,
      });
    }

    for (const ex of allExams) {
      const isNative = ex.mode !== 'pdf';
      if (isNative) totalNative++;
      const st = prog.get(ex.id);
      const done = Boolean(st?.completed);
      if (done) {
        completedTotal++;
        if (isNative) completedNative++;
      }
      const bucket = subjCounts.get(ex.subjectKey);
      if (bucket) {
        bucket.totalAll++;
        if (isNative) bucket.totalNative++;
        if (done) {
          bucket.doneAll++;
          if (isNative) bucket.doneNative++;
        }
      }
    }

    const byDay = new Map();
    const paceMap = new Map();
    let totalCorrect = 0;
    let totalGraded = 0;
    let totalQuestions = 0;
    let totalTimedSec = 0;
    let totalTimedQs = 0;

    for (const a of attempts) {
      const ex = EXAMS[a.examId];
      const dayKey = toLocalDayKey(a.time);
      const ans = Number(a.answered || 0);
      const corr = Number(a.correct || 0);
      const grad = Number(a.graded || 0);
      const elapsed = estimateAttemptElapsedSec(a, ex);

      totalQuestions += ans;
      if (grad > 0 && ans > 0) {
        totalCorrect += corr;
        totalGraded += grad;
      }
      if (elapsed !== null && ans > 0) {
        totalTimedSec += elapsed;
        totalTimedQs += ans;
      }

      if (dayKey) {
        let dayEntry = byDay.get(dayKey);
        if (!dayEntry) {
          dayEntry = { questions: 0, sets: 0, correct: 0, graded: 0, elapsedSec: 0 };
          byDay.set(dayKey, dayEntry);
        }
        dayEntry.questions += ans;
        dayEntry.sets += 1;
        if (grad > 0 && ans > 0) {
          dayEntry.correct += corr;
          dayEntry.graded += grad;
        }
        if (elapsed !== null) dayEntry.elapsedSec += elapsed;
      }

      if (ex) {
        const sb = subjCounts.get(ex.subjectKey);
        if (sb) {
          sb.attemptsCount++;
          if (grad > 0 && ans > 0) {
            sb.correct += corr;
            sb.graded += grad;
          }
          if (elapsed !== null && ans > 0) {
            sb.timedSec += elapsed;
            sb.timedQs += ans;
          }
        }

        if (ans > 0) {
          const cat = ex.category || 'homework';
          const pk = `${ex.subjectKey}::${cat}`;
          let pr = paceMap.get(pk);
          if (!pr) {
            pr = {
              subjectKey: ex.subjectKey,
              subjectName: ex.subject,
              subjectZh: ex.subjectZh || sb?.zh || ex.subject,
              icon: sb?.icon || 'extended.svg',
              category: cat,
              categoryLabel: (typeof labels !== 'undefined' && labels[cat]) || cat,
              setsCount: 0,
              questionsCount: 0,
              correct: 0,
              graded: 0,
              timedSec: 0,
              timedQs: 0,
            };
            paceMap.set(pk, pr);
          }
          pr.setsCount += 1;
          pr.questionsCount += ans;
          if (grad > 0) {
            pr.correct += corr;
            pr.graded += grad;
          }
          if (elapsed !== null) {
            pr.timedSec += elapsed;
            pr.timedQs += ans;
          }
        }
      }
    }

    const todayEntry = byDay.get(todayKey) || { questions: 0, sets: 0, correct: 0, graded: 0, elapsedSec: 0 };

    // Streaks across all active dates (descending sorted)
    const activeDays = [...byDay.entries()]
      .filter(([, v]) => v.questions > 0 || v.sets > 0)
      .map(([k]) => k)
      .sort();

    let longestStreak = 0;
    let run = 0;
    let prevUtc = null;
    const ONE_DAY_MS = 86400000;
    for (const dk of activeDays) {
      const utc = parseDayKeyUtc(dk);
      if (prevUtc !== null && Math.round((utc - prevUtc) / ONE_DAY_MS) === 1) {
        run++;
      } else {
        run = 1;
      }
      if (run > longestStreak) longestStreak = run;
      prevUtc = utc;
    }

    let currentStreak = 0;
    const activeSet = new Set(activeDays);
    if (activeDays.length) {
      const now = new Date();
      let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (!activeSet.has(toLocalDayKey(cursor.getTime()))) {
        cursor.setDate(cursor.getDate() - 1);
      }
      while (activeSet.has(toLocalDayKey(cursor.getTime()))) {
        currentStreak++;
        cursor.setDate(cursor.getDate() - 1);
      }
    }

    const focusSet = new Set(typeof roomFocusSubjects === 'function' ? roomFocusSubjects() : []);
    const subjectProgress = [...subjCounts.values()]
      .filter((s) => !s.isExtended || s.doneAll > 0 || s.attemptsCount > 0)
      .map((s, idx) => ({
        ...s,
        isFocused: focusSet.has(s.key),
        _idx: idx,
        pctNative: s.totalNative ? Math.round((s.doneNative / s.totalNative) * 100) : 0,
        pctAll: s.totalAll ? Math.round((s.doneAll / s.totalAll) * 100) : 0,
        acc: s.graded > 0 ? Math.round((s.correct / s.graded) * 100) : null,
        avgMinPerQ: s.timedQs > 0 ? (s.timedSec / 60) / s.timedQs : null,
      }))
      .sort((a, b) => ((b.isFocused ? 1 : 0) - (a.isFocused ? 1 : 0)) || (a._idx - b._idx));

    const paceRows = [...paceMap.values()]
      .map((r) => ({
        ...r,
        acc: r.graded > 0 ? Math.round((r.correct / r.graded) * 100) : null,
        avgMinPerQ: r.timedQs > 0 ? (r.timedSec / 60) / r.timedQs : null,
      }))
      .sort((a, b) => (b.questionsCount - a.questionsCount) || (b.setsCount - a.setsCount));

    return {
      todayKey,
      todayQuestions: todayEntry.questions,
      todaySets: todayEntry.sets,
      todayAccuracy: todayEntry.graded > 0 ? Math.round((todayEntry.correct / todayEntry.graded) * 100) : null,
      todayElapsedSec: todayEntry.elapsedSec,
      completedTotal,
      completedNative,
      totalNative,
      totalBank: allExams.length,
      totalAttempts: attempts.length,
      totalQuestions,
      totalCorrect,
      totalGraded,
      overallAccuracy: totalGraded > 0 ? Math.round((totalCorrect / totalGraded) * 100) : null,
      avgMinPerQ: totalTimedQs > 0 ? (totalTimedSec / 60) / totalTimedQs : null,
      totalTimedQs,
      byDay,
      currentStreak,
      longestStreak,
      subjectProgress,
      paceRows,
    };
  };

  function heatmapLevel(val, metric) {
    if (!val || val <= 0) return 0;
    if (metric === 'sets') {
      if (val >= 5) return 4;
      if (val >= 3) return 3;
      if (val >= 2) return 2;
      return 1;
    }
    if (val >= 35) return 4;
    if (val >= 18) return 3;
    if (val >= 7) return 2;
    return 1;
  }

  function renderReviewHeatmap(stats) {
    const year = statsHeatmapYear;
    const todayKey = stats.todayKey;
    const nowYear = new Date().getFullYear();
    const jan1 = new Date(year, 0, 1);
    const dec31 = new Date(year, 11, 31);
    const startPad = jan1.getDay(); // 0 = Sun
    const endPad = 6 - dec31.getDay();

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const totalDaysInYear = Math.round((Date.UTC(year, 11, 31) - Date.UTC(year, 0, 1)) / 86400000) + 1;
    const totalCells = startPad + totalDaysInYear + endPad;
    const numCols = Math.ceil(totalCells / 7);

    const monthLabels = new Array(numCols).fill('');
    let yearSum = 0;
    let yearActiveDays = 0;
    let yearSpanDays = year < nowYear ? totalDaysInYear : (year > nowYear ? 0 : (Math.floor((Date.UTC(nowYear, new Date().getMonth(), new Date().getDate()) - Date.UTC(year, 0, 1)) / 86400000) + 1));
    let lastLabeledMonth = -1;

    const cellsHtml = [];
    for (let i = 0; i < startPad; i++) {
      cellsHtml.push('<span class="room-hm-spacer" aria-hidden="true"></span>');
    }

    for (let dIdx = 0; dIdx < totalDaysInYear; dIdx++) {
      const dt = new Date(year, 0, 1 + dIdx);
      const col = Math.floor((startPad + dIdx) / 7);
      const mIdx = dt.getMonth();
      if (dIdx === 0) {
        monthLabels[col] = months[mIdx];
        lastLabeledMonth = mIdx;
      } else if (dt.getDate() === 1 && mIdx !== lastLabeledMonth) {
        if (!monthLabels[col] && (col === 0 || !monthLabels[col - 1])) {
          monthLabels[col] = months[mIdx];
        } else if (col + 1 < numCols && !monthLabels[col + 1]) {
          monthLabels[col + 1] = months[mIdx];
        }
        lastLabeledMonth = mIdx;
      }
      const key = makeLocalDayKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
      const rec = stats.byDay.get(key);
      const qCount = rec?.questions || 0;
      const sCount = rec?.sets || 0;
      const metricVal = statsHeatmapMetric === 'sets' ? sCount : qCount;
      const lvl = heatmapLevel(metricVal, statsHeatmapMetric);
      if (metricVal > 0) {
        yearSum += metricVal;
        yearActiveDays++;
      }
      const isToday = key === todayKey;
      const isFuture = key > todayKey;
      const accTxt = rec && rec.graded > 0 ? ` · ${Math.round((rec.correct / rec.graded) * 100)}% acc` : '';
      const tip = metricVal > 0
        ? `${key}: ${qCount} Qs · ${sCount} set${sCount === 1 ? '' : 's'}${accTxt}`
        : `${key}: No activity`;
      cellsHtml.push(`<button type="button" class="room-hm-cell is-l${lvl} ${isToday ? 'is-today' : ''} ${isFuture ? 'is-future' : ''}" data-hm-tip="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}"></button>`);
    }

    for (let i = 0; i < endPad; i++) {
      cellsHtml.push('<span class="room-hm-spacer" aria-hidden="true"></span>');
    }

    const daysPct = yearSpanDays > 0 ? Math.min(100, Math.round((yearActiveDays / yearSpanDays) * 100)) : 0;
    const dailyAvg = yearActiveDays > 0 ? Math.round(yearSum / yearActiveDays) : 0;
    const unitLabel = statsHeatmapMetric === 'sets' ? 'sets' : 'questions';

    return `
      <section class="room-stats-card room-hm-card">
        <div class="room-hm-head">
          <div>
            <h2>Review Heatmap</h2>
            <p class="room-meta">Daily study intensity and streak history across all AP tests</p>
          </div>
          <div class="room-hm-controls">
            <div class="room-hm-toggle" role="group" aria-label="Heatmap metric">
              <button type="button" class="${statsHeatmapMetric === 'questions' ? 'is-active' : ''}" data-stats-act="hm-metric" data-val="questions">Questions</button>
              <button type="button" class="${statsHeatmapMetric === 'sets' ? 'is-active' : ''}" data-stats-act="hm-metric" data-val="sets">Sets</button>
            </div>
            <div class="room-hm-nav" role="group" aria-label="Year navigation">
              <button type="button" data-stats-act="hm-prev" title="Previous year" aria-label="Previous year">‹</button>
              <button type="button" data-stats-act="hm-today" title="Jump to current year" aria-label="Current year">○</button>
              <button type="button" data-stats-act="hm-next" title="Next year" aria-label="Next year" ${year >= nowYear + 1 ? 'disabled' : ''}>›</button>
            </div>
          </div>
        </div>
        <div class="room-hm-scroll">
          <div class="room-hm-months" style="grid-template-columns: repeat(${numCols}, 13px);">
            ${monthLabels.map((lbl) => `<span>${lbl}</span>`).join('')}
          </div>
          <div class="room-hm-body">
            <div class="room-hm-weekdays" aria-hidden="true">
              <span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span>
            </div>
            <div class="room-hm-grid">${cellsHtml.join('')}</div>
          </div>
          <div class="room-hm-year-lbl">${year}</div>
        </div>
        <div class="room-hm-legend">
          <span>Less</span>
          <i class="room-hm-cell is-l0"></i>
          <i class="room-hm-cell is-l1"></i>
          <i class="room-hm-cell is-l2"></i>
          <i class="room-hm-cell is-l3"></i>
          <i class="room-hm-cell is-l4"></i>
          <span>More</span>
        </div>
        <div class="room-hm-footer">
          <span>Daily average: <strong class="hm-stat-green">${dailyAvg} ${unitLabel}</strong></span>
          <span>Days studied: <strong class="hm-stat-lime">${daysPct}%</strong></span>
          <span>Longest streak: <strong class="hm-stat-lime">${stats.longestStreak} day${stats.longestStreak === 1 ? '' : 's'}</strong></span>
          <span>Current streak: <strong class="hm-stat-green">${stats.currentStreak} day${stats.currentStreak === 1 ? '' : 's'}</strong></span>
        </div>
      </section>`;
  }

  window.renderStatsMarkup = function () {
    const stats = window.computeRoomStats();
    const maxPace = Math.max(2, ...stats.paceRows.map((r) => r.avgMinPerQ || 0));
    const dailyGoal = typeof roomDailyGoal === 'function' ? roomDailyGoal() : 20;
    const goalPct = dailyGoal > 0 ? Math.min(100, Math.round((stats.todayQuestions / dailyGoal) * 100)) : 0;

    return `<div class="room-stats-page">
      <div class="room-stats-head">
        <div>
          <h1>Study Statistics</h1>
          <p class="room-meta">Track completed sets, subject progress, accuracy, speed per question, and daily streaks.</p>
        </div>
      </div>

      <section class="room-stats-kpis" aria-label="Key metrics">
        <div class="room-kpi-card is-today">
          <div class="room-kpi-lbl">Today's Study</div>
          <div class="room-kpi-val">${stats.todayQuestions} <span>Qs</span></div>
          <div class="room-kpi-sub">${stats.todaySets} set${stats.todaySets === 1 ? '' : 's'}${stats.todayAccuracy !== null ? ` · ${stats.todayAccuracy}% acc` : ''}${stats.todayElapsedSec ? ` · ${formatDurationCompact(stats.todayElapsedSec)}` : ''}${dailyGoal > 0 ? ` · ${stats.todayQuestions >= dailyGoal ? 'Daily goal met ✓' : `${stats.todayQuestions}/${dailyGoal} goal`}` : ''}</div>
          ${dailyGoal > 0 ? `<div class="room-kpi-goal-bar" aria-hidden="true"><i style="width:${goalPct}%"></i></div>` : ''}
        </div>
        <div class="room-kpi-card">
          <div class="room-kpi-lbl">Completed Tests</div>
          <div class="room-kpi-val">${stats.completedTotal}</div>
          <div class="room-kpi-sub">${stats.completedNative} / ${stats.totalNative} interactive sets</div>
        </div>
        <div class="room-kpi-card">
          <div class="room-kpi-lbl">Overall Accuracy</div>
          <div class="room-kpi-val">${stats.overallAccuracy !== null ? `${stats.overallAccuracy}%` : '—'}</div>
          <div class="room-kpi-sub">${stats.totalCorrect} / ${stats.totalGraded} graded questions</div>
        </div>
        <div class="room-kpi-card">
          <div class="room-kpi-lbl">Avg Pace / Question</div>
          <div class="room-kpi-val">${formatPaceMin(stats.avgMinPerQ)}</div>
          <div class="room-kpi-sub">${stats.totalTimedQs ? `Across ${stats.totalTimedQs} timed questions` : 'Complete a timed test to measure'}</div>
        </div>
      </section>

      ${renderReviewHeatmap(stats)}

      <div class="room-stats-grid">
        <section class="room-stats-card">
          <div class="room-stats-card-head">
            <h2>Subject Completion &amp; Accuracy</h2>
            <span class="room-meta">Click any subject to jump in</span>
          </div>
          <div class="room-subj-prog-list">
            ${stats.subjectProgress.map((s) => {
              const barPct = s.totalNative > 0 ? s.pctNative : s.pctAll;
              const ratioHtml = s.totalNative > 0
                ? `<strong>${s.doneNative}</strong>/${s.totalNative} interactive${s.totalAll > s.totalNative ? ` · ${s.doneAll}/${s.totalAll} all` : ''}`
                : `<strong>${s.doneAll}</strong>/${s.totalAll} sets`;
              return `
              <button type="button" class="room-subj-prog-row" data-stats-jump-subject="${escapeHtml(s.key)}">
                <div class="room-subj-prog-top">
                  <span class="room-subj-prog-name">
                    <img src="Assets/icons/${escapeHtml(s.icon)}" alt="" width="20" height="20">
                    <strong>${escapeHtml(s.zh || s.name)}</strong>
                    ${s.isFocused ? '<span class="room-focus-pill">★ My AP</span>' : ''}
                  </span>
                  <span class="room-subj-prog-nums">
                    ${s.acc !== null ? `<span class="room-acc-pill">${s.acc}% acc</span>` : ''}
                    ${s.avgMinPerQ !== null ? `<span class="room-pace-pill">${formatPaceMin(s.avgMinPerQ)}/Q</span>` : ''}
                    <span class="room-prog-ratio">${ratioHtml}</span>
                  </span>
                </div>
                <div class="room-prog-track" aria-hidden="true">
                  <div class="room-prog-fill" style="width:${barPct}%"></div>
                </div>
              </button>`;
            }).join('')}
          </div>
        </section>

        <section class="room-stats-card">
          <div class="room-stats-card-head">
            <h2>Pace by Subject &amp; Question Type</h2>
            <span class="room-meta">Average minutes per question</span>
          </div>
          ${stats.paceRows.length ? `
            <div class="room-pace-table-wrap">
              <table class="room-pace-table">
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Type</th>
                    <th>Done</th>
                    <th>Accuracy</th>
                    <th>Pace / Q</th>
                  </tr>
                </thead>
                <tbody>
                  ${stats.paceRows.map((r) => {
                    const barPct = r.avgMinPerQ ? Math.min(100, Math.round((r.avgMinPerQ / maxPace) * 100)) : 0;
                    return `<tr>
                      <td>
                        <span class="room-pace-subj">
                          <img src="Assets/icons/${escapeHtml(r.icon)}" alt="" width="16" height="16">
                          <span>${escapeHtml(r.subjectZh)}</span>
                        </span>
                      </td>
                      <td><span class="room-badge">${escapeHtml(r.categoryLabel)}</span></td>
                      <td>${r.questionsCount} Qs <span class="room-meta">(${r.setsCount})</span></td>
                      <td>${r.acc !== null ? `<strong>${r.acc}%</strong>` : '—'}</td>
                      <td>
                        <div class="room-pace-cell">
                          <strong>${formatPaceMin(r.avgMinPerQ)}</strong>
                          ${r.avgMinPerQ ? `<span class="room-pace-bar"><i style="width:${barPct}%"></i></span>` : ''}
                        </div>
                      </td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>` : '<p class="room-meta">Complete any test to see subject and question-type speed statistics.</p>'}
        </section>
      </div>
    </div>`;
  };

  function ensureHmTip() {
    if (hmTipEl && hmTipEl.isConnected) return hmTipEl;
    hmTipEl = document.createElement('div');
    hmTipEl.id = 'room-hm-tooltip';
    hmTipEl.className = 'room-hm-tooltip';
    hmTipEl.hidden = true;
    document.body.appendChild(hmTipEl);
    return hmTipEl;
  }

  document.addEventListener('pointerover', (e) => {
    const cell = e.target.closest?.('.room-hm-cell[data-hm-tip]');
    if (!cell) return;
    const tip = ensureHmTip();
    tip.textContent = cell.dataset.hmTip || '';
    tip.hidden = false;
    const r = cell.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - tip.offsetWidth - 8, r.left + r.width / 2 - tip.offsetWidth / 2));
    const top = Math.max(8, r.top - tip.offsetHeight - 8);
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
  });

  document.addEventListener('pointerout', (e) => {
    if (e.target.closest?.('.room-hm-cell[data-hm-tip]') && hmTipEl) {
      hmTipEl.hidden = true;
    }
  });

  document.addEventListener('click', (e) => {
    const actBtn = e.target.closest('[data-stats-act]');
    if (actBtn) {
      const act = actBtn.dataset.statsAct;
      if (act === 'hm-prev') statsHeatmapYear--;
      else if (act === 'hm-next') statsHeatmapYear = Math.min(new Date().getFullYear() + 1, statsHeatmapYear + 1);
      else if (act === 'hm-today') statsHeatmapYear = new Date().getFullYear();
      else if (act === 'hm-metric') statsHeatmapMetric = actBtn.dataset.val === 'sets' ? 'sets' : 'questions';
      if (hmTipEl) hmTipEl.hidden = true;
      if (typeof renderLibrary === 'function') renderLibrary();
      return;
    }

    const subjJump = e.target.closest('[data-stats-jump-subject]');
    if (subjJump) {
      const skey = subjJump.dataset.statsJumpSubject;
      if (hmTipEl) hmTipEl.hidden = true;
      const subjBtn = document.querySelector(`[data-action="filter-subject"][data-filter="${CSS.escape(skey)}"]`);
      document.querySelector('[data-action="room-view"][data-filter="bank"]')?.click();
      setTimeout(() => {
        document.querySelector(`[data-action="filter-subject"][data-filter="${CSS.escape(skey)}"]`)?.click();
      }, 0);
      if (!subjBtn && typeof currentSubjectFilter !== 'undefined') {
        currentSubjectFilter = skey;
        libraryView = 'bank';
        libraryFolderPath = [];
        libraryPage = 1;
        if (typeof renderLibrary === 'function') renderLibrary();
      }
    }
  });
})();
