const roomPreferencesKey = 'ap-room-preferences-v1';
const roomBackupFormat = 'ap-exam-room-backup';
const roomDeleteOptions = {
  history: ['Completed attempts', 'Deletes scores, responses, and reviews from Test History.'],
  progress: ['In-progress tests', 'Deletes saved answers, notes, and timers for tests you have not submitted.'],
  mistakes: ['Mistake Bank', 'Clears saved and automatically collected missed questions.'],
  imports: ['Imported tests', 'Removes your imported tests and any attempts or saved progress for those tests.'],
  profile: ['Profile & preferences', 'Resets your display name, theme, daily goal, and re-enables first-load Welcome Setup.']
};

window.roomGetPreferences = function () {
  const raw = readLibrary(roomPreferencesKey, {});
  return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
};

window.roomUpdatePreferences = function (patch) {
  const next = { ...roomGetPreferences(), ...(patch || {}) };
  localStorage.setItem(roomPreferencesKey, JSON.stringify(next));
  return next;
};

window.roomUserName = function () {
  return String(roomGetPreferences().userName || '').trim().slice(0, 40);
};

window.roomDailyGoal = function () {
  const raw = roomGetPreferences().dailyGoal;
  if (raw === 0 || raw === '0') return 0;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.min(200, Math.max(5, Math.round(n)));
  return 20;
};

window.roomFocusSubjects = function () {
  const list = roomGetPreferences().focusSubjects;
  return Array.isArray(list) ? list.map(String).filter(Boolean) : [];
};

window.roomHasAnyUserData = function () {
  try {
    if (typeof allAttempts === 'function' && allAttempts().length > 0) return true;
    if (typeof databaseAttempts !== 'undefined' && Array.isArray(databaseAttempts) && databaseAttempts.length > 0) return true;
    if (typeof loadGlobalMistakes === 'function' && loadGlobalMistakes().length > 0) return true;
    if (Object.keys(readLibrary(libraryImportKey, {})).length > 0) return true;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('bluebook_exam_state_')) continue;
      const snap = readLibrary(k, {});
      if (snap && snap.phase && snap.phase !== 'intro') return true;
    }
  } catch (_) {}
  return false;
};

window.roomShouldShowOnboarding = function () {
  const prefs = roomGetPreferences();
  return !prefs.onboarded && !roomUserName() && !roomHasAnyUserData();
};

function roomCopyAllowed() {
  return roomGetPreferences().allowCopy !== false;
}

function roomPetsAllowed() {
  return roomGetPreferences().showPets !== false;
}

let onboardingChecked = false;
window.roomMaybeOpenOnboarding = function () {
  if (onboardingChecked) return;
  if (typeof state !== 'undefined' && state?.phase && state.phase !== 'intro') return;
  if (document.querySelector('dialog[open]')) return;
  if (!document.querySelector('.room')) return;
  onboardingChecked = true;
  if (roomShouldShowOnboarding()) {
    window.openRoomOnboarding({ manual: false });
  }
};
setTimeout(() => { window.roomMaybeOpenOnboarding?.(); }, 750);

window.openRoomOnboarding = function (opts = {}) {
  const manual = Boolean(opts.manual);
  if (document.getElementById('room-onboarding-dialog')) return;

  const prevTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  let draftName = roomUserName();
  let draftTheme = prevTheme;
  let draftGoal = roomDailyGoal();
  const draftSubjects = new Set(roomFocusSubjects());
  const mainSubjects = typeof getSubjectsList === 'function' ? getSubjectsList().filter(s => !s.isExtended) : [];

  const greetingWord = () => {
    const h = new Date().getHours();
    return h < 5 ? 'Hello' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  };
  const formatGreetingPreview = (nm) => {
    const clean = String(nm || '').trim().slice(0, 40);
    return clean ? `${greetingWord()}, ${clean}.` : `${greetingWord()}.`;
  };

  const goalChoices = [
    { val: 0, label: 'Off' },
    { val: 10, label: '10 Qs/day' },
    { val: 20, label: '20 Qs/day' },
    { val: 30, label: '30 Qs/day' },
    { val: 50, label: '50 Qs/day' },
  ];

  const dialog = document.createElement('dialog');
  dialog.id = 'room-onboarding-dialog';
  dialog.className = 'room-dialog room-onboard-dialog';
  dialog.setAttribute('aria-labelledby', 'room-onboard-title');
  dialog.innerHTML = `<form method="dialog" class="room-onboard-form">
    <div class="room-onboard-head">
      <span class="room-mark">${typeof roomLogo === 'function' ? roomLogo() : ''}</span>
      <div>
        <h2 id="room-onboard-title">${manual ? 'Personalize AP Exam Room' : 'Welcome to AP Exam Room'}</h2>
        <p class="room-onboard-sub">Set up your name and theme — you can change these anytime in Settings.</p>
      </div>
    </div>

    <div class="room-onboard-section">
      <label class="room-onboard-label" for="onboard-name">What should we call you?</label>
      <input type="text" id="onboard-name" class="room-onboard-input" maxlength="40" placeholder="Enter your name (optional)" value="${escapeHtml(draftName)}" autocomplete="name">
      <div class="room-onboard-preview" id="onboard-greeting-preview">${escapeHtml(formatGreetingPreview(draftName))}</div>
    </div>

    <div class="room-onboard-section">
      <span class="room-onboard-label">Choose your appearance</span>
      <div class="room-theme-grid" role="group" aria-label="Appearance theme">
        <button type="button" class="room-theme-card ${draftTheme === 'light' ? 'is-active' : ''}" data-onboard-theme="light" aria-pressed="${draftTheme === 'light'}">
          <div class="room-theme-mock is-light" aria-hidden="true">
            <span class="rtm-bar"></span>
            <span class="rtm-card"><i></i><b></b></span>
          </div>
          <span class="room-theme-card-lbl"><strong>☀ Light</strong><small>Bright paper look</small></span>
        </button>
        <button type="button" class="room-theme-card ${draftTheme === 'dark' ? 'is-active' : ''}" data-onboard-theme="dark" aria-pressed="${draftTheme === 'dark'}">
          <div class="room-theme-mock is-dark" aria-hidden="true">
            <span class="rtm-bar"></span>
            <span class="rtm-card"><i></i><b></b></span>
          </div>
          <span class="room-theme-card-lbl"><strong>☾ Dark</strong><small>Low-glare slate</small></span>
        </button>
      </div>
    </div>

    <div class="room-onboard-section">
      <span class="room-onboard-label">Daily study goal <span class="room-onboard-opt">(optional)</span></span>
      <div class="room-goal-pills" role="group" aria-label="Daily study goal">
        ${goalChoices.map(g => `<button type="button" class="room-goal-pill ${draftGoal === g.val ? 'is-active' : ''}" data-onboard-goal="${g.val}" aria-pressed="${draftGoal === g.val}">${g.label}</button>`).join('')}
      </div>
    </div>

    ${mainSubjects.length ? `<div class="room-onboard-section">
      <span class="room-onboard-label">Focus AP subjects <span class="room-onboard-opt">(pins to top of sidebar)</span></span>
      <div class="room-subj-chips" role="group" aria-label="Focus AP subjects">
        ${mainSubjects.map(s => {
          const active = draftSubjects.has(s.key);
          return `<button type="button" class="room-subj-chip ${active ? 'is-active' : ''}" data-onboard-subj="${escapeHtml(s.key)}" aria-pressed="${active}">
            <img src="Assets/icons/${escapeHtml(s.icon || 'folder.svg')}" alt="" width="16" height="16">
            <span>${escapeHtml(s.zh || s.name)}</span>
          </button>`;
        }).join('')}
      </div>
    </div>` : ''}

    <div class="room-row-actions room-onboard-actions">
      <button type="button" class="btn btn-secondary" data-onboard-skip>${manual ? 'Cancel' : 'Skip for now'}</button>
      <button type="submit" class="btn room-yellow" data-onboard-save>${manual ? 'Save Setup' : 'Start Studying'}</button>
    </div>
  </form>`;

  document.body.appendChild(dialog);

  const nameInput = dialog.querySelector('#onboard-name');
  const previewEl = dialog.querySelector('#onboard-greeting-preview');
  nameInput?.addEventListener('input', () => {
    draftName = nameInput.value;
    if (previewEl) previewEl.textContent = formatGreetingPreview(draftName);
  });

  dialog.addEventListener('click', (e) => {
    const themeBtn = e.target.closest('[data-onboard-theme]');
    if (themeBtn) {
      draftTheme = themeBtn.dataset.onboardTheme === 'dark' ? 'dark' : 'light';
      dialog.querySelectorAll('[data-onboard-theme]').forEach(b => {
        const on = b.dataset.onboardTheme === draftTheme;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      window.roomSetTheme?.(draftTheme, { persist: false });
      return;
    }
    const goalBtn = e.target.closest('[data-onboard-goal]');
    if (goalBtn) {
      draftGoal = Number(goalBtn.dataset.onboardGoal) || 0;
      dialog.querySelectorAll('[data-onboard-goal]').forEach(b => {
        const on = Number(b.dataset.onboardGoal) === draftGoal;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      return;
    }
    const subjBtn = e.target.closest('[data-onboard-subj]');
    if (subjBtn) {
      const k = subjBtn.dataset.onboardSubj;
      if (draftSubjects.has(k)) draftSubjects.delete(k);
      else draftSubjects.add(k);
      const on = draftSubjects.has(k);
      subjBtn.classList.toggle('is-active', on);
      subjBtn.setAttribute('aria-pressed', String(on));
      return;
    }
    if (e.target.closest('[data-onboard-skip]')) {
      if (manual) {
        window.roomSetTheme?.(prevTheme, { persist: false });
        dialog.close('cancel');
      } else {
        try { roomUpdatePreferences({ onboarded: true }); } catch (_) {}
        window.roomSetTheme?.(draftTheme, { persist: true });
        dialog.close('skip');
        if (typeof renderLibrary === 'function') renderLibrary();
      }
    }
  });

  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (manual) {
      window.roomSetTheme?.(prevTheme, { persist: false });
      dialog.close('cancel');
    } else {
      try { roomUpdatePreferences({ onboarded: true }); } catch (_) {}
      window.roomSetTheme?.(draftTheme, { persist: true });
      dialog.close('skip');
      if (typeof renderLibrary === 'function') renderLibrary();
    }
  });

  dialog.querySelector('form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const savedName = String(nameInput?.value || '').trim().slice(0, 40);
    try {
      roomUpdatePreferences({
        userName: savedName,
        dailyGoal: draftGoal,
        focusSubjects: [...draftSubjects],
        onboarded: true,
      });
    } catch (_) {}
    window.roomSetTheme?.(draftTheme, { persist: true });
    dialog.close('save');
    if (typeof renderLibrary === 'function') renderLibrary();
    window.showRoomToast?.(savedName ? `Welcome, ${savedName}!` : 'Workspace ready!');
  });

  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
  setTimeout(() => nameInput?.focus(), 40);
};

function roomSettingsMarkup() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const curTheme = isDark ? 'dark' : 'light';
  const userName = roomUserName();
  const dailyGoal = roomDailyGoal();
  const focusSet = new Set(roomFocusSubjects());
  const mainSubjects = typeof getSubjectsList === 'function' ? getSubjectsList().filter(s => !s.isExtended) : [];
  const goalChoices = [
    { val: 0, label: 'Off' },
    { val: 10, label: '10 Qs/day' },
    { val: 20, label: '20 Qs/day' },
    { val: 30, label: '30 Qs/day' },
    { val: 50, label: '50 Qs/day' },
  ];

  return `<div class="room-settings">
    <h1>Settings</h1>
    <p class="room-settings-intro">Manage your profile, study goals, appearance, clipboard, and test data on this device.</p>

    <section class="room-settings-card">
      <h2>Profile &amp; Study Goals</h2>
      <p>Personalize your dashboard greeting, daily practice target, and pinned AP subjects.</p>
      <div class="room-settings-block">
        <label class="room-settings-subhead" for="room-user-name">Display Name</label>
        <div class="room-settings-name-row">
          <input type="text" id="room-user-name" maxlength="40" placeholder="Enter your name" value="${escapeHtml(userName)}" autocomplete="name">
          <button type="button" class="btn btn-primary" id="room-save-name">Save Name</button>
        </div>
      </div>
      <div class="room-settings-block">
        <span class="room-settings-subhead">Daily Study Goal</span>
        <div class="room-goal-pills" role="group" aria-label="Daily study goal">
          ${goalChoices.map(g => `<button type="button" class="room-goal-pill ${dailyGoal === g.val ? 'is-active' : ''}" data-setting-goal="${g.val}" aria-pressed="${dailyGoal === g.val}">${g.label}</button>`).join('')}
        </div>
      </div>
      ${mainSubjects.length ? `<div class="room-settings-block">
        <span class="room-settings-subhead">My AP Subjects</span>
        <p class="room-settings-hint">Selected subjects are pinned to the top of the sidebar and Stats page.</p>
        <div class="room-subj-chips" role="group" aria-label="My AP Subjects">
          ${mainSubjects.map(s => {
            const active = focusSet.has(s.key);
            return `<button type="button" class="room-subj-chip ${active ? 'is-active' : ''}" data-setting-subj="${escapeHtml(s.key)}" aria-pressed="${active}">
              <img src="Assets/icons/${escapeHtml(s.icon || 'folder.svg')}" alt="" width="16" height="16">
              <span>${escapeHtml(s.zh || s.name)}</span>
            </button>`;
          }).join('')}
        </div>
      </div>` : ''}
      <div class="room-row-actions">
        <button type="button" class="btn btn-secondary" id="room-reopen-onboarding">Run Welcome Setup</button>
      </div>
    </section>

    <section class="room-settings-card">
      <h2>Appearance</h2>
      <div class="room-settings-block">
        <span class="room-settings-subhead">Theme</span>
        <div class="room-theme-grid" role="group" aria-label="Theme selection">
          <button type="button" class="room-theme-card ${curTheme === 'light' ? 'is-active' : ''}" data-theme-pick="light" aria-pressed="${curTheme === 'light'}">
            <div class="room-theme-mock is-light" aria-hidden="true">
              <span class="rtm-bar"></span>
              <span class="rtm-card"><i></i><b></b></span>
            </div>
            <span class="room-theme-card-lbl"><strong>☀ Light</strong><small>Bright paper look</small></span>
          </button>
          <button type="button" class="room-theme-card ${curTheme === 'dark' ? 'is-active' : ''}" data-theme-pick="dark" aria-pressed="${curTheme === 'dark'}">
            <div class="room-theme-mock is-dark" aria-hidden="true">
              <span class="rtm-bar"></span>
              <span class="rtm-card"><i></i><b></b></span>
            </div>
            <span class="room-theme-card-lbl"><strong>☾ Dark</strong><small>Low-glare slate</small></span>
          </button>
        </div>
      </div>
      <label class="room-setting-toggle">
        <span><strong>Show cursor pets</strong><small>Felipe, Alfred, Iggy, and Todd follow your cursor on the Question Bank. The pets stay still when your device is set to reduce motion.</small></span>
        <input type="checkbox" id="room-show-pets" role="switch" ${roomPetsAllowed()?'checked':''}>
      </label>
    </section>
    <section class="room-settings-card">
      <h2>Clipboard</h2>
      <label class="room-setting-toggle">
        <span><strong>Allow copying question content</strong><small>Applies to questions, choices, and explanations. You can always copy your own notes and responses.</small></span>
        <input type="checkbox" id="room-allow-copy" role="switch" ${roomCopyAllowed()?'checked':''}>
      </label>
    </section>
    <section class="room-settings-card">
      <h2>Backup and Restore</h2>
      <p>Save your test history, progress, imported tests, and preferences to a JSON file. Keep walkthrough videos in their local folder.</p>
      <div class="room-row-actions">
        <button type="button" class="btn room-yellow" id="room-backup-save">${roomIcon('import')} Download Backup</button>
        <button type="button" class="btn btn-secondary" id="room-backup-restore">Restore from Backup</button>
        <input type="file" id="room-backup-file" accept=".json,application/json" hidden>
      </div>
    </section>
    <section class="room-settings-card room-settings-delete">
      <h2>Delete Data</h2>
      <p>Choose which local data to clear. You can download a backup first if you might need it later.</p>
      <button type="button" class="btn room-delete-button" id="room-delete-open">Choose Data to Delete</button>
    </section>
    <p class="room-settings-status" role="status" aria-live="polite"></p>
  </div>`;
}

document.addEventListener('copy', event => {
  if (roomCopyAllowed() || event.target.closest?.('input, textarea, [contenteditable="true"]')) return;
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const content = document.querySelectorAll('.stem-pane, .question-combined, .question-prompt, .option-card, .result-content, .room-question-preview, .room-preview-list, .room-answer-explanation, .highlight-note-dialog blockquote');
  if ([...content].some(element => range.intersectsNode(element))) event.preventDefault();
}, true);

function showRoomSettingsStatus(message, error = false) {
  const status = document.querySelector('.room-settings-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

function roomSettingsDialog(title, contents, accept, danger = false) {
  const dialog = document.createElement('dialog');
  dialog.className = 'room-dialog room-data-dialog';
  dialog.setAttribute('aria-labelledby', 'room-data-title');
  dialog.innerHTML = `<form method="dialog">
    <h2 id="room-data-title">${title}</h2>${contents}
    <p class="room-data-status" role="alert"></p>
    <div class="room-row-actions">
      <button type="button" data-room-cancel class="btn btn-secondary" autofocus>Cancel</button>
      <button class="btn ${danger?'room-delete-button':'btn-primary'}">${accept}</button>
    </div>
  </form>`;
  document.body.append(dialog);
  dialog.querySelector('[data-room-cancel]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove(), {once:true});
  dialog.showModal();
  return dialog;
}

function roomSavedTests() {
  return Object.fromEntries(Object.keys(EXAMS).flatMap(id => {
    const snapshot = readLibrary(getStorageKey(id), {});
    return snapshot.phase && snapshot.phase!=='intro' ? [[id,snapshot]] : [];
  }));
}

function saveRoomBackup() {
  const attempts = allAttempts().filter(a => Object.hasOwn(EXAMS,a.examId) && a.state);
  const prefs = roomGetPreferences();
  const data = JSON.stringify({
    format:roomBackupFormat, version:1, createdAt:new Date().toISOString(),
    preferences:{
      allowCopy:roomCopyAllowed(),
      showPets:roomPetsAllowed(),
      userName:roomUserName(),
      dailyGoal:roomDailyGoal(),
      focusSubjects:roomFocusSubjects(),
      onboarded:Boolean(prefs.onboarded),
      theme:document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
    },
    imports:Object.values(readLibrary(libraryImportKey,{})),
    attempts, savedTests:roomSavedTests()
  });
  const native = window.webkit?.messageHandlers?.roomBackup;
  if (native) { native.postMessage(data); return; }
  const url = URL.createObjectURL(new Blob([data],{type:'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'AP Exam Room Backup '+new Date().toISOString().slice(0,10)+'.json';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  showRoomSettingsStatus('Backup download started.');
}

function parseRoomBackup(data) {
  const isRecord = value => value && typeof value==='object' && !Array.isArray(value);
  if (data?.format!==roomBackupFormat || data.version!==1 || !Array.isArray(data.imports) ||
      !Array.isArray(data.attempts) || !isRecord(data.savedTests) || typeof data.preferences?.allowCopy!=='boolean') {
    throw Error('Choose an AP Exam Room backup file.');
  }
  const imports = data.imports.length ? normalizeImport(data.imports,true) : [];
  const currentImports = readLibrary(libraryImportKey,{});
  for (const ex of imports) {
    if (Object.hasOwn(EXAMS,ex.id) && (!Object.hasOwn(currentImports,ex.id) ||
        JSON.stringify(normalizeImport(currentImports[ex.id],true)[0])!==JSON.stringify(ex))) {
      throw Error(`The backup contains a different version of “${ex.title}” with the same test ID.`);
    }
  }
  const bank = {...EXAMS,...Object.fromEntries(imports.map(ex=>[ex.id,ex]))};
  function checkSnapshot(id, snapshot) {
    if (!Object.hasOwn(bank,id) || !isRecord(snapshot) || snapshot.examId!==id ||
        !['mcq_exam','mcq_check','frq_exam','frq_check','break','complete','results'].includes(snapshot.phase)) {
      throw Error('The backup contains an invalid or unavailable saved test.');
    }
    for (const [section, questions] of [['mcq',bank[id].questions], ['frq',bank[id].frqQuestions]]) {
      const sec = snapshot[section];
      const ids = new Set(questions.map(q=>q.origId));
      if (!isRecord(sec) || !Array.isArray(sec.order) || !sec.order.every(n=>ids.has(n)) ||
          new Set(sec.order).size!==sec.order.length || !Number.isInteger(sec.currentIndex) ||
          sec.currentIndex<0 || sec.currentIndex>=Math.max(sec.order.length,1) ||
          ![sec.marks,sec.notes,sec.highlights].every(isRecord)) {
        throw Error('The backup contains an invalid response sheet.');
      }
      const entries = section==='mcq' ? sec.answers : sec.responses ?? {};
      if (!isRecord(entries) || !Object.entries(entries).every(([n,v])=>ids.has(Number(n)) &&
          typeof v==='string' && (section==='frq' || /^[A-Z]$/.test(v))) ||
          (section==='mcq' && ![sec.eliminationMode,sec.eliminated].every(isRecord)) ||
          !Object.values(sec.highlights).every(items=>Array.isArray(items) && items.every(isRecord))) {
        throw Error('The backup contains invalid answers or annotations.');
      }
    }
    if (snapshot.roomSettings?.scoreIds!=null && !Array.isArray(snapshot.roomSettings.scoreIds)) {
      throw Error('The backup contains an invalid scoring range.');
    }
    return bank[id];
  }
  const attempts = data.attempts.map(row => {
    const ex = checkSnapshot(row?.examId,row?.state);
    if (!isCompletedRoomState(row.state) || row.time!==row.state.completionShownAt) throw Error('The backup contains an invalid completed attempt.');
    return attemptFrom(ex,row.state);
  });
  for (const [id,snapshot] of Object.entries(data.savedTests)) checkSnapshot(id,snapshot);
  return {...data,imports,attempts};
}

function restoreRoomBackup(backup) {
  const imports = readLibrary(libraryImportKey,{});
  const newImports = backup.imports.filter(ex=>!Object.hasOwn(imports,ex.id));
  const mergedImports = {...imports,...Object.fromEntries(newImports.map(ex=>[ex.id,ex]))};
  const existing = new Set(allAttempts().map(a=>a.examId+':'+a.time));
  const added = backup.attempts.filter(a=>{
    const key=a.examId+':'+a.time;
    if (existing.has(key)) return false;
    existing.add(key);
    return true;
  });
  const bp = backup.preferences || {};
  const updates = new Map([
    [roomPreferencesKey, {
      ...roomGetPreferences(),
      allowCopy:bp.allowCopy,
      showPets:typeof bp.showPets==='boolean' ? bp.showPets : roomPetsAllowed(),
      userName:typeof bp.userName==='string' ? bp.userName.trim().slice(0, 40) : roomUserName(),
      dailyGoal:bp.dailyGoal !== undefined ? bp.dailyGoal : roomDailyGoal(),
      focusSubjects:Array.isArray(bp.focusSubjects) ? bp.focusSubjects : roomFocusSubjects(),
      onboarded:typeof bp.onboarded==='boolean' ? bp.onboarded : Boolean(roomGetPreferences().onboarded || bp.userName || added.length)
    }]
  ]);
  if (bp.theme === 'dark' || bp.theme === 'light') {
    updates.set('room_theme_v1', bp.theme);
  }
  if (newImports.length) updates.set(libraryImportKey,mergedImports);
  if (added.length) updates.set(libraryHistoryKey,[...readLibrary(libraryHistoryKey,[]),...added]);
  for (const [id,snapshot] of Object.entries(backup.savedTests)) {
    const key=getStorageKey(id);
    const existingPhase=readLibrary(key,{}).phase;
    if (!existingPhase || existingPhase==='intro') updates.set(key,snapshot);
  }
  const previous = [];
  try {
    for (const [key,value] of updates) {
      previous.push([key,localStorage.getItem(key)]);
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
  } catch {
    // Free the space used by this import before restoring the previous values.
    for (const [key] of previous) localStorage.removeItem(key);
    for (const [key,value] of previous) if (value!==null) localStorage.setItem(key,value);
    throw Error('There is not enough local storage to restore this backup.');
  }
  if (bp.theme === 'dark' || bp.theme === 'light') window.roomSetTheme?.(bp.theme, { persist: false });
  Object.assign(EXAMS,mergedImports);
  saveHistoryRows(added);
  return `Backup restored. ${added.length} new completed attempts and ${newImports.length} new imported tests.`;
}

function deleteRoomData() {
  const dialog = roomSettingsDialog('Delete Local Data',`<p>Choose what to remove from this device.</p>
    <fieldset class="room-delete-options"><legend>Data to delete</legend>
    ${Object.entries(roomDeleteOptions).map(([key,[title,description]])=>`<label><input type="checkbox" name="delete" value="${key}"><span><strong>${title}</strong><small>${description}</small></span></label>`).join('')}
    </fieldset>`, 'Review Deletion');
  const form = dialog.querySelector('form');
  const review = form.querySelector('button:not([data-room-cancel])');
  review.disabled = true;
  form.addEventListener('change',()=>{ review.disabled = !form.querySelector('input:checked'); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const selected = new FormData(form).getAll('delete');
    if (!selected.length) return;
    dialog.close();
    const confirm = roomSettingsDialog('Permanently Delete Data?',`<p>This will remove the following data from this device.</p>
      <ul>${selected.map(key=>`<li>${roomDeleteOptions[key][0]}</li>`).join('')}</ul>
      <p>Use a backup to recover deleted data.</p>`, 'Delete Permanently', true);
    confirm.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      if (pendingRoomDeletion) return;
      const importedIds = selected.includes('imports') ? Object.keys(readLibrary(libraryImportKey,{})) : [];
      pendingRoomDeletion = {selected, importedIds, dialog:confirm};
      const native = window.webkit?.messageHandlers?.roomDeleteHistory;
      if (native && (selected.includes('history') || importedIds.length)) {
        confirm.querySelectorAll('button').forEach(button=>{button.disabled=true;});
        confirm.addEventListener('cancel', e=>{ if (pendingRoomDeletion) e.preventDefault(); });
        native.postMessage({all:selected.includes('history'), exams:importedIds});
      } else {
        finishRoomDeletion(true);
      }
    });
  });
}

let pendingRoomDeletion = null;
function finishRoomDeletion(ok) {
  if (!pendingRoomDeletion) return;
  const {selected, importedIds, dialog} = pendingRoomDeletion;
  pendingRoomDeletion = null;
  if (!ok) {
    dialog.querySelector('.room-data-status').textContent='The history database could not be updated. Your data is still available.';
    dialog.querySelector('[data-room-cancel]').disabled=false;
    return;
  }
  const removeHistory = selected.includes('history');
  const removeProgress = selected.includes('progress');
  const keepHistory = row => !removeHistory && !importedIds.includes(row.examId);
  if (removeHistory || importedIds.length) {
    const rows = readLibrary(libraryHistoryKey,[]).filter(keepHistory);
    if (rows.length) localStorage.setItem(libraryHistoryKey,JSON.stringify(rows));
    else localStorage.removeItem(libraryHistoryKey);
    databaseAttempts = databaseAttempts.filter(keepHistory);
  }
  for (const [id,snapshot] of Object.entries(roomSavedTests())) {
    if (importedIds.includes(id) || (['complete','results'].includes(snapshot.phase) ? removeHistory : removeProgress)) {
      localStorage.removeItem(getStorageKey(id));
    }
  }
  if (selected.includes('mistakes')) {
    localStorage.removeItem(libraryMistakesKey);
  }
  if (selected.includes('imports')) {
    localStorage.removeItem(libraryImportKey);
    for (const id of importedIds) {
      delete EXAMS[id];
      localStorage.removeItem(getStorageKey(id));
    }
    if (importedIds.includes(currentExamId)) {
      currentExamId='stats_001';
      localStorage.removeItem('bluebook_suite_active_exam');
    }
  }
  if (selected.includes('profile')) {
    localStorage.removeItem(roomPreferencesKey);
    localStorage.removeItem('room_theme_v1');
    onboardingChecked = false;
    window.roomInitTheme?.();
  }
  if (!window.webkit?.messageHandlers?.roomDeleteHistory && location.protocol.startsWith('http')) {
    fetch('/sync/clear-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clearHistory: removeHistory,
        clearProgress: removeProgress,
        clearMistakes: selected.includes('mistakes'),
        clearImports: selected.includes('imports'),
        clearProfile: selected.includes('profile'),
        importedIds,
      }),
    }).catch(() => {});
  }
  state=emptyState();
  dialog.close();
  if (typeof renderLibrary === 'function') renderLibrary();
  showRoomSettingsStatus('The selected data was deleted.');
}

document.addEventListener('click', event => {
  const btn = event.target.closest('button');
  if (!btn) return;
  const id = btn.id;
  if (id==='room-backup-save') saveRoomBackup();
  if (id==='room-backup-restore') document.getElementById('room-backup-file').click();
  if (id==='room-delete-open') deleteRoomData();
  if (id==='room-reopen-onboarding') window.openRoomOnboarding?.({ manual: true });
  if (id==='room-save-name') {
    const inp = document.getElementById('room-user-name');
    const name = String(inp?.value || '').trim().slice(0, 40);
    roomUpdatePreferences({ userName: name, onboarded: true });
    window.showRoomToast?.(name ? `Saved name: ${name}` : 'Display name cleared');
    showRoomSettingsStatus(name ? `Display name saved as “${name}”.` : 'Display name cleared.');
    return;
  }
  if (btn.dataset.themePick) {
    const theme = btn.dataset.themePick === 'dark' ? 'dark' : 'light';
    window.roomSetTheme?.(theme, { persist: true });
    showRoomSettingsStatus(`Switched to ${theme === 'dark' ? 'Dark' : 'Light'} mode.`);
    return;
  }
  if (btn.dataset.settingGoal !== undefined) {
    const goal = Number(btn.dataset.settingGoal) || 0;
    roomUpdatePreferences({ dailyGoal: goal, onboarded: true });
    document.querySelectorAll('[data-setting-goal]').forEach(b => {
      const on = Number(b.dataset.settingGoal) === goal;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    showRoomSettingsStatus(goal ? `Daily goal set to ${goal} questions.` : 'Daily study goal turned off.');
    return;
  }
  if (btn.dataset.settingSubj) {
    const key = btn.dataset.settingSubj;
    const set = new Set(roomFocusSubjects());
    if (set.has(key)) set.delete(key);
    else set.add(key);
    const list = [...set];
    roomUpdatePreferences({ focusSubjects: list, onboarded: true });
    btn.classList.toggle('is-active', set.has(key));
    btn.setAttribute('aria-pressed', String(set.has(key)));
    showRoomSettingsStatus(list.length ? `Pinned ${list.length} focus subject${list.length === 1 ? '' : 's'}.` : 'Cleared pinned focus subjects.');
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target?.id === 'room-user-name') {
    event.preventDefault();
    document.getElementById('room-save-name')?.click();
  }
});

document.addEventListener('change', async event => {
  const input = event.target;
  if (input.id==='room-allow-copy' || input.id==='room-show-pets') {
    const copyToggle = input.id==='room-allow-copy';
    const key = copyToggle ? 'allowCopy' : 'showPets';
    try {
      const preferences = readLibrary(roomPreferencesKey,{});
      localStorage.setItem(roomPreferencesKey,JSON.stringify({...preferences,[key]:input.checked}));
      showRoomSettingsStatus(copyToggle ? 'Clipboard preference saved.' : 'Pet preference saved.');
    } catch {
      input.checked = copyToggle ? roomCopyAllowed() : roomPetsAllowed();
      showRoomSettingsStatus('The preference could not be saved.',true);
    }
  }
  if (input.id!=='room-backup-file' || !input.files[0]) return;
  const file = input.files[0];
  input.value='';
  try {
    const backup = parseRoomBackup(JSON.parse(await file.text()));
    if (libraryView!=='settings') return;
    const dialog = roomSettingsDialog('Restore Backup',`<p>This backup contains ${backup.attempts.length} completed attempts, ${Object.keys(backup.savedTests).length} saved tests, and ${backup.imports.length} imported tests.</p>
      <p>Restore merges in missing records, keeps current saved tests, and applies the backup’s clipboard preference. The original timers still apply to restored tests.</p>`, 'Restore Backup');
    dialog.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      try {
        const message = restoreRoomBackup(backup);
        dialog.close();
        renderLibrary();
        showRoomSettingsStatus(message);
      } catch (error) {
        dialog.querySelector('.room-data-status').textContent=error.message;
      }
    });
  } catch (error) {
    showRoomSettingsStatus(error instanceof SyntaxError ? 'This file is not valid JSON.' : error.message,true);
  }
});
