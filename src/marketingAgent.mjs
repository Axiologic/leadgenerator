import { LLMAgent } from '../../AchillesAgentLib/LLMAgents/LLMAgent.mjs';
import { getCached, getCachedBinary, putCache, putCacheBinary, extractTextFromPDF, extractTextFromDOCX } from './pageCache.mjs';

function extractJsonArray(raw) {
    if (!raw || typeof raw !== 'string') return null;
    try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch {}
    const fm = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (fm) try { const p = JSON.parse(fm[1]); if (Array.isArray(p)) return p; } catch {}
    const s = raw.indexOf('['), e = raw.lastIndexOf(']');
    if (s !== -1 && e > s) try { const p = JSON.parse(raw.substring(s, e + 1)); if (Array.isArray(p)) return p; } catch {}
    const lines = raw.split('\n').map(l => l.replace(/^[\d\.\)\-\*]+\s*/, '').replace(/^["'`]+|["'`]+$/g, '').trim())
        .filter(l => l.length > 8 && l.length < 200 && !/^(example|query \d|here|sure|return)/i.test(l));
    if (lines.length >= 3) return lines.slice(0, 10);
    return null;
}

async function fetchPage(url) {
    const isPdf = /\.pdf(\?|$)/i.test(url);
    const isDocx = /\.docx?(\?|$)/i.test(url);

    if (isPdf || isDocx) {
        let buf = await getCachedBinary(url);
        if (!buf) {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            buf = Buffer.from(await res.arrayBuffer());
            await putCacheBinary(url, buf);
        }
        return isPdf ? extractTextFromPDF(buf) : extractTextFromDOCX(buf);
    }

    let html = await getCached(url);
    if (!html) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        html = await res.text();
        await putCache(url, html);
    }
    return html;
}

/** Strip boilerplate (nav, footer, scripts, styles, headers) and extract main text content */
function extractMainContent(html) {
    if (!html.includes('<')) return html; // Already plain text (PDF/DOCX)
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<aside[\s\S]*?<\/aside>/gi, '')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function extractLinks(html, baseUrl) {
    const links = [];
    const regex = /href="([^"]+)"/g;
    let match;
    const base = new URL(baseUrl);
    while ((match = regex.exec(html)) !== null) {
        let link = match[1];
        if (link.startsWith('/')) link = base.origin + link;
        else if (!link.startsWith('http')) link = base.origin + base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1) + link;
        try { if (new URL(link).hostname === base.hostname) links.push(link); } catch {}
    }
    return [...new Set(links)];
}

export class MarketingAgent {
    constructor(config) {
        this.config = config;
        this.agents = {};
    }

    _taskOpts(task) {
        const tc = this.config.tasks?.[task] || {};
        const opts = { tier: tc.tier || 'fast' };
        if (tc.model) opts.model = tc.model;
        return opts;
    }

    async getAgentForTask(task) {
        if (this.agents[task]) return this.agents[task];
        const agent = new LLMAgent({ name: `MarketingAgent-${task}` });
        agent._taskConfig = this.config.tasks?.[task] || { tier: 'fast' };
        this.agents[task] = agent;
        return agent;
    }

    async _promptJson(task, prompt) {
        const agent = await this.getAgentForTask(task);
        const raw = await agent.executePrompt(prompt, this._taskOpts(task));
        const parsed = extractJsonArray(raw);
        if (parsed) return parsed;
        throw new Error(`Could not parse LLM response. Raw: ${raw.substring(0, 150)}...`);
    }

    async suggestTopics(currentTopic, history = []) {
        const historyCtx = history.length ? `\nPreviously searched: ${history.join(', ')}. Suggest different queries.` : '';
        const prompt = currentTopic
            ? `Suggest 5 specific search queries for finding marketing leads related to "${currentTopic}".${historyCtx} Return ONLY a JSON array of strings.`
            : `Suggest 5 specific search queries for finding marketing leads across tech, biotech, EU research, fintech.${historyCtx} Return ONLY a JSON array of strings.`;
        return this._promptJson('suggest', prompt);
    }

    async discoverLeads(topic) {
        const prompt = `Identify 5-10 organizations or key individuals involved in "${topic}".
For each determine if it is a "person" or "organization".
Organizations: name, website URL, contact page URL.
Persons: name, email (if known), LinkedIn profile URL.
Return ONLY a JSON array:
[{"type":"organization","name":"...","website":"...","contactUrl":"..."},
 {"type":"person","name":"...","email":"...","linkedin":"..."}]`;
        return this._promptJson('discovery', prompt);
    }

    /**
     * Scrape with pagination and deduplication.
     */
    async recursiveScrape(startUrl, depth = 2, maxPages = 10, visited = [], queue = null, knownNames = []) {
        const visitedSet = new Set(visited);
        const nameSet = new Set(knownNames.map(n => n.toLowerCase()));
        const workQueue = queue || [{ url: startUrl, d: 0 }];
        const leads = [];
        let processed = 0;

        while (workQueue.length > 0 && processed < maxPages) {
            const { url, d } = workQueue.shift();
            if (visitedSet.has(url)) continue;
            visitedSet.add(url);
            processed++;
            console.log(`Scraping [${processed}/${maxPages}] ${url} (depth ${d})`);

            let content;
            try { content = await fetchPage(url); }
            catch (err) { console.error(`Failed to fetch ${url}: ${err.message}`); continue; }

            if (content.length > 100) {
                const extracted = await this.extractLeads(content, url);
                for (const lead of extracted) {
                    const key = (lead.name || '').toLowerCase().trim();
                    if (key && !nameSet.has(key)) {
                        nameSet.add(key);
                        leads.push(lead);
                    }
                }
            }

            if (d < depth) {
                for (const link of extractLinks(content, url)) {
                    if (!visitedSet.has(link)) workQueue.push({ url: link, d: d + 1 });
                }
            }
        }

        return {
            leads,
            visited: [...visitedSet],
            knownNames: [...nameSet],
            hasMore: workQueue.length > 0,
            queue: workQueue,
        };
    }

    async extractLeads(content, sourceUrl) {
        const agent = await this.getAgentForTask('extraction');
        const text = extractMainContent(content).substring(0, 8000);
        if (text.length < 50) return [];
        const prompt = `Extract SPECIFIC people and organizations from this page content that could be marketing leads.
Do NOT include the website owner itself or generic entities like "European Commission" unless they are a specific contact.
Look for: project coordinators, researchers, partner companies, contact persons.
For each: type ("person"/"organization"), name, email, linkedin, website, contactUrl.
Content from ${sourceUrl}:
---
${text}
---
Return ONLY a JSON array. If no specific leads found, return [].`;
        try {
            const raw = await agent.executePrompt(prompt, this._taskOpts('extraction'));
            const parsed = extractJsonArray(raw);
            return (parsed || []).map(l => ({ ...l, source: sourceUrl }));
        } catch (err) {
            console.error(`Extraction failed for ${sourceUrl}: ${err.message}`);
            return [];
        }
    }
}
