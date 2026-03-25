const main = document.getElementById('content');
const tabs = document.querySelectorAll('nav button');

const state = {
    leads: [],
    config: {},
    activeTab: 'discovery',
    token: localStorage.getItem('token') || ''
};

async function apiFetch(url, options = {}) {
    if (!options.headers) options.headers = {};
    if (state.token) {
        options.headers['Authorization'] = `Bearer ${state.token}`;
    }
    
    let res = await fetch(url, options);
    if (res.status === 401) {
        const password = prompt('Please enter your password (leave empty if none):');
        if (password !== null) {
            const loginRes = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const data = await loginRes.json();
            if (data.token !== undefined) {
                state.token = data.token;
                localStorage.setItem('token', state.token);
                // Retry original request with new token
                options.headers['Authorization'] = `Bearer ${state.token}`;
                res = await fetch(url, options);
            } else {
                alert('Invalid password');
            }
        }
    }
    return res;
}

async function loadLeads() {
    const res = await apiFetch('/api/leads');
    if (!res.ok) return;
    state.leads = await res.json();
    const tbody = document.querySelector('#leads-table tbody');
    if (!tbody) return;
    
    tbody.innerHTML = state.leads.map(lead => `
        <tr>
            <td>${lead.name || 'N/A'}</td>
            <td>${lead.organization || 'N/A'}</td>
            <td>${lead.email || 'N/A'}</td>
            <td>${lead.status || 'New'}</td>
            <td>${lead.score || 0}</td>
            <td><button class="btn-small">View</button></td>
        </tr>
    `).join('');
}

async function loadSettings() {
    const res = await apiFetch('/api/config');
    if (!res.ok) return;
    state.config = await res.json();
    
    const modelsRes = await apiFetch('/api/models');
    if (!modelsRes.ok) return;
    const availableModels = await modelsRes.json();
    const modelOptions = [
        ...availableModels.fast.map(m => `<option value="${m.name}">${m.name} (fast)</option>`),
        ...availableModels.deep.map(m => `<option value="${m.name}">${m.name} (deep)</option>`),
        '<option value="fast">fast (tier)</option>',
        '<option value="deep">deep (tier)</option>'
    ].join('');

    const llmSettings = document.getElementById('llm-settings');
    if (llmSettings) {
        const tasks = ['discovery', 'extraction', 'scoring'];
        llmSettings.innerHTML = tasks.map(task => `
            <div class="form-group">
                <label>${task.charAt(0).toUpperCase() + task.slice(1)} Model/Tier:</label>
                <select id="config-${task}">
                    <option value="">Select Model/Tier</option>
                    ${modelOptions}
                </select>
            </div>
        `).join('');
        
        tasks.forEach(task => {
            const val = state.config.tasks?.[task]?.model || state.config.tasks?.[task]?.tier || '';
            const select = document.getElementById(`config-${task}`);
            if (select) select.value = val;
        });
    }
}

function initDiscovery() {
    const btn = document.getElementById('start-discovery');
    if (!btn) return;
    btn.onclick = async () => {
        const topic = document.getElementById('discovery-topic').value;
        const resultsDiv = document.getElementById('discovery-results');
        resultsDiv.innerText = 'Searching...';
        
        try {
            const res = await apiFetch('/api/discovery', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topic })
            });
            const data = await res.json();
            resultsDiv.innerHTML = `<ul>${data.map(d => `<li><strong>${d.name}</strong>: ${d.query}</li>`).join('')}</ul>`;
        } catch (err) {
            resultsDiv.innerText = 'Error: ' + err.message;
        }
    };
}

function initScraper() {
    const btn = document.getElementById('start-scraper');
    if (!btn) return;
    btn.onclick = async () => {
        const url = document.getElementById('scraper-url').value;
        const depth = document.getElementById('scraper-depth').value;
        const resultsDiv = document.getElementById('scraper-results');
        resultsDiv.innerText = 'Scraping and extracting leads... (This may take a while)';
        
        try {
            const res = await apiFetch('/api/scrape', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, depth })
            });
            const data = await res.json();
            resultsDiv.innerHTML = `<p>Found and saved ${data.length} leads.</p>`;
        } catch (err) {
            resultsDiv.innerText = 'Error: ' + err.message;
        }
    };
}

function initSettings() {
    const btn = document.getElementById('save-settings');
    if (!btn) return;
    btn.onclick = async () => {
        const updates = {
            tasks: {
                discovery: { tier: document.getElementById('config-discovery').value },
                extraction: { tier: document.getElementById('config-extraction').value },
                scoring: { tier: document.getElementById('config-scoring').value }
            }
        };
        ['discovery', 'extraction', 'scoring'].forEach(task => {
            const val = updates.tasks[task].tier;
            if (val !== 'fast' && val !== 'deep' && val !== '') {
                updates.tasks[task] = { model: val };
                delete updates.tasks[task].tier;
            }
        });

        await apiFetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        alert('Settings saved!');
    };
}

function renderTab(tabId) {
    const template = document.getElementById(`${tabId}-template`);
    if (!template) return;

    main.innerHTML = '';
    main.appendChild(template.content.cloneNode(true));
    
    tabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabId);
    });

    state.activeTab = tabId;
    
    if (tabId === 'discovery') initDiscovery();
    if (tabId === 'scraper') initScraper();
    if (tabId === 'leads') loadLeads();
    if (tabId === 'settings') {
        loadSettings();
        initSettings();
    }
}

tabs.forEach(tab => {
    tab.addEventListener('click', () => renderTab(tab.dataset.tab));
});

// Initial render
renderTab('discovery');
