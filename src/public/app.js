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
// --- Projects storage (localStorage) ---
function getProjects() { try { return JSON.parse(localStorage.getItem('projects') || '[]'); } catch { return []; } }
function saveProjects(p) { localStorage.setItem('projects', JSON.stringify(p)); }
function addProject(item) {
    const projects = getProjects();
    if (projects.some(p => p.name?.toLowerCase() === item.name?.toLowerCase())) return false;
    projects.push({ ...item, addedAt: new Date().toISOString() });
    saveProjects(projects);
    return true;
}

function getInvestors() { try { return JSON.parse(localStorage.getItem('investors') || '[]'); } catch { return []; } }
function saveInvestors(list) { localStorage.setItem('investors', JSON.stringify(list)); }
function addInvestor(item) {
    const list = getInvestors();
    if (list.some(i => i.name?.toLowerCase() === item.name?.toLowerCase())) return false;
    list.push({ ...item, type: 'investor', addedAt: new Date().toISOString() });
    saveInvestors(list);
    return true;
}

function renderLeadCard(item, container, { source = 'discovery', showReject = true, showAdd = true } = {}) {
    const card = document.createElement('div');
    card.className = 'discovery-card';
    const isProject = item.type === 'project' || item.type === 'consortium' || item.type === 'association';
    const isInvestor = item.type === 'investor';
    const isPerson = item.type === 'person';
    const badge = isPerson ? '<span class="badge badge-person">Person</span>'
        : isInvestor ? '<span class="badge badge-investor">Investor</span>'
        : isProject ? '<span class="badge badge-project">Project</span>'
        : '<span class="badge badge-org">Organization</span>';
    let links = '';
    if (isPerson) {
        if (item.linkedin) links += `<a href="${item.linkedin}" target="_blank" rel="noopener">LinkedIn ↗</a>`;
        if (item.email) links += `<a href="mailto:${item.email}">${item.email}</a>`;
    } else {
        if (item.website) links += `<a href="${item.website}" target="_blank" rel="noopener">Website ↗</a>`;
        if (item.contactUrl) links += `<a href="${item.contactUrl}" target="_blank" rel="noopener">Contact ↗</a>`;
    }
    const isOrg = !isPerson && !isProject;
    const projectBtn = (isProject || isOrg) && item.website ? '<button class="btn-project">📁 Project</button>' : '';
    const investorBtn = isOrg && !isInvestor ? '<button class="btn-investor">💰 Investor</button>' : '';
    card.innerHTML = `
        <div class="card-header">${badge}<strong>${item.name || 'Unknown'}</strong></div>
        <div class="card-links">${links || '<span class="muted">No links</span>'}</div>
        <div class="card-actions">
            ${showReject ? '<button class="btn-reject">Reject</button>' : ''}
            ${projectBtn}
            ${investorBtn}
            ${showAdd ? '<button class="btn-add">Add to Leads</button>' : ''}
        </div>`;
    if (showReject) card.querySelector('.btn-reject').onclick = () => card.remove();
    const projBtn = card.querySelector('.btn-project');
    if (projBtn) projBtn.onclick = () => {
        if (addProject(item)) { projBtn.textContent = '✅'; projBtn.disabled = true; }
        else { projBtn.textContent = 'Exists'; projBtn.disabled = true; }
    };
    const invBtn = card.querySelector('.btn-investor');
    if (invBtn) invBtn.onclick = () => {
        if (addInvestor(item)) { invBtn.textContent = '✅'; invBtn.disabled = true; }
        else { invBtn.textContent = 'Exists'; invBtn.disabled = true; }
    };
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

// --- Default discovery suggestions ---
const DEFAULT_SUGGESTIONS = [
    // AI & Research Automation
    "Horizon Europe coordinators in AI-assisted scientific discovery",
    "Research groups automating literature review with NLP and LLMs",
    "EU-funded projects on automated hypothesis generation in life sciences",
    "SMEs building AI tools for systematic review and meta-analysis",
    "Principal investigators in automated drug discovery pipelines",
    "Consortium leads for Horizon Europe Cluster 1 Health automation projects",
    "Startups automating clinical trial matching and patient recruitment",
    "Research labs using machine learning for materials discovery",
    "European projects on AI-driven protein structure prediction",
    "Organizations developing automated lab robotics for high-throughput screening",
    // Data & Knowledge Management
    "Companies building knowledge graphs for research institutions",
    "EU projects on FAIR data automation and research data management",
    "SMEs providing automated research compliance and ethics review tools",
    "Coordinators of European Open Science Cloud (EOSC) projects",
    "Startups automating patent analysis and technology scouting",
    // Digital Twins & Simulation
    "Horizon Europe digital twin projects seeking automation partners",
    "Research groups automating simulation workflows in engineering",
    "EU-funded projects on automated climate modeling and prediction",
    "SMEs building automated testing and validation platforms",
    // Proposal & Grant Writing
    "Innovation consultancies automating EU grant proposal writing",
    "Companies building AI tools for research proposal evaluation",
    "National contact points seeking tools for Horizon Europe call matching",
    "Organizations automating research impact assessment and reporting",
    // Cross-cutting
    "Decision makers at European research infrastructure consortiums (ESFRI)",
    "CTOs of research computing centers adopting AI workflow automation",
    "Directors of university research offices seeking efficiency tools",
    "Heads of innovation at pharmaceutical companies automating R&D",
    "Project managers at JRC seeking automated analysis tools",
    "Leaders of EIT Knowledge and Innovation Communities (KICs)",
    "Coordinators of Innovative Medicines Initiative (IMI) projects",
    "European SMEs in precision agriculture automating crop research",
    "Research directors at Helmholtz centers seeking AI collaboration",
    "Founders of RegTech startups automating regulatory research",
    "Consortium leads in Horizon Europe missions (cancer, climate, oceans)",
    "Heads of bioinformatics platforms seeking workflow automation",
    "European robotics companies partnering on automated inspection R&D",
    "Leaders of COST Actions on reproducibility and automated verification",
    "CTOs at environmental monitoring SMEs using automated satellite analysis",
    "PIs in EU quantum computing projects needing automated benchmarking",
    "Directors of AI competence centers in Central and Eastern Europe",
    "Research managers at ESA automating Earth observation data pipelines",
    "Coordinators of EuroHPC projects seeking automated optimization tools",
    "SMEs building automated cybersecurity threat research platforms",
    "Heads of translational medicine units automating biomarker discovery",
    "European legal-tech startups automating regulatory compliance research",
    // Research automation partnerships
    "Horizon Europe projects on automated scientific workflow orchestration",
    "Consortiums building AI copilots for researchers and lab scientists",
    "EU-funded projects automating systematic evidence synthesis",
    "Research groups developing automated experiment design platforms",
    "SMEs creating AI-powered research assistant tools for universities",
    "Projects automating multi-language scientific literature translation",
    "Consortiums developing automated research reproducibility tools",
    "Companies building automated grant opportunity matching platforms",
    "EU projects on AI-assisted peer review and manuscript screening",
    "Research infrastructure projects needing automated data pipeline partners",
    "Horizon Europe calls for automated research ethics compliance tools",
    "Consortiums in automated clinical evidence extraction from medical records",
    "Projects developing AI tools for automated research collaboration matching",
    "SMEs building automated competitive intelligence for R&D departments",
    "EU-funded projects on automated scientific figure and chart analysis",
    "Research networks seeking partners for automated knowledge base construction",
    "Projects automating research impact tracking and citation analysis",
    "Consortiums developing automated lab notebook and protocol management",
    "Companies building AI tools for automated research proposal review",
    "EU projects on automated detection of research misconduct and fraud",
    "Partnerships for automated conversion of research papers to structured data",
    "Consortiums needing automated multi-modal research data integration",
    "Projects seeking partners for automated scientific ontology construction",
    "SMEs developing automated research trend forecasting and gap analysis",
    "EU-funded projects on automated generation of research summaries for policymakers",
];

// --- Discovery ---
function initDiscovery() {
    const input = document.getElementById('discovery-topic');
    const btn = document.getElementById('start-discovery');
    const suggestBtn = document.getElementById('suggest-topics');
    const suggestionsDiv = document.getElementById('topic-suggestions');
    const historyDiv = document.getElementById('search-history');
    const resultsDiv = document.getElementById('discovery-results');

    function renderSuggestionChips(items, container) {
        container.style.display = 'block';
        container.innerHTML = items.map(s => `<button class="suggestion-chip">${s}</button>`).join('');
        container.querySelectorAll('.suggestion-chip').forEach(chip => {
            chip.onclick = () => { input.value = chip.textContent; container.style.display = 'none'; };
        });
    }

    // Predefined ideas — toggle with button
    const ideasBtn = document.getElementById('ideas-btn');
    const ideasDiv = document.getElementById('ideas-panel');
    ideasBtn.onclick = () => {
        if (ideasDiv.style.display === 'block') { ideasDiv.style.display = 'none'; return; }
        ideasDiv.style.display = 'block';
        ideasDiv.innerHTML = DEFAULT_SUGGESTIONS.map(s => `<button class="suggestion-chip">${s}</button>`).join('');
        ideasDiv.querySelectorAll('.suggestion-chip').forEach(chip => {
            chip.onclick = () => { input.value = chip.textContent; ideasDiv.style.display = 'none'; };
        });
    };

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
                renderSuggestionChips(suggestions, suggestionsDiv);
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

// --- Investors tab ---
function initInvestors() {
    const listDiv = document.getElementById('investors-list');
    const investors = getInvestors();

    if (!investors.length) {
        listDiv.innerHTML = '<p class="muted">No investors saved yet. Use Discovery to find organizations and click "💰 Investor".</p>';
        return;
    }

    listDiv.innerHTML = investors.map((inv, i) => `
        <div class="project-row">
            <div class="project-info">
                <span class="badge badge-investor">Investor</span>
                <strong>${inv.name}</strong>
                ${inv.website ? `<a href="${inv.website}" target="_blank" class="muted">↗</a>` : ''}
                ${inv.investsIn ? `<span class="muted" style="font-size:0.8rem">— ${inv.investsIn}</span>` : ''}
            </div>
            <div class="project-actions">
                <button class="btn-secondary btn-enrich-inv" data-idx="${i}">🔍 Enrich</button>
                <button class="btn-add btn-add-inv" data-idx="${i}" style="font-size:0.8rem;padding:0.3rem 0.7rem">Add to Leads</button>
                <button class="btn-x" data-idx="${i}">×</button>
            </div>
        </div>`).join('');

    listDiv.querySelectorAll('.btn-enrich-inv').forEach(btn => {
        btn.onclick = async () => {
            const inv = investors[btn.dataset.idx];
            const url = inv.website || inv.contactUrl;
            if (!url) return;
            btn.disabled = true; btn.textContent = '⏳...';
            try {
                const data = await postJsonOrThrow('/api/scrape', { url, depth: 0 });
                // Use the page content to ask LLM about investment focus
                const enrichRes = await postJsonOrThrow('/api/discovery', { topic: `What does ${inv.name} invest in? What sectors, stages, and types of companies? Based on: ${url}` });
                if (Array.isArray(enrichRes) && enrichRes.length) {
                    inv.investsIn = enrichRes.map(r => r.name || r).join(', ').substring(0, 200);
                    saveInvestors(investors);
                    initInvestors();
                }
            } catch {}
            finally { btn.disabled = false; btn.textContent = '🔍 Enrich'; }
        };
    });

    listDiv.querySelectorAll('.btn-add-inv').forEach(btn => {
        btn.onclick = async () => {
            const inv = investors[btn.dataset.idx];
            try {
                await postJsonOrThrow('/api/leads', { name: inv.name, type: 'investor', organization: inv.name, website: inv.website || '', contactUrl: inv.contactUrl || '', source: 'investor list', status: 'New', notes: inv.investsIn ? `Invests in: ${inv.investsIn}` : '' });
                btn.textContent = '✅'; btn.disabled = true;
            } catch (err) { btn.textContent = '❌'; }
        };
    });

    listDiv.querySelectorAll('.btn-x').forEach(btn => {
        btn.onclick = () => { investors.splice(btn.dataset.idx, 1); saveInvestors(investors); initInvestors(); };
    });
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

// --- Projects tab ---
function initProjects() {
    const listDiv = document.getElementById('projects-list');
    const leadsArea = document.getElementById('project-leads-area');
    const projects = getProjects();

    if (!projects.length) {
        listDiv.innerHTML = '<p class="muted">No projects saved yet. Use Discovery to find projects and click "📁 To Projects".</p>';
        return;
    }

    listDiv.innerHTML = projects.map((p, i) => `
        <div class="project-row">
            <div class="project-info">
                <strong>${p.name}</strong>
                ${p.website ? `<a href="${p.website}" target="_blank" class="muted">↗</a>` : ''}
            </div>
            <div class="project-actions">
                <button class="btn-secondary btn-extract" data-idx="${i}">🔍 Extract Leads</button>
                <button class="btn-x" data-idx="${i}">×</button>
            </div>
        </div>`).join('');

    listDiv.querySelectorAll('.btn-extract').forEach(btn => {
        btn.onclick = async () => {
            const p = projects[btn.dataset.idx];
            const url = p.contactUrl || p.website;
            if (!url) { leadsArea.innerHTML = '<div class="error-msg">No URL to scrape</div>'; return; }
            btn.disabled = true; btn.textContent = '⏳...';
            leadsArea.innerHTML = `<p class="muted">Extracting leads from ${p.name}...</p>`;
            try {
                const data = await postJsonOrThrow('/api/scrape', { url, depth: 1 });
                leadsArea.innerHTML = '';
                if (!data.leads?.length) { leadsArea.innerHTML = '<p class="muted">No leads found on this site.</p>'; return; }
                leadsArea.innerHTML = `<p class="muted">${data.leads.length} leads from <strong>${p.name}</strong>:</p>`;
                data.leads.forEach(item => renderLeadCard(item, leadsArea, { source: `project: ${p.name}` }));
            } catch (err) { leadsArea.innerHTML = `<div class="error-msg">❌ ${err.message}</div>`; }
            finally { btn.disabled = false; btn.textContent = '🔍 Extract Leads'; }
        };
    });

    listDiv.querySelectorAll('.btn-x').forEach(btn => {
        btn.onclick = () => {
            projects.splice(btn.dataset.idx, 1);
            saveProjects(projects);
            initProjects();
        };
    });
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
    const factsHtml = lead.keyFacts?.length ? `<div class="modal-field"><span class="modal-label">Key Facts:</span><ul class="key-facts">${lead.keyFacts.map(f => `<li>${f}</li>`).join('')}</ul></div>` : '';
    const msgHtml = lead.contactMessage ? `<div class="modal-field"><span class="modal-label">Suggested Message:</span><div class="contact-msg">${lead.contactMessage}</div></div>` : '';
    const bookingHtml = lead.bookingUrl ? `<div class="modal-field"><span class="modal-label">📅 Booking:</span> <a href="${lead.bookingUrl}" target="_blank">${lead.bookingUrl}</a></div>` : '';
    document.getElementById('modal-body').innerHTML = `
        <div class="modal-field"><span class="modal-label">Type:</span> ${isPerson ? 'Person' : 'Organization'}${lead.score ? ` &nbsp; <span class="score-badge">${lead.score}/100</span>` : ''}</div>
        ${lead.organization ? `<div class="modal-field"><span class="modal-label">Organization:</span> ${lead.organization}</div>` : ''}
        ${lead.email ? `<div class="modal-field"><span class="modal-label">Email:</span> <a href="mailto:${lead.email}">${lead.email}</a></div>` : ''}
        ${lead.linkedin ? `<div class="modal-field"><span class="modal-label">LinkedIn:</span> <a href="${lead.linkedin}" target="_blank">${lead.linkedin}</a></div>` : ''}
        ${lead.website ? `<div class="modal-field"><span class="modal-label">Website:</span> <a href="${lead.website}" target="_blank">${lead.website}</a></div>` : ''}
        ${lead.contactUrl ? `<div class="modal-field"><span class="modal-label">Contact:</span> <a href="${lead.contactUrl}" target="_blank">${lead.contactUrl}</a></div>` : ''}
        ${bookingHtml}
        <div class="modal-field"><span class="modal-label">Source:</span> ${lead.source || 'N/A'}</div>
        ${factsHtml}
        ${msgHtml}
        <div class="form-group"><label>Status:</label><select id="modal-status">${statusOptions}</select></div>
        <div class="form-group"><label>Notes:</label><textarea id="modal-notes" rows="3">${lead.notes || ''}</textarea></div>
        <div id="score-status"></div>
        <div class="modal-actions">
            <button id="modal-score" class="btn-secondary">🔍 Score & Enrich</button>
            <button id="modal-save">Save Changes</button>
            <button id="modal-delete" class="btn-danger">Delete</button>
        </div>`;
    document.getElementById('modal-score').onclick = async () => {
        const scoreStatus = document.getElementById('score-status');
        scoreStatus.innerHTML = '<span class="muted">⏳ Analyzing profile...</span>';
        document.getElementById('modal-score').disabled = true;
        try {
            const result = await postJsonOrThrow('/api/leads/score', { leadId: lead.id });
            // Refresh lead data and re-render modal
            Object.assign(lead, result.updates);
            openLeadModal(lead);
            showSaveToast(`Scored ${lead.name}: ${result.score}/100`);
        } catch (err) { scoreStatus.innerHTML = `<span class="error-msg">❌ ${err.message}</span>`; }
        finally { const btn = document.getElementById('modal-score'); if (btn) btn.disabled = false; }
    };
    document.getElementById('modal-save').onclick = async () => {
        const newStatus = document.getElementById('modal-status').value;
        const newNotes = document.getElementById('modal-notes').value;
        await apiFetch(`/api/leads/${lead.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus, notes: newNotes }) });
        // Update local state
        lead.status = newStatus;
        lead.notes = newNotes;
        modal.style.display = 'none';
        renderLeadsList();
        showSaveToast(`${lead.name} → ${newStatus}`);
    };
    document.getElementById('modal-delete').onclick = async () => {
        if (!confirm('Delete this lead?')) return;
        await apiFetch(`/api/leads/${lead.id}`, { method: 'DELETE' });
        state.leads = state.leads.filter(l => l.id !== lead.id);
        modal.style.display = 'none';
        renderLeadsList();
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
        const badge = isPerson ? '<span class="badge badge-person">Person</span>'
            : lead.type === 'investor' ? '<span class="badge badge-investor">Investor</span>'
            : '<span class="badge badge-org">Org</span>';
        const statusClass = lead.status === 'Contacted' ? 'status-contacted' : lead.status === 'Not Interested' ? 'status-rejected' : 'status-new';
        const link = isPerson
            ? (lead.linkedin ? `<a href="${lead.linkedin}" target="_blank">LinkedIn ↗</a>` : (lead.email ? `<a href="mailto:${lead.email}">${lead.email}</a>` : ''))
            : (lead.contactUrl ? `<a href="${lead.contactUrl}" target="_blank">Contact ↗</a>` : (lead.website ? `<a href="${lead.website}" target="_blank">Website ↗</a>` : ''));
        const notIntBtn = lead.status !== 'Not Interested' ? `<button class="btn-not-interested" data-id="${lead.id}" title="Not Interested">✕</button>` : '';
        return `<div class="lead-row" data-id="${lead.id}">
            <div class="lead-main">${badge}<strong>${lead.name || 'N/A'}</strong>${lead.score ? ` <span class="score-badge">${lead.score}</span>` : ''}</div>
            <div class="lead-contact">${link || '<span class="muted">—</span>'}</div>
            <div class="lead-status"><span class="status-badge ${statusClass}">${lead.status || 'New'}</span></div>
            <div class="lead-source muted">${lead.source || ''}</div>
            <div class="lead-quick">${notIntBtn}</div>
        </div>`;
    }).join('');

    // Quick "Not Interested" buttons — stop propagation so row click doesn't fire
    container.querySelectorAll('.btn-not-interested').forEach(btn => {
        btn.onclick = async (e) => {
            e.stopPropagation();
            await apiFetch(`/api/leads/${btn.dataset.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Not Interested' }) });
            const lead = state.leads.find(l => l.id === btn.dataset.id);
            if (lead) lead.status = 'Not Interested';
            renderLeadsList();
        };
    });

    container.querySelectorAll('.lead-row').forEach(row => {
        row.onclick = () => { const lead = state.leads.find(l => l.id === row.dataset.id); if (lead) openLeadModal(lead); };
    });
}

function initLeads() {
    loadLeads();
    // Default filter to "New"
    const statusFilter = document.getElementById('filter-status');
    if (statusFilter && !statusFilter._initialized) { statusFilter.value = 'New'; statusFilter._initialized = true; }
    document.getElementById('filter-status')?.addEventListener('change', renderLeadsList);
    document.getElementById('filter-type')?.addEventListener('change', renderLeadsList);

    const importBtn = document.getElementById('import-leads-btn');
    const exportBtn = document.getElementById('export-leads-btn');
    const importFile = document.getElementById('import-leads-file');
    const importStatus = document.getElementById('import-status');
    exportBtn.onclick = async () => {
        const res = await apiFetch('/api/leads/export');
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `leads-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
    };
    importBtn.onclick = () => importFile.click();
    importFile.onchange = async () => {
        const file = importFile.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            const res = await postJsonOrThrow('/api/leads/import', data);
            importStatus.innerHTML = `<span class="status-ok">✅ Added ${res.added}, updated ${res.updated} (total: ${res.total})</span>`;
            // Reset filter to All so imported leads are visible
            const statusFilter = document.getElementById('filter-status');
            if (statusFilter) statusFilter.value = '';
            loadLeads();
        } catch (err) { importStatus.innerHTML = `<span class="error-msg">❌ ${err.message}</span>`; }
        importFile.value = '';
    };
}

// --- Settings ---
async function loadSettings() {
    const res = await apiFetch('/api/config');
    if (!res.ok) return;
    state.config = await res.json();

    const modelsRes = await apiFetch('/api/models');
    if (!modelsRes.ok) return;
    const models = await modelsRes.json();
    const allModels = [...models.fast || [], ...models.deep || []]
        .filter(m => m.tags && m.tags.length > 0);
    function modelLabel(m) {
        const tags = m.tags.join(', ');
        if (m.isFree) return `${m.name} (${tags} · free)`;
        if (m.billingType === 'subscription') return `${m.name} (${tags} · subscription)`;
        return `${m.name} (${tags} · api key)`;
    }
    const opts = allModels.map(m => `<option value="${m.name}">${modelLabel(m)}</option>`).join('');

    const llm = document.getElementById('llm-settings');
    if (llm) {
        const tasks = ['discovery', 'suggest', 'extraction', 'parse', 'scoring'];
        llm.innerHTML = tasks.map(t => `
            <div class="form-group"><label>${t.charAt(0).toUpperCase() + t.slice(1)}:</label>
            <div class="flex-row"><select id="config-${t}">${opts}</select>
            <button class="btn-test" data-task="${t}">Test</button>
            <span id="test-status-${t}" class="test-status"></span></div></div>`).join('');
        tasks.forEach(t => {
            const tc = state.config.tasks?.[t] || {};
            const val = tc.model || '';
            const sel = document.getElementById(`config-${t}`);
            if (sel) {
                if (val) {
                    sel.value = val;
                    if (sel.value !== val) {
                        sel.insertAdjacentHTML('beforeend', `<option value="${val}" selected>${val} (saved)</option>`);
                        sel.value = val;
                    }
                }
                // If nothing saved or value didn't match, keep first option selected
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

    // Contact template
    const tplEl = document.getElementById('contact-template');
    tplEl.value = state.config.contactTemplate || '';
    let tplTimer;
    tplEl.oninput = () => {
        clearTimeout(tplTimer);
        tplTimer = setTimeout(async () => {
            state.config.contactTemplate = tplEl.value;
            await postJson('/api/config', { contactTemplate: tplEl.value });
            showSaveToast('Contact template saved');
        }, 1000);
    };

    document.getElementById('change-password-btn').onclick = async () => {
        const cur = document.getElementById('current-password').value;
        const nw = document.getElementById('new-password').value;
        const statusEl = document.getElementById('password-status');
        try {
            const res = await postJsonOrThrow('/api/change-password', { currentPassword: cur, newPassword: nw });
            state.token = res.token;
            localStorage.setItem('token', res.token);
            document.getElementById('current-password').value = '';
            document.getElementById('new-password').value = '';
            statusEl.innerHTML = `<span class="status-ok">✅ ${nw ? 'Password changed' : 'Password removed'}</span>`;
        } catch (err) { statusEl.innerHTML = `<span class="error-msg">❌ ${err.message}</span>`; }
    };
}

async function testModel(task) {
    const val = document.getElementById(`config-${task}`).value;
    const span = document.getElementById(`test-status-${task}`);
    if (!val) { span.textContent = '❌ Select model'; return; }
    span.textContent = '⏳'; span.className = 'test-status testing';
    const payload = val ? { model: val } : { tier: 'fast' };
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
    ['discovery', 'suggest', 'extraction', 'parse', 'scoring'].forEach(t => {
        const val = document.getElementById(`config-${t}`)?.value || '';
        tasks[t] = val ? { model: val } : { tier: 'fast' };
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
    if (tabId === 'projects') initProjects();
    if (tabId === 'investors') initInvestors();
    if (tabId === 'scraper') initScraper();
    if (tabId === 'leads') initLeads();
    if (tabId === 'settings') initSettings();
}
tabs.forEach(t => t.addEventListener('click', () => renderTab(t.dataset.tab)));
renderTab('discovery');
