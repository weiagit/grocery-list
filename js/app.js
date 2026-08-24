// ── Family Grocery List — app.js ──────────────────────────────────────────
import * as db from './db.js';

// ── State ─────────────────────────────────────────────────────────────────
let items          = [];
let activity       = [];
let familyId       = null;
let familyName     = 'Family Groceries';
let familyJoinCode = null;
let userRole       = 'member';
let displayName    = '';
let searchQuery    = '';
let editingId      = null;
let deletingId     = null;
let realtimeChannel = null;

// Offline item cache
const CACHE_KEY = 'fgl_items_cache';

// ── Utilities ─────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function relativeTime(ts) {
  const diff = Date.now() - (typeof ts === 'string' ? new Date(ts).getTime() : ts);
  const s = Math.floor(diff / 1000);
  if (s <  60)   return 'just now';
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

function setLoading(btn, loading, label) {
  btn.disabled    = loading;
  btn.textContent = loading ? 'Please wait…' : label;
}

// ── Screen management ─────────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const map = { login: 'screen-login', setup: 'screen-setup', app: 'screen-app' };
  document.getElementById(map[name] || name).classList.add('active');
}

// ── Tab management ────────────────────────────────────────────────────────
function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => {
    const on = t.dataset.tab === tabName;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('hidden',  p.id !== `tab-${tabName}`);
    p.classList.toggle('active', p.id === `tab-${tabName}`);
  });
  if (tabName === 'activity') renderActivity();
  if (tabName === 'settings') populateSettings();
}

// ── Data loading ──────────────────────────────────────────────────────────
async function refreshItems() {
  const { data, error } = await db.loadItems(familyId);
  if (!error && data) {
    items = data;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch {}
  } else {
    // Offline: use cache
    try { items = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'); } catch {}
  }
  renderList();
}

async function refreshActivity() {
  activity = await db.loadActivity(familyId);
}

// ── Realtime ──────────────────────────────────────────────────────────────
function setupRealtime() {
  if (realtimeChannel) realtimeChannel.unsubscribe();
  realtimeChannel = db.subscribeToItems(familyId, () => refreshItems());
}

// ── Grocery CRUD ──────────────────────────────────────────────────────────
async function addItem(itemData) {
  const { data, error } = await db.insertItem(familyId, itemData);
  if (error || !data) return false;
  items.unshift(data);
  renderList();
  db.insertActivity(familyId, '➕', `${displayName} added "${data.name}"`);
  return true;
}

async function togglePurchased(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  const newVal = !item.purchased;
  const { data, error } = await db.updateItem(id, {
    purchased:    newVal,
    purchased_at: newVal ? new Date().toISOString() : null,
  });
  if (error || !data) return;
  const idx = items.findIndex(i => i.id === id);
  if (idx >= 0) items[idx] = data;
  renderList();
  const icon = newVal ? '✅' : '↩️';
  const text = newVal ? `${displayName} marked "${data.name}" as purchased`
                      : `${displayName} unmarked "${data.name}"`;
  db.insertActivity(familyId, icon, text);
}

async function updateItem(id, itemData) {
  if (!itemData.name.trim()) return false;
  const { data, error } = await db.updateItem(id, {
    name:     itemData.name.trim().slice(0, 200),
    quantity: itemData.quantity?.trim().slice(0, 100) || null,
    category: itemData.category?.trim() || null,
    notes:    itemData.notes?.trim().slice(0, 1000) || null,
  });
  if (error || !data) return false;
  const idx = items.findIndex(i => i.id === id);
  if (idx >= 0) items[idx] = data;
  renderList();
  db.insertActivity(familyId, '✏️', `${displayName} edited "${data.name}"`);
  return true;
}

async function deleteItem(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  await db.softDeleteItem(id);
  items = items.filter(i => i.id !== id);
  renderList();
  db.insertActivity(familyId, '🗑️', `${displayName} deleted "${item.name}"`);
}

async function clearPurchased() {
  const count = items.filter(i => i.purchased).length;
  await db.softDeletePurchased(familyId);
  items = items.filter(i => !i.purchased);
  renderList();
  if (count > 0) db.insertActivity(familyId, '🧹', `${displayName} cleared ${count} purchased item${count !== 1 ? 's' : ''}`);
}

async function clearAllItems() {
  const count = items.length;
  await db.softDeleteAll(familyId);
  items = [];
  renderList();
  if (count > 0) db.insertActivity(familyId, '🗑️', `${displayName} cleared the entire list (${count} items)`);
}

// ── Render grocery list ───────────────────────────────────────────────────
function getFilteredItems() {
  if (!searchQuery) return items;
  const q = searchQuery.toLowerCase();
  return items.filter(i =>
    i.name.toLowerCase().includes(q) ||
    (i.notes     && i.notes.toLowerCase().includes(q)) ||
    (i.category  && i.category.toLowerCase().includes(q))
  );
}

function renderList() {
  const container  = document.getElementById('list-content');
  const emptyState = document.getElementById('empty-state');
  const filtered   = getFilteredItems();

  if (filtered.length === 0) {
    container.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  const active    = filtered.filter(i => !i.purchased);
  const purchased = filtered.filter(i => i.purchased);

  const groups = new Map();
  for (const item of active) {
    const cat = item.category || '';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(item);
  }
  const sortedCats = [...groups.keys()].sort((a, b) => {
    if (!a && !b) return 0; if (!a) return 1; if (!b) return -1;
    return a.localeCompare(b);
  });

  let html = '';
  for (const cat of sortedCats) {
    if (cat) html += `<div class="category-section"><div class="category-label">${escapeHtml(cat)}</div>`;
    for (const item of groups.get(cat)) html += renderItemHtml(item);
    if (cat) html += `</div>`;
  }
  if (purchased.length > 0) {
    html += `<div class="purchased-divider">Purchased (${purchased.length})</div>`;
    for (const item of purchased) html += renderItemHtml(item);
  }

  container.innerHTML = html;
  container.querySelectorAll('.item-check').forEach(cb =>
    cb.addEventListener('change', () => togglePurchased(cb.dataset.id))
  );
  container.querySelectorAll('.btn-edit').forEach(btn =>
    btn.addEventListener('click', () => openEditModal(btn.dataset.id))
  );
  container.querySelectorAll('.btn-delete').forEach(btn =>
    btn.addEventListener('click', () => openDeleteModal(btn.dataset.id))
  );
}

function renderItemHtml(item) {
  const checkedAttr    = item.purchased ? 'checked' : '';
  const purchasedClass = item.purchased ? ' purchased' : '';
  const metaParts = [];
  if (item.quantity) metaParts.push(escapeHtml(item.quantity));
  if (item.notes)    metaParts.push(escapeHtml(item.notes));
  const meta = metaParts.length
    ? `<div class="item-meta">${metaParts.map(p => `<span>${p}</span>`).join('')}</div>` : '';
  return `
    <div class="grocery-item${purchasedClass}" data-id="${item.id}">
      <input type="checkbox" class="item-check" data-id="${item.id}" ${checkedAttr}
        aria-label="${escapeHtml(item.purchased ? `Unmark ${item.name}` : `Mark ${item.name} as purchased`)}" />
      <div class="item-body">
        <div class="item-name">${escapeHtml(item.name)}</div>${meta}
      </div>
      <div class="item-actions">
        <button class="icon-btn btn-edit" data-id="${item.id}" aria-label="Edit ${escapeHtml(item.name)}">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="icon-btn btn-delete delete" data-id="${item.id}" aria-label="Delete ${escapeHtml(item.name)}">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>
    </div>`;
}

// ── Activity ──────────────────────────────────────────────────────────────
function renderActivity() {
  const container = document.getElementById('activity-list');
  if (activity.length === 0) {
    container.innerHTML = '<p class="activity-empty">No activity yet.</p>';
    return;
  }
  container.innerHTML = activity.map(a => `
    <div class="activity-item">
      <span class="activity-icon" aria-hidden="true">${escapeHtml(a.icon)}</span>
      <div>
        <div class="activity-text">${escapeHtml(a.text)}</div>
        <div class="activity-time">${relativeTime(a.created_at)}</div>
      </div>
    </div>`).join('');
}

// ── Modals ────────────────────────────────────────────────────────────────
function openEditModal(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  editingId = id;
  document.getElementById('edit-name').value     = item.name;
  document.getElementById('edit-quantity').value  = item.quantity || '';
  document.getElementById('edit-category').value  = item.category || '';
  document.getElementById('edit-notes').value     = item.notes    || '';
  document.getElementById('modal-edit').classList.remove('hidden');
  document.getElementById('edit-name').focus();
}
function closeEditModal()  { editingId  = null; document.getElementById('modal-edit').classList.add('hidden'); }

function openDeleteModal(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  deletingId = id;
  document.getElementById('modal-delete-name').textContent = item.name;
  document.getElementById('modal-delete').classList.remove('hidden');
  document.getElementById('btn-delete-confirm').focus();
}
function closeDeleteModal() { deletingId = null; document.getElementById('modal-delete').classList.add('hidden'); }

// ── Settings ──────────────────────────────────────────────────────────────
function populateSettings() {
  document.getElementById('settings-family-name').value = familyName;
  document.getElementById('settings-new-pw').value  = '';
  document.getElementById('settings-new-pw2').value = '';
  document.getElementById('pw-change-msg').textContent = '';
  document.getElementById('pw-change-msg').className   = 'msg';

  if (familyJoinCode) {
    document.getElementById('join-code-display').textContent = familyJoinCode;
    document.getElementById('join-code-section').classList.remove('hidden');
  }
  loadAndRenderMembers();
}

async function loadAndRenderMembers() {
  const members = await db.getFamilyMembers(familyId);
  const el = document.getElementById('members-list');
  if (!members.length) { el.innerHTML = ''; return; }
  el.innerHTML = members.map(m => `
    <div class="member-item">
      <span class="member-name">${escapeHtml(m.profiles?.display_name || 'Unknown')}</span>
      <span class="member-role ${m.role === 'admin' ? 'role-admin' : 'role-member'}">${m.role}</span>
    </div>`).join('');
}

function exportCsv() {
  const rows = [['Name', 'Quantity', 'Category', 'Notes', 'Purchased', 'Created']];
  for (const item of items) {
    rows.push([item.name, item.quantity || '', item.category || '', item.notes || '',
               item.purchased ? 'Yes' : 'No', new Date(item.created_at).toISOString()]);
  }
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: `grocery-list-${new Date().toISOString().slice(0, 10)}.csv`
  });
  a.click();
  URL.revokeObjectURL(url);
}

// ── Offline banner ────────────────────────────────────────────────────────
function updateOfflineBanner() {
  document.getElementById('offline-banner').classList.toggle('hidden', navigator.onLine);
}

// ── Service Worker ────────────────────────────────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

// ── Load family and show app ──────────────────────────────────────────────
let _loadingApp = false;
async function loadAndShowApp() {
  if (_loadingApp) return;
  _loadingApp = true;
  try {
    const membership = await db.getUserFamily();
    if (!membership) {
      showScreen('setup');
      return;
    }
    familyId       = membership.family_id;
    familyName     = membership.families?.name  || 'Family Groceries';
    familyJoinCode = membership.families?.join_code || null;
    userRole       = membership.role || 'member';

    document.getElementById('family-name-header').textContent = familyName;
    document.title = familyName;

    await Promise.all([refreshItems(), refreshActivity()]);
    setupRealtime();
    showScreen('app');
    updateOfflineBanner();
  } finally {
    _loadingApp = false;
  }
}

// ── Wire up all events ────────────────────────────────────────────────────
function initEvents() {

  // ── Auth mode tabs ──
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.dataset.mode;
      document.getElementById('signin-form').classList.toggle('hidden', mode !== 'signin');
      document.getElementById('signup-form').classList.toggle('hidden', mode !== 'signup');
    });
  });

  // ── Sign in ──
  document.getElementById('signin-form').addEventListener('submit', async e => {
    e.preventDefault();
    const email    = document.getElementById('signin-email').value.trim();
    const password = document.getElementById('signin-password').value;
    const errEl    = document.getElementById('signin-error');
    const btn      = e.target.querySelector('[type="submit"]');
    errEl.textContent = '';
    setLoading(btn, true, 'Sign in');
    const { error } = await db.signIn(email, password);
    setLoading(btn, false, 'Sign in');
    if (error) {
      errEl.textContent = error.message === 'Invalid login credentials'
        ? 'Incorrect email or password.' : error.message;
    }
    // On success, onAuthStateChange fires → loadAndShowApp()
  });

  // ── Sign up: toggle join / create ──
  document.querySelectorAll('[name="family-opt"]').forEach(r => {
    r.addEventListener('change', () => {
      const isCreate = document.querySelector('[name="family-opt"]:checked').value === 'create';
      document.getElementById('signup-join-code').classList.toggle('hidden', isCreate);
      document.getElementById('signup-family-name').classList.toggle('hidden', !isCreate);
    });
  });

  // ── Sign up ──
  document.getElementById('signup-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name      = document.getElementById('signup-name').value.trim();
    const email     = document.getElementById('signup-email').value.trim();
    const password  = document.getElementById('signup-password').value;
    const familyOpt = document.querySelector('[name="family-opt"]:checked').value;
    const joinCode  = document.getElementById('signup-join-code').value.trim();
    const newFam    = document.getElementById('signup-family-name').value.trim();
    const errEl     = document.getElementById('signup-error');
    const btn       = e.target.querySelector('[type="submit"]');

    errEl.style.color = '';
    errEl.textContent = '';
    if (!name)               { errEl.textContent = 'Please enter your name.'; return; }
    if (password.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; return; }
    if (familyOpt === 'join' && !joinCode) { errEl.textContent = 'Please enter the invite code.'; return; }

    setLoading(btn, true, 'Create account');
    const { data: authData, error: authError } = await db.signUp(email, password, name);
    if (authError) {
      setLoading(btn, false, 'Create account');
      errEl.textContent = authError.message;
      return;
    }
    if (!authData.session) {
      setLoading(btn, false, 'Create account');
      errEl.style.color = 'var(--green)';
      errEl.textContent = 'Account created! Check your email to confirm, then sign in.';
      return;
    }

    // Session exists — join or create family
    const { data: famData } = familyOpt === 'join'
      ? await db.joinFamily(joinCode)
      : await db.createFamily(newFam || name + "'s Family");

    if (famData?.error) {
      setLoading(btn, false, 'Create account');
      errEl.textContent = famData.error;
      return;
    }
    setLoading(btn, false, 'Create account');
    // onAuthStateChange will fire → loadAndShowApp()
  });

  // ── Setup screen: join ──
  document.getElementById('setup-join-form').addEventListener('submit', async e => {
    e.preventDefault();
    const code  = document.getElementById('setup-join-code').value.trim();
    const errEl = document.getElementById('setup-error');
    const btn   = e.target.querySelector('[type="submit"]');
    errEl.textContent = '';
    setLoading(btn, true, 'Join family');
    const { data } = await db.joinFamily(code);
    setLoading(btn, false, 'Join family');
    if (data?.error) { errEl.textContent = data.error; return; }
    await loadAndShowApp();
  });

  // ── Setup screen: create ──
  document.getElementById('setup-create-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name  = document.getElementById('setup-family-name').value.trim();
    const errEl = document.getElementById('setup-error');
    const btn   = e.target.querySelector('[type="submit"]');
    errEl.textContent = '';
    setLoading(btn, true, 'Create family');
    const { data } = await db.createFamily(name || 'My Family');
    setLoading(btn, false, 'Create family');
    if (data?.error) { errEl.textContent = data.error; return; }
    await loadAndShowApp();
  });

  document.getElementById('btn-setup-logout').addEventListener('click', async () => {
    await db.signOut();
    showScreen('login');
  });

  // ── Logout ──
  document.getElementById('btn-logout').addEventListener('click', async () => {
    if (realtimeChannel) { realtimeChannel.unsubscribe(); realtimeChannel = null; }
    await db.signOut();
  });

  // ── Tabs ──
  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => switchTab(t.dataset.tab))
  );

  // ── Search ──
  const btnSearch   = document.getElementById('btn-search-toggle');
  const searchBar   = document.getElementById('search-bar');
  const searchInput = document.getElementById('search-input');

  btnSearch.addEventListener('click', () => {
    const hidden = searchBar.classList.toggle('hidden');
    btnSearch.setAttribute('aria-expanded', String(!hidden));
    if (!hidden) searchInput.focus();
    else { searchQuery = ''; searchInput.value = ''; renderList(); }
  });
  searchInput.addEventListener('input', () => { searchQuery = searchInput.value.trim(); renderList(); });

  // ── Add item ──
  const btnAddDetails = document.getElementById('btn-add-details');
  const addDetails    = document.getElementById('add-details');

  btnAddDetails.addEventListener('click', () => {
    const hidden = addDetails.classList.toggle('hidden');
    addDetails.setAttribute('aria-hidden', String(hidden));
    btnAddDetails.setAttribute('aria-expanded', String(!hidden));
  });

  document.getElementById('add-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name     = document.getElementById('item-name').value.trim();
    if (!name) { document.getElementById('item-name').focus(); return; }
    const btn = e.target.querySelector('[type="submit"]');
    setLoading(btn, true, 'Add');
    await addItem({
      name,
      quantity: document.getElementById('item-quantity').value,
      category: document.getElementById('item-category').value,
      notes:    document.getElementById('item-notes').value,
    });
    setLoading(btn, false, 'Add');
    document.getElementById('item-name').value    = '';
    document.getElementById('item-quantity').value = '';
    document.getElementById('item-category').value = '';
    document.getElementById('item-notes').value    = '';
    addDetails.classList.add('hidden');
    addDetails.setAttribute('aria-hidden', 'true');
    btnAddDetails.setAttribute('aria-expanded', 'false');
    document.getElementById('item-name').focus();
  });

  // ── Edit modal ──
  document.getElementById('edit-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!editingId) return;
    const btn = e.target.querySelector('[type="submit"]');
    setLoading(btn, true, 'Save');
    const ok = await updateItem(editingId, {
      name:     document.getElementById('edit-name').value,
      quantity: document.getElementById('edit-quantity').value,
      category: document.getElementById('edit-category').value,
      notes:    document.getElementById('edit-notes').value,
    });
    setLoading(btn, false, 'Save');
    if (ok) closeEditModal();
  });
  document.getElementById('btn-edit-cancel').addEventListener('click', closeEditModal);

  // ── Delete modal ──
  document.getElementById('btn-delete-confirm').addEventListener('click', async () => {
    if (!deletingId) return;
    await deleteItem(deletingId);
    closeDeleteModal();
  });
  document.getElementById('btn-delete-cancel').addEventListener('click', closeDeleteModal);

  // Close modals on backdrop click / Escape
  ['modal-edit', 'modal-delete'].forEach(modalId => {
    document.getElementById(modalId).addEventListener('click', e => {
      if (e.target !== e.currentTarget) return;
      modalId === 'modal-edit' ? closeEditModal() : closeDeleteModal();
    });
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('modal-edit').classList.contains('hidden'))   closeEditModal();
    if (!document.getElementById('modal-delete').classList.contains('hidden')) closeDeleteModal();
  });

  // ── Settings: family name ──
  document.getElementById('btn-save-family-name').addEventListener('click', async () => {
    const val = document.getElementById('settings-family-name').value.trim().slice(0, 100);
    if (!val) return;
    familyName = val;
    await db.updateFamilyName(familyId, familyName);
    document.getElementById('family-name-header').textContent = familyName;
    document.title = familyName;
  });

  // ── Settings: copy join code ──
  document.getElementById('btn-copy-code').addEventListener('click', async () => {
    if (!familyJoinCode) return;
    try {
      await navigator.clipboard.writeText(familyJoinCode);
      const btn = document.getElementById('btn-copy-code');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    } catch {}
  });

  // ── Settings: change password ──
  document.getElementById('btn-change-pw').addEventListener('click', async () => {
    const msgEl  = document.getElementById('pw-change-msg');
    const newPw  = document.getElementById('settings-new-pw').value;
    const newPw2 = document.getElementById('settings-new-pw2').value;
    msgEl.className = 'msg';
    if (newPw.length < 6) { msgEl.textContent = 'Password must be at least 6 characters.'; msgEl.classList.add('error'); return; }
    if (newPw !== newPw2)  { msgEl.textContent = 'Passwords do not match.'; msgEl.classList.add('error'); return; }
    const { error } = await db.updatePassword(newPw);
    if (error) {
      msgEl.textContent = error.message; msgEl.classList.add('error');
    } else {
      document.getElementById('settings-new-pw').value  = '';
      document.getElementById('settings-new-pw2').value = '';
      msgEl.textContent = 'Password changed successfully.'; msgEl.classList.add('success');
    }
  });

  // ── Settings: export ──
  document.getElementById('btn-export-csv').addEventListener('click', exportCsv);

  // ── Settings: clear purchased ──
  document.getElementById('btn-clear-purchased').addEventListener('click', async () => {
    if (!confirm('Remove all purchased items?')) return;
    await clearPurchased();
    switchTab('list');
  });

  // ── Settings: clear all ──
  document.getElementById('btn-clear-all').addEventListener('click', async () => {
    if (!confirm('Delete the entire grocery list? This cannot be undone.')) return;
    await clearAllItems();
    switchTab('list');
  });

  // ── Offline events ──
  window.addEventListener('online',  () => { updateOfflineBanner(); refreshItems(); });
  window.addEventListener('offline', updateOfflineBanner);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────
async function init() {
  registerSW();
  initEvents();

  // Auth state changes (sign-in, sign-out, token refresh)
  db.onAuthStateChange(async (event, session) => {
    if (event === 'INITIAL_SESSION') return; // handled below
    if (event === 'SIGNED_OUT') {
      if (realtimeChannel) { realtimeChannel.unsubscribe(); realtimeChannel = null; }
      showScreen('login');
    } else if (session) {
      const profile = await db.getProfile(session.user.id);
      displayName   = profile?.display_name || session.user.email.split('@')[0];
      await loadAndShowApp();
    }
  });

  // Initial session check
  const session = await db.getSession();
  if (session) {
    const profile = await db.getProfile(session.user.id);
    displayName   = profile?.display_name || session.user.email.split('@')[0];
    await loadAndShowApp();
  } else {
    showScreen('login');
  }
}

init();
