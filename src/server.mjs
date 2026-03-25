import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { Storage } from './storage.mjs';
import { listModelsFromCache } from '../../AchillesAgentLib/utils/LLMClient.mjs';
import { MarketingAgent } from './marketingAgent.mjs';

const PORT = 3000;
const PUBLIC_DIR = path.resolve('src/public');

async function serveFile(res, filePath) {
    try {
        const stats = await fs.stat(filePath);
        if (stats.isDirectory()) {
            filePath = path.join(filePath, 'index.html');
        }
        const data = await fs.readFile(filePath);
        const ext = path.extname(filePath);
        const contentTypes = {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.mjs': 'application/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.gif': 'image/gif',
        };
        res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
        res.end(data);
    } catch (err) {
        res.writeHead(404);
        res.end('Not Found');
    }
}

async function handleApi(req, res) {
    const { method, url } = req;
    const body = await new Promise((resolve) => {
        let chunk = '';
        req.on('data', (c) => chunk += c);
        req.on('end', () => resolve(chunk));
    });

    const sendJson = (data, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    };

    const config = await Storage.getConfig();
    const authHeader = req.headers['authorization'];
    const token = authHeader ? authHeader.replace('Bearer ', '') : '';
    
    // Check if password is set and if user is authenticated
    const isAuth = !config.passwordHash || token === config.passwordHash;

    if (url === '/api/login' && method === 'POST') {
        const { password } = JSON.parse(body);
        // In a real app, use a proper hash like bcrypt
        // For this lightweight app, we use the password itself as a "hash" for simplicity
        if (password === config.passwordHash || !config.passwordHash) {
            return sendJson({ token: password });
        }
        return sendJson({ error: 'Invalid password' }, 401);
    }

    if (!isAuth && !url.startsWith('/api/login')) {
        return sendJson({ error: 'Unauthorized' }, 401);
    }

    try {
        if (url === '/api/leads' && method === 'GET') {
            return sendJson(await Storage.getLeads());
        }
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
            const updates = JSON.parse(body);
            const updated = await Storage.updateLead(id, updates);
            return sendJson(updated);
        }
        if (url === '/api/config' && method === 'GET') {
            const config = await Storage.getConfig();
            const { passwordHash, ...rest } = config; // Don't send hash
            return sendJson(rest);
        }
        if (url === '/api/config' && method === 'POST') {
            const updates = JSON.parse(body);
            const config = await Storage.getConfig();
            await Storage.saveConfig({ ...config, ...updates });
            return sendJson({ success: true });
        }
        if (url === '/api/models' && method === 'GET') {
            const models = listModelsFromCache();
            return sendJson(models);
        }
        if (url === '/api/discovery' && method === 'POST') {
            const { topic } = JSON.parse(body);
            const config = await Storage.getConfig();
            const agent = new MarketingAgent(config);
            const results = await agent.discoverLeads(topic);
            return sendJson(results);
        }
        if (url === '/api/scrape' && method === 'POST') {
            const { url: startUrl, depth } = JSON.parse(body || '{}');
            const config = await Storage.getConfig();
            const agent = new MarketingAgent(config);
            const leads = await agent.recursiveScrape(startUrl, parseInt(depth) || 2);
            
            const existing = await Storage.getLeads();
            for (const lead of leads) {
                lead.id = Date.now().toString() + Math.random().toString(36).substring(7);
                lead.createdAt = new Date().toISOString();
                existing.push(lead);
            }
            await Storage.saveLeads(existing);
            
            return sendJson(leads);
        }

        res.writeHead(404);
        res.end('API Not Found');
    } catch (err) {
        console.error(err);
        sendJson({ error: 'Internal Server Error' }, 500);
    }
}

const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/api')) {
        return handleApi(req, res);
    }
    const filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);
    await serveFile(res, filePath);
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
