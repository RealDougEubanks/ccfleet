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
  lastRefreshed: document.getElementById('last-refreshed'),
  btnReload: document.getElementById('btn-reload'),
  btnRestartCcfleet: document.getElementById('btn-restart-ccfleet'),
  btnRestartTtyd: document.getElementById('btn-restart-ttyd'),
  ttydRow: document.getElementById('ttyd-row'),
  statCpu: document.getElementById('stat-cpu'),
  statMem: document.getElementById('stat-mem'),
  statDisk: document.getElementById('stat-disk'),
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
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
    el.statMem.className = `stat ${statLevel(r.mem.pct)}`;
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

  el.active.innerHTML = '';
  if (state.sessions.length === 0) {
    el.activeEmpty.hidden = false;
  } else {
    el.activeEmpty.hidden = true;
    for (const s of state.sessions) {
      el.active.appendChild(renderSessionCard(s));
    }
  }

  const available = state.projects.filter((p) => !activeNames.has(p.session_name));
  el.available.innerHTML = '';
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
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="card-header">
      <span class="project-name">${escapeHtml(s.project_name)}</span>
      <span class="badge ${escapeHtml(s.status)}">${escapeHtml(s.status)}</span>
    </div>
    <div class="card-meta">started ${escapeHtml(timeSince(s.started_at))} · ${escapeHtml(s.current_command || 'unknown')}</div>
    <div class="card-actions">
      <button class="primary" data-action="open">Open</button>
      <button data-action="attach" ${state.config.ttyd_url ? '' : 'disabled'}>Attach</button>
      <button class="danger" data-action="kill">Kill</button>
    </div>
  `;
  card.querySelector('[data-action="open"]').addEventListener('click', () => {
    window.open(state.config.remote_control_url, '_blank', 'noopener');
  });
  card.querySelector('[data-action="attach"]').addEventListener('click', () => {
    if (state.config.ttyd_url) window.open(state.config.ttyd_url, '_blank', 'noopener');
  });
  card.querySelector('[data-action="kill"]').addEventListener('click', () => killSession(s));
  return card;
}

function renderProjectRow(p) {
  const li = document.createElement('li');
  li.className = 'row';
  li.innerHTML = `
    <span class="project-name">${escapeHtml(p.name)}</span>
    <button class="primary" data-action="start">Start session</button>
  `;
  const btn = li.querySelector('[data-action="start"]');
  btn.addEventListener('click', () => startSession(p, btn));
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

el.refresh.addEventListener('click', refresh);

el.btnReload.addEventListener('click', () =>
  systemAction('/api/system/reload', el.btnReload, 'Config reloaded'),
);

el.btnRestartCcfleet.addEventListener('click', () =>
  systemAction('/api/system/restart', el.btnRestartCcfleet, 'Restarting — page will reload…', { reload: 2500 }),
);

el.btnRestartTtyd.addEventListener('click', () =>
  systemAction('/api/system/ttyd/restart', el.btnRestartTtyd, 'ttyd restarting'),
);

(async function init() {
  await loadConfig();
  await Promise.all([refresh(), refreshResources()]);
  setInterval(refresh, POLL_MS);
})();
