'use strict';

const POLL_MS = 5000;

const state = {
  config: { remote_control_url: '', ttyd_url: '' },
  projects: [],
  sessions: [],
};

const el = {
  active: document.getElementById('active-sessions'),
  activeEmpty: document.getElementById('active-empty'),
  available: document.getElementById('available-projects'),
  availableEmpty: document.getElementById('available-empty'),
  refresh: document.getElementById('refresh'),
  toast: document.getElementById('toast'),
  confirm: document.getElementById('confirm-dialog'),
  confirmText: document.getElementById('confirm-text'),
  confirmOk: document.getElementById('confirm-ok'),
  lastRefreshed: document.getElementById('last-refreshed'),
  btnReload: document.getElementById('btn-reload'),
  btnRestartCcfleet: document.getElementById('btn-restart-ccfleet'),
  btnRestartTtyd: document.getElementById('btn-restart-ttyd'),
  ttydRow: document.getElementById('ttyd-row'),
  envDialog: document.getElementById('env-dialog'),
  envDialogTitle: document.getElementById('env-dialog-title'),
  envContent: document.getElementById('env-content'),
  envSave: document.getElementById('env-save'),
  envReload: document.getElementById('env-reload'),
  envCancel: document.getElementById('env-cancel'),
  statCpu: document.getElementById('stat-cpu'),
  statMem: document.getElementById('stat-mem'),
  statDisk: document.getElementById('stat-disk'),
};

function elem(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function timeSince(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function showToast(msg, kind) {
  el.toast.textContent = msg;
  el.toast.className = 'toast' + (kind === 'error' ? ' error' : '');
  el.toast.hidden = false;
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => { el.toast.hidden = true; }, 3500);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `request failed (${res.status})`);
  }
  return body;
}

async function loadConfig() {
  try {
    state.config = await api('/api/config');
    el.ttydRow.hidden = !state.config.ttyd_url;
  } catch (err) {
    showToast(`config: ${err.message}`, 'error');
  }
}

async function systemAction(endpoint, btn, successMsg, opts = {}) {
  btn.disabled = true;
  try {
    await api(endpoint, { method: 'POST' });
    showToast(successMsg);
    if (opts.reload) setTimeout(() => window.location.reload(), opts.reload);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (!opts.reload) btn.disabled = false;
  }
}

function statLevel(pct) {
  if (pct >= 90) return 'crit';
  if (pct >= 70) return 'warn';
  return 'ok';
}

function memLevel(mem) {
  // On macOS, use the kernel pressure signal; on Linux use percentage thresholds.
  if (mem.pressure !== null && mem.pressure !== undefined) {
    if (mem.pressure >= 2) return 'crit';
    if (mem.pressure >= 1) return 'warn';
    return 'ok';
  }
  return statLevel(mem.pct);
}

function fmtBytes(bytes) {
  const gb = bytes / (1024 ** 3);
  return gb >= 1 ? `${gb.toFixed(1)}GB` : `${(bytes / (1024 ** 2)).toFixed(0)}MB`;
}

async function refreshResources() {
  try {
    const r = await api('/api/system/resources');
    el.statCpu.textContent = `CPU ${r.cpu.pct}%`;
    el.statCpu.className = `stat ${statLevel(r.cpu.pct)}`;
    el.statMem.textContent = `RAM ${fmtBytes(r.mem.used)}/${fmtBytes(r.mem.total)}`;
    el.statMem.className = `stat ${memLevel(r.mem)}`;
    el.statDisk.textContent = `Disk ${fmtBytes(r.disk.used)}/${fmtBytes(r.disk.total)}`;
    el.statDisk.className = `stat ${statLevel(r.disk.pct)}`;
  } catch {
    // non-fatal: leave previous values in place
  }
}

async function refresh() {
  try {
    const [projects, sessions] = await Promise.all([
      api('/api/projects'),
      api('/api/sessions'),
    ]);
    state.projects = projects.projects || [];
    state.sessions = sessions.sessions || [];
    render();
    el.lastRefreshed.textContent = `last refreshed ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    showToast(err.message, 'error');
  }
  refreshResources();
}

function render() {
  const activeNames = new Set(state.sessions.map((s) => s.session_name));

  el.active.replaceChildren();
  if (state.sessions.length === 0) {
    el.activeEmpty.hidden = false;
  } else {
    el.activeEmpty.hidden = true;
    for (const s of state.sessions) {
      el.active.appendChild(renderSessionCard(s));
    }
  }

  const available = state.projects.filter((p) => !activeNames.has(p.session_name));
  el.available.replaceChildren();
  if (available.length === 0) {
    el.availableEmpty.textContent = state.projects.length > 0
      ? 'All projects have active sessions.'
      : 'No projects found in GIT_ROOT.';
    el.availableEmpty.hidden = false;
  } else {
    el.availableEmpty.hidden = true;
    for (const p of available) {
      el.available.appendChild(renderProjectRow(p));
    }
  }
}

function renderSessionCard(s) {
  const header = elem('div', 'card-header');
  header.append(
    elem('span', 'project-name', s.project_name),
    elem('span', `badge ${s.status}`, s.status),
  );

  const meta = elem(
    'div',
    'card-meta',
    `started ${timeSince(s.started_at)} · ${s.current_command || 'unknown'}`,
  );

  const openBtn = elem('button', 'primary', 'Open');
  openBtn.addEventListener('click', () => {
    const u = state.config.remote_control_url;
    if (/^https?:\/\//i.test(u)) window.open(u, '_blank', 'noopener');
  });

  const attachBtn = elem('button', null, 'Attach');
  attachBtn.disabled = !state.config.ttyd_url;
  attachBtn.addEventListener('click', () => {
    if (!state.config.ttyd_url) return;
    const url = new URL(state.config.ttyd_url);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      url.hostname = window.location.hostname;
    }
    if (/^https?:$/i.test(url.protocol)) window.open(url.toString(), '_blank', 'noopener');
  });

  const envBtn = elem('button', null, '.env');
  envBtn.addEventListener('click', () => openEnvEditor(s.project_name));

  const killBtn = elem('button', 'danger', 'Kill');
  killBtn.addEventListener('click', () => killSession(s));

  const actions = elem('div', 'card-actions');
  actions.append(openBtn, attachBtn, envBtn, killBtn);

  const card = elem('div', 'card');
  card.append(header, meta, actions);
  return card;
}

function renderProjectRow(p) {
  const envBtn = elem('button', null, '.env');
  envBtn.addEventListener('click', () => openEnvEditor(p.name));

  const startBtn = elem('button', 'primary', 'Start session');
  startBtn.addEventListener('click', () => startSession(p, startBtn));

  const actions = elem('div', 'row-actions');
  actions.append(envBtn, startBtn);

  const li = elem('li', 'row');
  li.append(elem('span', 'project-name', p.name), actions);
  return li;
}

async function startSession(project, btn) {
  btn.disabled = true;
  btn.textContent = 'Starting…';
  try {
    await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ project_name: project.name }),
    });
    showToast(`started ${project.name}`);
    await refresh();
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Start session';
  }
}

async function killSession(session) {
  el.confirmText.textContent = `Kill session "${session.project_name}"?`;
  el.confirmOk.textContent = 'Kill';
  el.confirm.showModal();
  el.confirm.addEventListener('close', async function handler() {
    el.confirm.removeEventListener('close', handler);
    if (el.confirm.returnValue !== 'confirm') return;
    try {
      await api(`/api/sessions/${encodeURIComponent(session.session_name)}`, { method: 'DELETE' });
      showToast(`killed ${session.project_name}`);
      await refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

let envEditorProject = null;

async function openEnvEditor(projectName) {
  envEditorProject = projectName;
  el.envDialogTitle.textContent = `${projectName} / .env`;
  el.envContent.value = '';
  el.envContent.disabled = true;
  el.envSave.disabled = true;
  el.envReload.disabled = true;
  el.envReload.hidden = !state.sessions.some((s) => s.project_name === projectName);
  el.envDialog.showModal();
  try {
    const data = await api(`/api/projects/${encodeURIComponent(projectName)}/env`);
    el.envContent.value = data.content;
    el.envContent.disabled = false;
    el.envSave.disabled = false;
    el.envReload.disabled = false;
  } catch (err) {
    showToast(err.message, 'error');
    el.envDialog.close();
  }
}

el.envCancel.addEventListener('click', () => el.envDialog.close());
el.envDialog.addEventListener('close', () => { envEditorProject = null; });

el.envSave.addEventListener('click', async () => {
  if (!envEditorProject) return;
  el.envSave.disabled = true;
  el.envReload.disabled = true;
  try {
    await api(`/api/projects/${encodeURIComponent(envEditorProject)}/env`, {
      method: 'PUT',
      body: JSON.stringify({ content: el.envContent.value }),
    });
    showToast(`.env saved for ${envEditorProject}`);
    el.envDialog.close();
  } catch (err) {
    showToast(err.message, 'error');
    el.envSave.disabled = false;
    el.envReload.disabled = false;
  }
});

el.envReload.addEventListener('click', async () => {
  if (!envEditorProject) return;
  el.envSave.disabled = true;
  el.envReload.disabled = true;
  try {
    await api(`/api/projects/${encodeURIComponent(envEditorProject)}/env`, {
      method: 'PUT',
      body: JSON.stringify({ content: el.envContent.value }),
    });
  } catch (saveErr) {
    showToast(`Save failed: ${saveErr.message}`, 'error');
    el.envSave.disabled = false;
    el.envReload.disabled = false;
    return;
  }
  // .env saved — now reload the session. Close the dialog regardless; the
  // save succeeded and re-enabling the form would let the user overwrite again.
  el.envDialog.close();
  try {
    await api(`/api/projects/${encodeURIComponent(envEditorProject)}/sessions/reload`, {
      method: 'POST',
    });
    showToast(`Saved and reloaded ${envEditorProject}`);
  } catch (reloadErr) {
    showToast(`.env saved but reload failed: ${reloadErr.message}`, 'error');
  }
});

el.refresh.addEventListener('click', refresh);

el.btnReload.addEventListener('click', () =>
  systemAction('/api/system/reload', el.btnReload, 'Config reloaded'),
);

el.btnRestartCcfleet.addEventListener('click', () => {
  el.confirmText.textContent = 'Restart ccfleet? The process will exit and reload only if a service manager (launchd or systemd) is running. If started manually, the server will go offline.';
  el.confirmOk.textContent = 'Restart';
  el.confirm.showModal();
  el.confirm.addEventListener('close', function handler() {
    el.confirm.removeEventListener('close', handler);
    if (el.confirm.returnValue !== 'confirm') return;
    systemAction('/api/system/restart', el.btnRestartCcfleet, 'Restarting — page will reload…', { reload: 2500 });
  });
});

el.btnRestartTtyd.addEventListener('click', () =>
  systemAction('/api/system/ttyd/restart', el.btnRestartTtyd, 'ttyd restarting'),
);

(async function init() {
  await loadConfig();
  await Promise.all([refresh(), refreshResources()]);
  setInterval(refresh, POLL_MS);
})();
