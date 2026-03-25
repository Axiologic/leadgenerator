import { runPipeline, createAgent, callLLM, extractJsonArray, parseWithLLM, LEADS_SCHEMA, SUGGESTIONS_SCHEMA, buildOpts } from './llmPipeline.mjs';
import { getCached, getCachedBinary, putCache, putCacheBinary, extractTextFromPDF, extractTextFromDOCX } from './pageCache.mjs';

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

function extractMainContent(html) {
    if (!html.includes('<')) return html;
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
    }

    async suggestTopics(currentTopic, history = []) {
        const historyCtx = history.length ? `\nPreviously searched: ${history.join(', ')}. Suggest different queries.` : '';
        const prompt = currentTopic
            ? `Suggest 5 specific search queries for finding marketing leads related to "${currentTopic}".${historyCtx} Return ONLY a JSON array of strings.`
            : `Suggest 5 specific search queries for finding marketing leads across tech, biotech, EU research, fintech.${historyCtx} Return ONLY a JSON array of strings.`;
        return runPipeline(this.config, 'suggest', prompt, SUGGESTIONS_SCHEMA);
    }

    async discoverLeads(topic) {
        const prompt = `Identify 5-10 relevant entities for "${topic}".
Classify each as "person", "organization", or "project" (research projects, consortiums, associations, industry groups with partner/member pages).
Persons: name, email, linkedin URL.
Organizations: name, website, contactUrl.
Projects/consortiums: name, website, contactUrl (partners page URL if available).
Return ONLY a JSON array:
[{"type":"project","name":"...","website":"...","contactUrl":"..."},
 {"type":"organization","name":"...","website":"...","contactUrl":"..."},
 {"type":"person","name":"...","email":"...","linkedin":"..."}]`;
        return runPipeline(this.config, 'discovery', prompt, LEADS_SCHEMA);
    }

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
                    if (key && !nameSet.has(key)) { nameSet.add(key); leads.push(lead); }
                }
            }

            if (d < depth) {
                for (const link of extractLinks(content, url)) {
                    if (!visitedSet.has(link)) workQueue.push({ url: link, d: d + 1 });
                }
            }
        }

        return { leads, visited: [...visitedSet], knownNames: [...nameSet], hasMore: workQueue.length > 0, queue: workQueue };
    }

    async extractLeads(content, sourceUrl) {
        const text = extractMainContent(content).substring(0, 8000);
        if (text.length < 50) return [];
        const prompt = `Extract SPECIFIC people and organizations from this page that could be marketing leads.
Do NOT include the website owner or generic entities unless they are a specific contact.
Look for: project coordinators, researchers, partner companies, contact persons.
For each: type ("person"/"organization"), name, email, linkedin, website, contactUrl.
Content from ${sourceUrl}:
---
${text}
---
Return ONLY a JSON array. If no specific leads found, return [].`;
        try {
            const { agent, opts } = createAgent('extraction', this.config.tasks?.extraction);
            const raw = await callLLM(agent, prompt, opts);
            let parsed = extractJsonArray(raw);
            if (!parsed) {
                try {
                    const { agent: pa, opts: po } = createAgent('parse', this.config.tasks?.parse);
                    parsed = await parseWithLLM(raw, pa, po, LEADS_SCHEMA);
                } catch { parsed = []; }
            }
            return (parsed || []).filter(l => l.name && l.name !== 'Unknown' && l.name !== '...').map(l => ({ ...l, source: sourceUrl }));
        } catch (err) {
            console.error(`Extraction failed for ${sourceUrl}: ${err.message}`);
            return [];
        }
    }

    /**
     * Score a lead: fetch their profile page, analyze relevance, detect signals, generate contact message.
     */
    async scoreLead(lead, contactTemplate) {
        // Gather profile content
        const urls = [lead.linkedin, lead.website, lead.contactUrl].filter(Boolean);
        let profileText = '';
        for (const url of urls) {
            try {
                const content = await fetchPage(url);
                profileText += extractMainContent(content).substring(0, 4000) + '\n---\n';
            } catch {}
        }
        if (!profileText.trim()) profileText = `Name: ${lead.name}, Type: ${lead.type}, Organization: ${lead.organization || 'unknown'}`;

        const { agent, opts } = createAgent('scoring', this.config.tasks?.scoring);
        const prompt = `You are a lead scoring assistant. Analyze this lead and our offer, then provide a structured assessment.

OUR OFFER/INTENTION:
${contactTemplate || 'No contact template configured.'}

LEAD PROFILE:
Name: ${lead.name}
Type: ${lead.type}
${lead.organization ? 'Organization: ' + lead.organization : ''}
${lead.email ? 'Email: ' + lead.email : ''}

PROFILE CONTENT FROM THEIR PAGES:
${profileText.substring(0, 6000)}

INSTRUCTIONS:
1. Score relevance 0-100 (how well does this lead match our offer?)
2. Check if their profile indicates they DON'T want to be contacted (e.g., "no solicitation", "do not contact")
3. Check for scheduling/booking links (calendly.com, cal.com, hubspot.com/meetings, savvycal.com, tidycal.com, acuityscheduling.com, zcal.co, koalendar.com, appointlet.com, doodle.com, youcanbook.me)
4. Extract key facts about them (role, expertise, recent projects)
5. Write a short personalized contact message based on our template

Return ONLY a JSON object:
{
  "score": 0-100,
  "noContact": true/false,
  "noContactReason": "reason or null",
  "hasBookingLink": true/false,
  "bookingUrl": "url or null",
  "keyFacts": ["fact1", "fact2"],
  "suggestedStatus": "Contacted" or "Not Interested",
  "contactMessage": "personalized message"
}`;

        const raw = await agent.executePrompt(prompt, opts);
        // Parse JSON from response
        let parsed;
        try { parsed = JSON.parse(raw); } catch {}
        if (!parsed) {
            const fm = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
            if (fm) try { parsed = JSON.parse(fm[1]); } catch {}
        }
        if (!parsed) {
            const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
            if (s !== -1 && e > s) try { parsed = JSON.parse(raw.substring(s, e + 1)); } catch {}
        }
        if (!parsed) {
            // Fallback to parse model
            const { agent: pa, opts: po } = createAgent('parse', this.config.tasks?.parse);
            const parseResult = await pa.executePrompt(`Convert this to a JSON object with fields: score (number), noContact (boolean), noContactReason (string|null), hasBookingLink (boolean), bookingUrl (string|null), keyFacts (string array), suggestedStatus (string), contactMessage (string).

Text: ${raw.substring(0, 3000)}

Return ONLY the JSON object.`, po);
            try { parsed = JSON.parse(parseResult); } catch {}
            if (!parsed) {
                const s2 = parseResult.indexOf('{'), e2 = parseResult.lastIndexOf('}');
                if (s2 !== -1 && e2 > s2) try { parsed = JSON.parse(parseResult.substring(s2, e2 + 1)); } catch {}
            }
        }
        if (!parsed) throw new Error('Could not parse scoring response');

        const updates = {
            score: Math.max(0, Math.min(100, parseInt(parsed.score) || 0)),
            keyFacts: parsed.keyFacts || [],
            contactMessage: parsed.contactMessage || '',
            bookingUrl: parsed.bookingUrl || '',
        };
        if (parsed.noContact) {
            updates.status = 'Not Interested';
            updates.notes = (lead.notes || '') + `\n[Auto] No contact: ${parsed.noContactReason || 'profile indicates no solicitation'}`.trim();
        } else if (parsed.hasBookingLink && parsed.bookingUrl) {
            updates.score = Math.max(updates.score, 80);
            updates.notes = (lead.notes || '') + `\n[Auto] Has booking link: ${parsed.bookingUrl}`.trim();
        }

        return { ...parsed, updates };
    }

    // Kept for test-model endpoint
    async getAgentForTask(task) {
        const { agent } = createAgent(task, this.config.tasks?.[task]);
        return agent;
    }
}
