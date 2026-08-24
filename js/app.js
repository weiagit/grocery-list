// ── Family Grocery List — app.js ──────────────────────────────────────────

// ── Storage keys ──────────────────────────────────────────────────────────
const KEY_AUTH       = 'fgl_auth';
const KEY_PASSWORD   = 'fgl_pw';
const KEY_ITEMS      = 'fgl_items';
const KEY_ACTIVITY   = 'fgl_activity';
const KEY_FAMILY     = 'fgl_family';

const DEFAULT_PASSWORD = 'family';
const MAX_ACTIVITY     = 200;   // keep last N records
const ACTIVITY_TTL_MS  = 90 * 24 * 60 * 60 * 1000;  // 90 days

// ── State ─────────────────────────────────────────────────────────────────
let items      = [];   // GroceryItem[]
let activity   = [];   // ActivityRecord[]
let familyName = 'Family Groceries';
let searchQuery = '';
let editingId   = null;
let deletingId  = null;

// ── Utilities ─────────────────────────────────────────────────────────────
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s <  60)  return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

// ── Auth ──────────────────────────────────────────────────────────────────
function isLoggedIn() {
  return load(KEY_AUTH, false) === true;
}

function getPassword() {
  return load(KEY_PASSWORD, DEFAULT_PASSWORD);
}

function setPassword(pw) {
  save(KEY_PASSWORD, pw);
}

function login(pw) {
  if (pw === getPassword()) {
    save(KEY_AUTH, true);
    return true;
  }
  return false;
}

function logout() {
  save(KEY_AUTH, false);
  showScreen('login');
}

// ── Screen management ─────────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = name === 'login' ? 'screen-login' : 'screen-app';
  document.getElementById(target).classList.add('active');
}

// ── Tab management ────────────────────────────────────────────────────────
function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => {
    const active = t.dataset.tab === tabName;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('hidden', p.id !== `tab-${tabName}`);
    p.classList.toggle('active', p.id === `tab-${tabName}`);
  });
  if (tabName === 'activity') renderActivity();
  if (tabName === 'settings') populateSettings();
}

// ── Data persistence ──────────────────────────────────────────────────────
function loadData() {
  items      = load(KEY_ITEMS,    []);
  activity   = load(KEY_ACTIVITY, []);
  familyName = load(KEY_FAMILY,   'Family Groceries');

  // Prune old activity
  const cutoff = Date.now() - ACTIVITY_TTL_MS;
  activity = activity.filter(a => a.ts >= cutoff);
}

function saveItems()    { save(KEY_ITEMS,    items); }
function saveActivity() { save(KEY_ACTIVITY, activity); }

function addActivityRecord(icon, text) {
  activity.unshift({ id: generateId(), icon, text, ts: Date.now() });
  if (activity.length > MAX_ACTIVITY) activity.length = MAX_ACTIVITY;
  saveActivity();
}

// ── Grocery CRUD ──────────────────────────────────────────────────────────
function createItem({ name, quantity = '', category = '', notes = '' }) {
  return {
    id:          generateId(),
    name:        name.trim().slice(0, 200),
    quantity:    quantity.trim().slice(0, 100),
    category:    category.trim(),
    notes:       notes.trim().slice(0, 1000),
    purchased:   false,
    createdAt:   Date.now(),
    updatedAt:   Date.now(),
    purchasedAt: null,
  };
}

function addItem(data) {
  if (!data.name.trim()) return false;
  const item = createItem(data);
  items.unshift(item);
  saveItems();
  addActivityRecord('➕', `Added "${item.name}"`);
  return true;
}

function togglePurchased(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  item.purchased   = !item.purchased;
  item.updatedAt   = Date.now();
  item.purchasedAt = item.purchased ? Date.now() : null;
  saveItems();
  if (item.purchased) {
    addActivityRecord('✅', `Marked "${item.name}" as purchased`);
  } else {
    addActivityRecord('↩️', `Unmarked "${item.name}"`);
  }
}

function updateItem(id, data) {
  const item = items.find(i => i.id === id);
  if (!item) return false;
  if (!data.name.trim()) return false;
  item.name      = data.name.trim().slice(0, 200);
  item.quantity  = (data.quantity || '').trim().slice(0, 100);
  item.category  = (data.category || '').trim();
  item.notes     = (data.notes || '').trim().slice(0, 1000);
  item.updatedAt = Date.now();
  saveItems();
  addActivityRecord('✏️', `Edited "${item.name}"`);
  return true;
}

function deleteItem(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  items = items.filter(i => i.id !== id);
  saveItems();
  addActivityRecord('🗑️', `Deleted "${item.name}"`);
}

function clearPurchased() {
  const count = items.filter(i => i.purchased).length;
  items = items.filter(i => !i.purchased);
  saveItems();
  if (count > 0) addActivityRecord('🧹', `Cleared ${count} purchased item${count !== 1 ? 's' : ''}`);
}

function clearAllItems() {
  const count = items.length;
  items = [];
  saveItems();
  if (count > 0) addActivityRecord('🗑️', `Cleared entire list (${count} items)`);
}

// ── Render grocery list ───────────────────────────────────────────────────
function getFilteredItems() {
  if (!searchQuery) return items;
  const q = searchQuery.toLowerCase();
  return items.filter(i =>
    i.name.toLowerCase().includes(q) ||
    (i.notes && i.notes.toLowerCase().includes(q)) ||
    (i.category && i.category.toLowerCase().includes(q))
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

  // Group active items by category
  const groups = new Map();
  for (const item of active) {
    const cat = item.category || '';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(item);
  }

  // Sort categories: named categories first (alphabetically), then uncategorized
  const sortedCats = [...groups.keys()].sort((a, b) => {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b);
  });

  let html = '';
  for (const cat of sortedCats) {
    if (cat) {
      html += `<div class="category-section">`;
      html += `<div class="category-label">${escapeHtml(cat)}</div>`;
    }
    for (const item of groups.get(cat)) {
      html += renderItemHtml(item);
    }
    if (cat) html += `</div>`;
  }

  if (purchased.length > 0) {
    html += `<div class="purchased-divider">Purchased (${purchased.length})</div>`;
    for (const item of purchased) {
      html += renderItemHtml(item);
    }
  }

  container.innerHTML = html;

  // Attach events
  container.querySelectorAll('.item-check').forEach(cb => {
    cb.addEventListener('change', () => {
      togglePurchased(cb.dataset.id);
      renderList();
    });
  });
  container.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.id));
  });
  container.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => openDeleteModal(btn.dataset.id));
  });
}

function renderItemHtml(item) {
  const checkedAttr = item.purchased ? 'checked' : '';
  const purchasedClass = item.purchased ? ' purchased' : '';
  const metaParts = [];
  if (item.quantity) metaParts.push(escapeHtml(item.quantity));
  if (item.notes)    metaParts.push(escapeHtml(item.notes));
  const meta = metaParts.length
    ? `<div class="item-meta">${metaParts.map(p => `<span>${p}</span>`).join('')}</div>`
    : '';
  return `
    <div class="grocery-item${purchasedClass}" data-id="${item.id}">
      <input
        type="checkbox"
        class="item-check"
        data-id="${item.id}"
        ${checkedAttr}
        aria-label="${escapeHtml(item.purchased ? `Unmark ${item.name}` : `Mark ${item.name} as purchased`)}"
      />
      <div class="item-body">
        <div class="item-name">${escapeHtml(item.name)}</div>
        ${meta}
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
            <path d="M10 11v6"/><path d="M14 11v6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>
    </div>`;
}

// ── Activity tab ──────────────────────────────────────────────────────────
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
        <div class="activity-time">${relativeTime(a.ts)}</div>
      </div>
    </div>
  `).join('');
}

// ── Modals ────────────────────────────────────────────────────────────────
function openEditModal(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  editingId = id;
  document.getElementById('edit-name').value     = item.name;
  document.getElementById('edit-quantity').value  = item.quantity || '';
  document.getElementById('edit-category').value  = item.category || '';
  document.getElementById('edit-notes').value     = item.notes || '';
  document.getElementById('modal-edit').classList.remove('hidden');
  document.getElementById('edit-name').focus();
}

function closeEditModal() {
  editingId = null;
  document.getElementById('modal-edit').classList.add('hidden');
}

function openDeleteModal(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  deletingId = id;
  document.getElementById('modal-delete-name').textContent = item.name;
  document.getElementById('modal-delete').classList.remove('hidden');
  document.getElementById('btn-delete-confirm').focus();
}

function closeDeleteModal() {
  deletingId = null;
  document.getElementById('modal-delete').classList.add('hidden');
}

// Close modal on backdrop click
['modal-edit', 'modal-delete'].forEach(id => {
  document.getElementById(id).addEventListener('click', e => {
    if (e.target === e.currentTarget) {
      if (id === 'modal-edit')   closeEditModal();
      if (id === 'modal-delete') closeDeleteModal();
    }
  });
});

// Close modals on Escape
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!document.getElementById('modal-edit').classList.contains('hidden'))   closeEditModal();
  if (!document.getElementById('modal-delete').classList.contains('hidden')) closeDeleteModal();
});

// ── Settings ──────────────────────────────────────────────────────────────
function populateSettings() {
  document.getElementById('settings-family-name').value = familyName;
  document.getElementById('settings-old-pw').value  = '';
  document.getElementById('settings-new-pw').value  = '';
  document.getElementById('settings-new-pw2').value = '';
  document.getElementById('pw-change-msg').textContent = '';
  document.getElementById('pw-change-msg').className   = 'msg';
}

function exportCsv() {
  const rows = [['Name', 'Quantity', 'Category', 'Notes', 'Purchased', 'Created']];
  for (const item of items) {
    rows.push([
      item.name,
      item.quantity || '',
      item.category || '',
      item.notes    || '',
      item.purchased ? 'Yes' : 'No',
      new Date(item.createdAt).toISOString(),
    ]);
  }
  const csv = rows.map(r =>
    r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  ).join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `grocery-list-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Offline detection ─────────────────────────────────────────────────────
function updateOfflineBanner() {
  const banner = document.getElementById('offline-banner');
  if (!navigator.onLine) {
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

// ── Service Worker registration ───────────────────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failed silently — app still works
    });
  }
}

// ── Wire up all events ────────────────────────────────────────────────────
function initEvents() {
  // ── Login ──
  document.getElementById('login-form').addEventListener('submit', e => {
    e.preventDefault();
    const pw = document.getElementById('password-input').value;
    const errEl = document.getElementById('login-error');
    if (login(pw)) {
      document.getElementById('password-input').value = '';
      errEl.textContent = '';
      showScreen('app');
      renderList();
    } else {
      errEl.textContent = "Incorrect password. Please try again.";
    }
  });

  // ── Logout ──
  document.getElementById('btn-logout').addEventListener('click', () => {
    logout();
  });

  // ── Tabs ──
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // ── Search toggle ──
  const btnSearch  = document.getElementById('btn-search-toggle');
  const searchBar  = document.getElementById('search-bar');
  const searchInput = document.getElementById('search-input');

  btnSearch.addEventListener('click', () => {
    const isHidden = searchBar.classList.toggle('hidden');
    btnSearch.setAttribute('aria-expanded', String(!isHidden));
    if (!isHidden) {
      searchInput.focus();
    } else {
      searchQuery = '';
      searchInput.value = '';
      renderList();
    }
  });

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    renderList();
  });

  // ── Add item ──
  const btnAddDetails = document.getElementById('btn-add-details');
  const addDetails    = document.getElementById('add-details');

  btnAddDetails.addEventListener('click', () => {
    const isHidden = addDetails.classList.toggle('hidden');
    addDetails.setAttribute('aria-hidden', String(isHidden));
    btnAddDetails.setAttribute('aria-expanded', String(!isHidden));
  });

  document.getElementById('add-form').addEventListener('submit', e => {
    e.preventDefault();
    const name     = document.getElementById('item-name').value.trim();
    const quantity = document.getElementById('item-quantity').value;
    const category = document.getElementById('item-category').value;
    const notes    = document.getElementById('item-notes').value;

    if (!name) {
      document.getElementById('item-name').focus();
      return;
    }

    addItem({ name, quantity, category, notes });

    // Reset form
    document.getElementById('item-name').value     = '';
    document.getElementById('item-quantity').value  = '';
    document.getElementById('item-category').value  = '';
    document.getElementById('item-notes').value     = '';
    addDetails.classList.add('hidden');
    addDetails.setAttribute('aria-hidden', 'true');
    btnAddDetails.setAttribute('aria-expanded', 'false');
    document.getElementById('item-name').focus();

    renderList();
  });

  // ── Edit modal ──
  document.getElementById('edit-form').addEventListener('submit', e => {
    e.preventDefault();
    if (!editingId) return;
    const ok = updateItem(editingId, {
      name:     document.getElementById('edit-name').value,
      quantity: document.getElementById('edit-quantity').value,
      category: document.getElementById('edit-category').value,
      notes:    document.getElementById('edit-notes').value,
    });
    if (ok) {
      closeEditModal();
      renderList();
    }
  });
  document.getElementById('btn-edit-cancel').addEventListener('click', closeEditModal);

  // ── Delete modal ──
  document.getElementById('btn-delete-confirm').addEventListener('click', () => {
    if (!deletingId) return;
    deleteItem(deletingId);
    closeDeleteModal();
    renderList();
  });
  document.getElementById('btn-delete-cancel').addEventListener('click', closeDeleteModal);

  // ── Settings: family name ──
  document.getElementById('btn-save-family-name').addEventListener('click', () => {
    const val = document.getElementById('settings-family-name').value.trim();
    if (!val) return;
    familyName = val.slice(0, 100);
    save(KEY_FAMILY, familyName);
    document.getElementById('family-name-header').textContent = familyName;
    document.title = familyName;
  });

  // ── Settings: change password ──
  document.getElementById('btn-change-pw').addEventListener('click', () => {
    const msgEl  = document.getElementById('pw-change-msg');
    const oldPw  = document.getElementById('settings-old-pw').value;
    const newPw  = document.getElementById('settings-new-pw').value;
    const newPw2 = document.getElementById('settings-new-pw2').value;

    msgEl.className = 'msg';

    if (oldPw !== getPassword()) {
      msgEl.textContent = 'Current password is incorrect.';
      msgEl.classList.add('error');
      return;
    }
    if (newPw.length < 4) {
      msgEl.textContent = 'New password must be at least 4 characters.';
      msgEl.classList.add('error');
      return;
    }
    if (newPw !== newPw2) {
      msgEl.textContent = 'New passwords do not match.';
      msgEl.classList.add('error');
      return;
    }

    setPassword(newPw);
    document.getElementById('settings-old-pw').value  = '';
    document.getElementById('settings-new-pw').value  = '';
    document.getElementById('settings-new-pw2').value = '';
    msgEl.textContent = 'Password changed successfully.';
    msgEl.classList.add('success');
  });

  // ── Settings: export ──
  document.getElementById('btn-export-csv').addEventListener('click', exportCsv);

  // ── Settings: clear purchased ──
  document.getElementById('btn-clear-purchased').addEventListener('click', () => {
    if (!confirm('Remove all purchased items from the list?')) return;
    clearPurchased();
    switchTab('list');
    renderList();
  });

  // ── Settings: clear all ──
  document.getElementById('btn-clear-all').addEventListener('click', () => {
    if (!confirm('Delete the entire grocery list? This cannot be undone.')) return;
    clearAllItems();
    switchTab('list');
    renderList();
  });

  // ── Offline events ──
  window.addEventListener('online',  updateOfflineBanner);
  window.addEventListener('offline', updateOfflineBanner);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────
function init() {
  loadData();
  registerSW();
  initEvents();

  if (isLoggedIn()) {
    showScreen('app');
    document.getElementById('family-name-header').textContent = familyName;
    document.title = familyName;
    updateOfflineBanner();
    renderList();
  } else {
    showScreen('login');
  }
}

init();
