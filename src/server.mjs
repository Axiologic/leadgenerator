import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { Storage } from './storage.mjs';
import { listModelsFromCache } from '../../AchillesAgentLib/utils/LLMClient.mjs';
import { MarketingAgent } from './marketingAgent.mjs';

const PORT = 3000;
const PUBLIC_DIR = path.resolve('src/public');

const startupModels = listModelsFromCache();
if (!startupModels.fast.length && !startupModels.deep.length) {
    console.error('[leadgenerator] No LLM models available. Check that a valid API key is set (e.g. SOUL_GATEWAY_API_KEY) in a .env file or environment.');
}

async function serveFile(res, filePath) {
    try {
        const stats = await fs.stat(filePath);
        if (stats.isDirectory()) filePath = path.join(filePath, 'index.html');
        const data = await fs.readFile(filePath);
        const ext = path.extname(filePath);
        const types = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif' };
        res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
        res.end(data);
    } catch { res.writeHead(404); res.end('Not Found'); }
}

async function handleApi(req, res) {
    const { method, url } = req;
    const body = await new Promise(r => { let c = ''; req.on('data', d => c += d); req.on('end', () => r(c)); });
    const sendJson = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };

    const config = await Storage.getConfig();
    const token = (req.headers['authorization'] || '').replace('Bearer ', '');
    const isAuth = !config.passwordHash || token === config.passwordHash;

    if (url === '/api/login' && method === 'POST') {
        const { password } = JSON.parse(body);
        return (password === config.passwordHash || !config.passwordHash)
            ? sendJson({ token: password })
            : sendJson({ error: 'Invalid password' }, 401);
    }
    if (!isAuth && !url.startsWith('/api/login')) return sendJson({ error: 'Unauthorized' }, 401);

    try {
        // Leads CRUD
        if (url === '/api/leads' && method === 'GET') return sendJson(await Storage.getLeads());
        if (url === '/api/leads' && method === 'POST') {
            const leads = await Storage.getLeads();
            const newLead = JSON.parse(body);
            newLead.id = Date.now().toString();
            newLead.createdAt = new Date().toISOString();
            leads.push(newLead);
            await Storage.saveLeads(leads);
            return sendJson(newLead);
        }
        if (url.startsWith('/api/leads/') && method === 'PATCH') {
            const id = url.split('/').pop();
            const updated = await Storage.updateLead(id, JSON.parse(body));
            return updated ? sendJson(updated) : sendJson({ error: 'Not found' }, 404);
        }
        if (url.startsWith('/api/leads/') && method === 'DELETE') {
            const id = url.split('/').pop();
            const deleted = await Storage.deleteLead(id);
            return deleted ? sendJson({ success: true }) : sendJson({ error: 'Not found' }, 404);
        }

        // Config
        if (url === '/api/config' && method === 'GET') {
            const { passwordHash, ...rest } = config;
            return sendJson(rest);
        }
        if (url === '/api/config' && method === 'POST') {
            await Storage.saveConfig({ ...config, ...JSON.parse(body) });
            return sendJson({ success: true });
        }

        // Models
        if (url === '/api/models' && method === 'GET') return sendJson(listModelsFromCache());

        // Test model
        if (url === '/api/test-model' && method === 'POST') {
            const { model, tier } = JSON.parse(body);
            const agent = new MarketingAgent({ tasks: { test: { model, tier } } });
            try {
                const testAgent = await agent.getAgentForTask('test');
                const response = await testAgent.executePrompt("Respond with exactly one word: 'OK'", { tier, model });
                return sendJson({ success: response.trim().toUpperCase().includes('OK'), response });
            } catch (err) { return sendJson({ success: false, error: err.message }); }
        }

        // Discovery
        if (url === '/api/discovery' && method === 'POST') {
            const { topic } = JSON.parse(body);
            const agent = new MarketingAgent(config);
            try {
                const results = await agent.discoverLeads(topic);
                return sendJson(results);
            } catch (err) { return sendJson({ error: err.message }, 502); }
        }

        // Suggest topics
        if (url === '/api/suggest-topics' && method === 'POST') {
            const { topic, history } = JSON.parse(body || '{}');
            const agent = new MarketingAgent(config);
            try {
                const results = await agent.suggestTopics(topic, history);
                return sendJson(results);
            } catch (err) { return sendJson({ error: err.message }, 502); }
        }

        // Scrape with pagination
        if (url === '/api/scrape' && method === 'POST') {
            const { url: startUrl, depth, visited, queue, knownNames } = JSON.parse(body || '{}');
            const agent = new MarketingAgent(config);
            try {
                const result = await agent.recursiveScrape(startUrl, parseInt(depth) || 2, 10, visited || [], queue || null, knownNames || []);
                return sendJson(result);
            } catch (err) { return sendJson({ error: err.message }, 502); }
        }

        res.writeHead(404); res.end('API Not Found');
    } catch (err) { console.error(err); sendJson({ error: 'Internal Server Error' }, 500); }
}

const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/api')) return handleApi(req, res);
    await serveFile(res, path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url));
});

server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
