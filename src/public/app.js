const main = document.getElementById('content');
const tabs = document.querySelectorAll('nav button');
const state = { leads: [], config: {}, token: localStorage.getItem('token') || '' };

// --- API helper ---
async function apiFetch(url, options = {}) {
    if (!options.headers) options.headers = {};
    if (state.token) options.headers['Authorization'] = `Bearer ${state.token}`;
    let res = await fetch(url, options);
    if (res.status === 401) {
        const pw = prompt('Enter password (empty if none):');
        if (pw === null) return res;
        const lr = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
        const d = await lr.json();
        if (d.token !== undefined) { state.token = d.token; localStorage.setItem('token', state.token); options.headers['Authorization'] = `Bearer ${state.token}`; res = await fetch(url, options); }
        else alert('Invalid password');
    }
    return res;
}
function postJson(url, data) { return apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); }

async function postJsonOrThrow(url, data) {
    const res = await postJson(url, data);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `Server error (${res.status})`);
    return json;
}

// --- Shared card renderer ---
function renderLeadCard(item, container, { source = 'discovery', showReject = true, showAdd = true } = {}) {
    const card = document.createElement('div');
    card.className = 'discovery-card';
    const isPerson = item.type === 'person';
    const badge = isPerson ? '<span class="badge badge-person">Person</span>' : '<span class="badge badge-org">Organization</span>';
    let links = '';
    if (isPerson) {
        if (item.linkedin) links += `<a href="${item.linkedin}" target="_blank" rel="noopener">LinkedIn ↗</a>`;
        if (item.email) links += `<a href="mailto:${item.email}">${item.email}</a>`;
    } else {
        if (item.website) links += `<a href="${item.website}" target="_blank" rel="noopener">Website ↗</a>`;
        if (item.contactUrl) links += `<a href="${item.contactUrl}" target="_blank" rel="noopener">Contact ↗</a>`;
    }
    card.innerHTML = `
        <div class="card-header">${badge}<strong>${item.name || 'Unknown'}</strong></div>
        <div class="card-links">${links || '<span class="muted">No links</span>'}</div>
        <div class="card-actions">
            ${showReject ? '<button class="btn-reject">Reject</button>' : ''}
            ${showAdd ? '<button class="btn-add">Add to Leads</button>' : ''}
        </div>`;
    if (showReject) card.querySelector('.btn-reject').onclick = () => card.remove();
    if (showAdd) card.querySelector('.btn-add').onclick = async () => {
        const lead = { name: item.name, type: item.type || 'organization', organization: isPerson ? '' : item.name, email: item.email || '', linkedin: item.linkedin || '', website: item.website || '', contactUrl: item.contactUrl || '', source, status: 'New' };
        try {
            await postJsonOrThrow('/api/leads', lead);
            card.classList.add('card-added');
            card.querySelector('.card-actions').innerHTML = '<span class="status-ok">✅ Added</span>';
        } catch (err) {
            card.querySelector('.card-actions').innerHTML = `<span class="error-msg">❌ ${err.message}</span>`;
        }
    };
    container.appendChild(card);
}

// --- Search history ---
function getSearchHistory() {
    try { return JSON.parse(localStorage.getItem('searchHistory') || '[]'); } catch { return []; }
}
function addToSearchHistory(topic) {
    const h = getSearchHistory().filter(t => t !== topic);
    h.unshift(topic);
    localStorage.setItem('searchHistory', JSON.stringify(h.slice(0, 20)));
}

// --- Discovery ---
function initDiscovery() {
    const input = document.getElementById('discovery-topic');
    const btn = document.getElementById('start-discovery');
    const suggestBtn = document.getElementById('suggest-topics');
    const suggestionsDiv = document.getElementById('topic-suggestions');
    const historyDiv = document.getElementById('search-history');
    const resultsDiv = document.getElementById('discovery-results');

    function renderHistory() {
        const h = getSearchHistory();
        if (!h.length) { historyDiv.style.display = 'none'; return; }
        historyDiv.style.display = 'block';
        historyDiv.innerHTML = '<span class="muted" style="font-size:0.8rem">Recent:</span> ' +
            h.map(t => `<button class="suggestion-chip history-chip">${t}</button>`).join('');
        historyDiv.querySelectorAll('.history-chip').forEach(chip => {
            chip.onclick = () => { input.value = chip.textContent; };
        });
    }
    renderHistory();

    async function doSearch() {
        const topic = input.value.trim();
        if (!topic) return;
        addToSearchHistory(topic);
        renderHistory();
        resultsDiv.innerHTML = '<p class="muted">🔍 Searching...</p>';
        btn.disabled = true;
        try {
            const data = await postJsonOrThrow('/api/discovery', { topic });
            resultsDiv.innerHTML = '';
            if (!Array.isArray(data) || !data.length) { resultsDiv.innerHTML = '<p class="muted">No results found.</p>'; return; }
            data.forEach(item => renderLeadCard(item, resultsDiv, { source: `discovery: ${topic}` }));
        } catch (err) { resultsDiv.innerHTML = `<div class="error-msg">❌ ${err.message}</div>`; }
        finally { btn.disabled = false; }
    }

    btn.onclick = doSearch;
    input.onkeydown = (e) => { if (e.key === 'Enter') doSearch(); };

    suggestBtn.onclick = async () => {
        suggestBtn.disabled = true;
        suggestBtn.textContent = '...';
        suggestionsDiv.style.display = 'none';
        const history = getSearchHistory();
        try {
            const suggestions = await postJsonOrThrow('/api/suggest-topics', {
                topic: input.value.trim(),
                history: history.slice(0, 5),
            });
            if (Array.isArray(suggestions) && suggestions.length) {
                suggestionsDiv.style.display = 'block';
                suggestionsDiv.innerHTML = suggestions.map(s => `<button class="suggestion-chip">${s}</button>`).join('');
                suggestionsDiv.querySelectorAll('.suggestion-chip').forEach(chip => {
                    chip.onclick = () => { input.value = chip.textContent; suggestionsDiv.style.display = 'none'; };
                });
            } else {
                suggestionsDiv.style.display = 'block';
                suggestionsDiv.innerHTML = '<span class="muted">No suggestions returned.</span>';
            }
        } catch (err) {
            suggestionsDiv.style.display = 'block';
            suggestionsDiv.innerHTML = `<span class="error-msg">❌ ${err.message}</span>`;
        }
        finally { suggestBtn.disabled = false; suggestBtn.textContent = 'Suggest'; }
    };
}

// --- Scraper history ---
function getScraperHistory() {
    try { return JSON.parse(localStorage.getItem('scraperHistory') || '[]'); } catch { return []; }
}
function addToScraperHistory(url) {
    const h = getScraperHistory().filter(u => u !== url);
    h.unshift(url);
    localStorage.setItem('scraperHistory', JSON.stringify(h.slice(0, 15)));
}

// --- Scraper ---
function initScraper() {
    const btn = document.getElementById('start-scraper');
    const contBtn = document.getElementById('continue-scraper');
    const statusEl = document.getElementById('scraper-status');
    const resultsDiv = document.getElementById('scraper-results');
    const historyDiv = document.getElementById('scraper-history');
    const urlInput = document.getElementById('scraper-url');
    let scrapeState = null;

    function renderScraperHistory() {
        const h = getScraperHistory();
        if (!h.length) { historyDiv.style.display = 'none'; return; }
        historyDiv.style.display = 'block';
        historyDiv.innerHTML = '<span class="muted" style="font-size:0.8rem">Recent:</span> ' +
            h.map(u => { try { return `<button class="suggestion-chip history-chip" title="${u}">${new URL(u).hostname}</button>`; } catch { return ''; } }).join('');
        historyDiv.querySelectorAll('.history-chip').forEach((chip, i) => {
            chip.onclick = () => { urlInput.value = h[i]; };
        });
    }
    renderScraperHistory();

    async function doScrape(isContine) {
        const url = urlInput.value.trim();
        const depth = document.getElementById('scraper-depth').value;
        if (!url) return;
        if (!isContine) {
            scrapeState = null;
            resultsDiv.innerHTML = '';
            addToScraperHistory(url);
            renderScraperHistory();
        }
        btn.disabled = true; contBtn.style.display = 'none';
        statusEl.textContent = '⏳ Scraping...';
        try {
            const payload = { url, depth };
            if (scrapeState) { payload.visited = scrapeState.visited; payload.queue = scrapeState.queue; payload.knownNames = scrapeState.knownNames; }
            const data = await postJsonOrThrow('/api/scrape', payload);
            scrapeState = { visited: data.visited, queue: data.queue, knownNames: data.knownNames, url, depth };
            statusEl.textContent = `${data.visited.length} pages visited`;
            if (!data.leads.length && !isContine) resultsDiv.innerHTML = '<p class="muted">No leads found in this batch.</p>';
            else data.leads.forEach(item => renderLeadCard(item, resultsDiv, { source: url }));
            if (data.hasMore) { contBtn.style.display = 'inline-block'; statusEl.textContent += ' — more pages available'; }
            else { contBtn.style.display = 'none'; statusEl.textContent += ' — done'; }
        } catch (err) { resultsDiv.innerHTML += `<div class="error-msg">❌ ${err.message}</div>`; statusEl.textContent = ''; }
        finally { btn.disabled = false; }
    }

    btn.onclick = () => doScrape(false);
    contBtn.onclick = () => doScrape(true);
}

// --- Lead Management ---
function openLeadModal(lead) {
    const modal = document.getElementById('lead-modal');
    document.getElementById('modal-title').textContent = lead.name || 'Lead Details';
    const isPerson = lead.type === 'person';
    const statusOptions = ['New', 'Contacted', 'Not Interested'].map(s => `<option value="${s}" ${lead.status === s ? 'selected' : ''}>${s}</option>`).join('');
    document.getElementById('modal-body').innerHTML = `
        <div class="modal-field"><span class="modal-label">Type:</span> ${isPerson ? 'Person' : 'Organization'}</div>
        ${lead.organization ? `<div class="modal-field"><span class="modal-label">Organization:</span> ${lead.organization}</div>` : ''}
        ${lead.email ? `<div class="modal-field"><span class="modal-label">Email:</span> <a href="mailto:${lead.email}">${lead.email}</a></div>` : ''}
        ${lead.linkedin ? `<div class="modal-field"><span class="modal-label">LinkedIn:</span> <a href="${lead.linkedin}" target="_blank">${lead.linkedin}</a></div>` : ''}
        ${lead.website ? `<div class="modal-field"><span class="modal-label">Website:</span> <a href="${lead.website}" target="_blank">${lead.website}</a></div>` : ''}
        ${lead.contactUrl ? `<div class="modal-field"><span class="modal-label">Contact:</span> <a href="${lead.contactUrl}" target="_blank">${lead.contactUrl}</a></div>` : ''}
        <div class="modal-field"><span class="modal-label">Source:</span> ${lead.source || 'N/A'}</div>
        <div class="modal-field"><span class="modal-label">Created:</span> ${lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : 'N/A'}</div>
        <div class="form-group"><label>Status:</label><select id="modal-status">${statusOptions}</select></div>
        <div class="form-group"><label>Notes:</label><textarea id="modal-notes" rows="3">${lead.notes || ''}</textarea></div>
        <div class="modal-actions">
            <button id="modal-save">Save Changes</button>
            <button id="modal-delete" class="btn-danger">Delete Lead</button>
        </div>`;
    document.getElementById('modal-save').onclick = async () => {
        await apiFetch(`/api/leads/${lead.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: document.getElementById('modal-status').value, notes: document.getElementById('modal-notes').value }) });
        modal.style.display = 'none';
        loadLeads();
    };
    document.getElementById('modal-delete').onclick = async () => {
        if (!confirm('Delete this lead?')) return;
        await apiFetch(`/api/leads/${lead.id}`, { method: 'DELETE' });
        modal.style.display = 'none';
        loadLeads();
    };
    modal.style.display = 'flex';
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
}

async function loadLeads() {
    const res = await apiFetch('/api/leads');
    if (!res.ok) return;
    state.leads = await res.json();
    renderLeadsList();
}

function renderLeadsList() {
    const container = document.getElementById('leads-list');
    const countEl = document.getElementById('leads-count');
    if (!container) return;

    const statusFilter = document.getElementById('filter-status')?.value || '';
    const typeFilter = document.getElementById('filter-type')?.value || '';
    let filtered = state.leads;
    if (statusFilter) filtered = filtered.filter(l => l.status === statusFilter);
    if (typeFilter) filtered = filtered.filter(l => l.type === typeFilter);

    countEl.textContent = `${filtered.length} of ${state.leads.length} leads`;

    if (!filtered.length) { container.innerHTML = '<p class="muted">No leads yet. Use Discovery or Scraper to find some.</p>'; return; }

    container.innerHTML = filtered.map(lead => {
        const isPerson = lead.type === 'person';
        const badge = isPerson ? '<span class="badge badge-person">Person</span>' : '<span class="badge badge-org">Org</span>';
        const statusClass = lead.status === 'Contacted' ? 'status-contacted' : lead.status === 'Not Interested' ? 'status-rejected' : 'status-new';
        const link = isPerson
            ? (lead.linkedin ? `<a href="${lead.linkedin}" target="_blank">LinkedIn ↗</a>` : (lead.email ? `<a href="mailto:${lead.email}">${lead.email}</a>` : ''))
            : (lead.contactUrl ? `<a href="${lead.contactUrl}" target="_blank">Contact ↗</a>` : (lead.website ? `<a href="${lead.website}" target="_blank">Website ↗</a>` : ''));
        return `<div class="lead-row" data-id="${lead.id}">
            <div class="lead-main">${badge}<strong>${lead.name || 'N/A'}</strong></div>
            <div class="lead-contact">${link || '<span class="muted">—</span>'}</div>
            <div class="lead-status"><span class="status-badge ${statusClass}">${lead.status || 'New'}</span></div>
            <div class="lead-source muted">${lead.source || ''}</div>
        </div>`;
    }).join('');

    container.querySelectorAll('.lead-row').forEach(row => {
        row.onclick = () => { const lead = state.leads.find(l => l.id === row.dataset.id); if (lead) openLeadModal(lead); };
    });
}

function initLeads() {
    loadLeads();
    document.getElementById('filter-status')?.addEventListener('change', renderLeadsList);
    document.getElementById('filter-type')?.addEventListener('change', renderLeadsList);
}

// --- Settings ---
async function loadSettings() {
    const res = await apiFetch('/api/config');
    if (!res.ok) return;
    state.config = await res.json();

    const modelsRes = await apiFetch('/api/models');
    if (!modelsRes.ok) return;
    const models = await modelsRes.json();
    const SEARCH_MODELS = /search|tavily|duckduckgo|exa-/i;
    const opts = [
        '<option value="">Default (fast tier)</option>',
        '<option value="fast">fast (tier)</option>',
        '<option value="deep">deep (tier)</option>',
        ...models.fast.filter(m => !SEARCH_MODELS.test(m.name)).map(m => `<option value="${m.name}">${m.name} (fast)</option>`),
        ...models.deep.filter(m => !SEARCH_MODELS.test(m.name)).map(m => `<option value="${m.name}">${m.name} (deep)</option>`),
        ...models.fast.filter(m => SEARCH_MODELS.test(m.name)).map(m => `<option value="${m.name}">${m.name} (search)</option>`),
    ].join('');

    const llm = document.getElementById('llm-settings');
    if (llm) {
        const tasks = ['discovery', 'suggest', 'extraction', 'scoring'];
        llm.innerHTML = tasks.map(t => `
            <div class="form-group"><label>${t.charAt(0).toUpperCase() + t.slice(1)}:</label>
            <div class="flex-row"><select id="config-${t}">${opts}</select>
            <button class="btn-test" data-task="${t}">Test</button>
            <span id="test-status-${t}" class="test-status"></span></div></div>`).join('');
        tasks.forEach(t => {
            const tc = state.config.tasks?.[t] || {};
            const val = tc.model || tc.tier || '';
            const sel = document.getElementById(`config-${t}`);
            if (sel) {
                sel.value = val;
                // If saved value isn't in options, add it so it shows
                if (sel.value !== val && val) {
                    sel.insertAdjacentHTML('beforeend', `<option value="${val}" selected>${val} (saved)</option>`);
                    sel.value = val;
                }
            }
            document.querySelector(`.btn-test[data-task="${t}"]`).onclick = () => testModel(t);
            sel.onchange = () => autoSaveSettings(`${t} → ${sel.value || 'default'}`);
        });
    }

    // Scoring keywords
    const scoring = document.getElementById('scoring-settings');
    if (scoring) {
        const kw = state.config.scoring?.keywords || {};
        scoring.innerHTML = Object.entries(kw).map(([k, v]) =>
            `<div class="keyword-row"><span>${k}</span><span class="muted">${v} pts</span><button class="btn-x" data-kw="${k}">×</button></div>`
        ).join('') || '<p class="muted">No keywords configured.</p>';
        scoring.querySelectorAll('.btn-x').forEach(btn => {
            btn.onclick = () => { delete state.config.scoring.keywords[btn.dataset.kw]; autoSaveSettings(`Removed "${btn.dataset.kw}"`); loadSettings(); };
        });
    }

    document.getElementById('add-keyword').onclick = () => {
        const kw = document.getElementById('new-keyword').value.trim();
        const sc = parseInt(document.getElementById('new-keyword-score').value) || 10;
        if (!kw) return;
        if (!state.config.scoring) state.config.scoring = { keywords: {} };
        state.config.scoring.keywords[kw] = sc;
        document.getElementById('new-keyword').value = '';
        autoSaveSettings(`Added "${kw}" (${sc} pts)`);
        loadSettings();
    };
}

async function testModel(task) {
    const val = document.getElementById(`config-${task}`).value;
    const span = document.getElementById(`test-status-${task}`);
    if (!val) { span.textContent = '❌ Select model'; return; }
    span.textContent = '⏳'; span.className = 'test-status testing';
    const payload = (val === 'fast' || val === 'deep') ? { tier: val } : { model: val };
    try {
        const res = await postJson('/api/test-model', payload);
        const d = await res.json();
        span.textContent = d.success ? '✅' : '❌ ' + (d.error || 'Failed').substring(0, 40);
        span.className = `test-status ${d.success ? 'success' : 'fail'}`;
    } catch { span.textContent = '❌ Error'; span.className = 'test-status fail'; }
}

function showSaveToast(msg) {
    let toast = document.getElementById('save-toast');
    if (!toast) { toast = document.createElement('div'); toast.id = 'save-toast'; toast.className = 'save-toast'; document.body.appendChild(toast); }
    toast.textContent = '✓ ' + msg;
    toast.classList.add('visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('visible'), 2000);
}

async function autoSaveSettings(what) {
    const tasks = {};
    ['discovery', 'suggest', 'extraction', 'scoring'].forEach(t => {
        const val = document.getElementById(`config-${t}`)?.value || '';
        tasks[t] = (val === 'fast' || val === 'deep' || val === '') ? { tier: val || 'fast' } : { model: val };
    });
    await postJson('/api/config', { tasks, scoring: state.config.scoring });
    showSaveToast(what || 'Settings saved');
}

function initSettings() {
    loadSettings();
}

// --- Tab routing ---
function renderTab(tabId) {
    const tpl = document.getElementById(`${tabId}-template`);
    if (!tpl) return;
    main.innerHTML = '';
    main.appendChild(tpl.content.cloneNode(true));
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
    if (tabId === 'discovery') initDiscovery();
    if (tabId === 'scraper') initScraper();
    if (tabId === 'leads') initLeads();
    if (tabId === 'settings') initSettings();
}
tabs.forEach(t => t.addEventListener('click', () => renderTab(t.dataset.tab)));
renderTab('discovery');
