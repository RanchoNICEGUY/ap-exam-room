const roomPreferencesKey = 'ap-room-preferences-v1';
const roomBackupFormat = 'ap-exam-room-backup';
const roomDeleteOptions = {
  history: ['Completed attempts', 'Deletes scores, responses, and reviews from Test History.'],
  progress: ['In-progress tests', 'Deletes saved answers, notes, and timers for tests you have not submitted.'],
  imports: ['Imported tests', 'Removes your imported tests and any attempts or saved progress for those tests.']
};

function roomCopyAllowed() {
  return readLibrary(roomPreferencesKey, {}).allowCopy !== false;
}

function roomPetsAllowed() {
  return readLibrary(roomPreferencesKey, {}).showPets !== false;
}

function roomSettingsMarkup() {
  return `<div class="room-settings">
    <h1>Settings</h1>
    <p class="room-settings-intro">Manage your display, clipboard, and test data on this device.</p>
    <section class="room-settings-card">
      <h2>Appearance</h2>
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
  const data = JSON.stringify({
    format:roomBackupFormat, version:1, createdAt:new Date().toISOString(),
    preferences:{allowCopy:roomCopyAllowed(),showPets:roomPetsAllowed()}, imports:Object.values(readLibrary(libraryImportKey,{})),
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
  const updates = new Map([
    [roomPreferencesKey, {
      allowCopy:backup.preferences.allowCopy,
      showPets:typeof backup.preferences.showPets==='boolean' ? backup.preferences.showPets : roomPetsAllowed()
    }]
  ]);
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
      localStorage.setItem(key,JSON.stringify(value));
    }
  } catch {
    // Free the space used by this import before restoring the previous values.
    for (const [key] of previous) localStorage.removeItem(key);
    for (const [key,value] of previous) if (value!==null) localStorage.setItem(key,value);
    throw Error('There is not enough local storage to restore this backup.');
  }
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
  state=emptyState();
  dialog.close();
  showRoomSettingsStatus('The selected data was deleted.');
}

document.addEventListener('click', event => {
  const id = event.target.closest('button')?.id;
  if (id==='room-backup-save') saveRoomBackup();
  if (id==='room-backup-restore') document.getElementById('room-backup-file').click();
  if (id==='room-delete-open') deleteRoomData();
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
