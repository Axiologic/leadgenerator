import { LLMAgent } from '../../AchillesAgentLib/LLMAgents/LLMAgent.mjs';
import { Storage } from './storage.mjs';

async function fetchUrl(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    return await res.text();
}

function extractLinks(html, baseUrl) {
    const links = [];
    const regex = /href="([^"]+)"/g;
    let match;
    const base = new URL(baseUrl);
    while ((match = regex.exec(html)) !== null) {
        let link = match[1];
        if (link.startsWith('/')) {
            link = base.origin + link;
        } else if (!link.startsWith('http')) {
            link = base.origin + base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1) + link;
        }
        
        try {
            const url = new URL(link);
            if (url.hostname === base.hostname) {
                links.push(link);
            }
        } catch {}
    }
    return [...new Set(links)];
}

export class MarketingAgent {
    constructor(config) {
        this.config = config;
        this.agents = {};
    }

    async getAgentForTask(task) {
        if (this.agents[task]) return this.agents[task];
        
        const taskConfig = this.config.tasks[task] || { tier: 'fast' };
        const agent = new LLMAgent({
            name: `MarketingAgent-${task}`,
            ...taskConfig
        });
        this.agents[task] = agent;
        return agent;
    }

    async recursiveScrape(startUrl, depth = 2, maxPages = 20) {
        const visited = new Set();
        const queue = [{ url: startUrl, d: 0 }];
        const leads = [];
        const cache = await Storage.getCache();

        while (queue.length > 0 && visited.size < maxPages) {
            const { url, d } = queue.shift();
            if (visited.has(url)) continue;
            visited.add(url);

            console.log(`Scraping ${url} at depth ${d}...`);
            
            let content;
            if (cache[url]) {
                content = cache[url];
            } else {
                try {
                    content = await fetchUrl(url);
                    cache[url] = content;
                    await Storage.saveCache(cache);
                } catch (err) {
                    console.error(`Failed to fetch ${url}: ${err.message}`);
                    continue;
                }
            }

            const extractedLeads = await this.extractLeads(content, url);
            leads.push(...extractedLeads);

            if (d < depth) {
                const links = extractLinks(content, url);
                for (const link of links) {
                    if (!visited.has(link)) {
                        queue.push({ url: link, d: d + 1 });
                    }
                }
            }
        }

        return leads;
    }

    async extractLeads(content, sourceUrl) {
        const agent = await this.getAgentForTask('extraction');
        const prompt = `
            Extract any potential marketing leads from the following web content.
            A lead should be a person or an organization.
            For each lead, try to find:
            - Name
            - Organization
            - Email
            - LinkedIn profile URL
            
            Content from ${sourceUrl}:
            ---
            ${content.substring(0, 10000)} 
            ---
            
            Return the result as a JSON array of objects. If no leads found, return [].
            Example: [{"name": "John Doe", "organization": "ACME Corp", "email": "john@example.com", "linkedin": "..."}]
        `;

        try {
            const result = await agent.executePrompt(prompt, { responseShape: 'json' });
            return (Array.isArray(result) ? result : []).map(l => ({ ...l, source: sourceUrl }));
        } catch (err) {
            console.error(`Lead extraction failed: ${err.message}`);
            return [];
        }
    }

    async discoverLeads(topic) {
        const agent = await this.getAgentForTask('discovery');
        const prompt = `
            Identify 5-10 organizations or key individuals involved in "${topic}".
            For each, provide their name and a likely website or LinkedIn search query.
            Return as a JSON array: [{"name": "...", "query": "..."}]
        `;
        
        try {
            const discovery = await agent.executePrompt(prompt, { responseShape: 'json' });
            // For now, discovery just returns names and queries.
            // In a full implementation, we would then use these to search and scrape.
            return discovery;
        } catch (err) {
            console.error(`Discovery failed: ${err.message}`);
            return [];
        }
    }
}
