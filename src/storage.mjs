import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.resolve('data');

const FILES = {
    LEADS: path.join(DATA_DIR, 'leads.json'),
    CACHE: path.join(DATA_DIR, 'cache.json'),
    CONFIG: path.join(DATA_DIR, 'config.json'),
};

const DEFAULT_CONFIG = {
    passwordHash: null,
    scoring: {
        keywords: {
            "innovation": 10,
            "research": 5,
            "eu": 15
        }
    },
    tasks: {
        discovery: { tier: 'fast' },
        extraction: { tier: 'fast' },
        scoring: { tier: 'fast' }
    }
};

async function ensureDir() {
    try {
        await fs.access(DATA_DIR);
    } catch {
        await fs.mkdir(DATA_DIR, { recursive: true });
    }
}

async function readJson(filePath, defaultValue = []) {
    await ensureDir();
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            await fs.writeFile(filePath, JSON.stringify(defaultValue, null, 2));
            return defaultValue;
        }
        throw error;
    }
}

async function writeJson(filePath, data) {
    await ensureDir();
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

export const Storage = {
    getLeads: () => readJson(FILES.LEADS, []),
    saveLeads: (leads) => writeJson(FILES.LEADS, leads),
    
    getCache: () => readJson(FILES.CACHE, {}),
    saveCache: (cache) => writeJson(FILES.CACHE, cache),
    
    getConfig: () => readJson(FILES.CONFIG, DEFAULT_CONFIG),
    saveConfig: (config) => writeJson(FILES.CONFIG, config),
    
    async updateLead(id, updates) {
        const leads = await this.getLeads();
        const index = leads.findIndex(l => l.id === id);
        if (index !== -1) {
            leads[index] = { ...leads[index], ...updates };
            await this.saveLeads(leads);
            return leads[index];
        }
        return null;
    }
};
