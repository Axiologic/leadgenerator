/**
 * llmPipeline.mjs — Modular LLM pipeline for search → parse → structured JSON.
 * 
 * Two-step pipeline:
 * 1. Primary model (search/instruct) generates raw output
 * 2. If raw output isn't valid JSON, parse model structures it
 */
import { LLMAgent } from 'achillesAgentLib/LLMAgents';

/**
 * Extract a JSON array from an LLM response string.
 * Tries multiple strategies in order of reliability.
 * @param {string} raw - Raw LLM response
 * @returns {Array|null} Parsed array or null
 */
export function extractJsonArray(raw) {
    if (!raw || typeof raw !== 'string') return null;

    // 1. Direct parse
    try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch {}

    // 2. Markdown fence
    const fm = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (fm) try { const p = JSON.parse(fm[1].trim()); if (Array.isArray(p)) return p; } catch {}

    // 3. Bracket extraction — try from each '[' to find valid JSON
    let si = -1;
    while ((si = raw.indexOf('[', si + 1)) !== -1) {
        const ei = raw.lastIndexOf(']');
        if (ei > si) {
            try { const p = JSON.parse(raw.substring(si, ei + 1)); if (Array.isArray(p)) return p; } catch {}
        }
    }

    return null;
}

/**
 * Create an LLM agent for a specific task.
 */
export function createAgent(taskName, taskConfig = {}) {
    const agent = new LLMAgent({ name: `LeadGen-${taskName}` });
    return { agent, opts: buildOpts(taskConfig) };
}

export function buildOpts(taskConfig = {}) {
    const opts = { tier: taskConfig.tier || 'fast' };
    if (taskConfig.model) opts.model = taskConfig.model;
    return opts;
}

/**
 * Call an LLM and get raw text response.
 */
export async function callLLM(agent, prompt, opts) {
    return agent.executePrompt(prompt, opts);
}

/**
 * Parse raw search/LLM output into structured JSON using a parse model.
 * @param {string} raw - Raw text from primary model
 * @param {object} parseAgent - LLMAgent for parsing
 * @param {object} parseOpts - Options for parse model
 * @param {string} schema - Description of expected output format
 * @returns {Array} Parsed array
 */
export async function parseWithLLM(raw, parseAgent, parseOpts, schema) {
    const prompt = `You are a data extraction assistant. Convert the following text into a JSON array.

Expected format:
${schema}

IMPORTANT: Return ONLY the JSON array. No explanation, no markdown fences, no other text.

Text to convert:
---
${raw.substring(0, 6000)}
---`;

    const result = await parseAgent.executePrompt(prompt, parseOpts);
    const parsed = extractJsonArray(result);
    if (parsed) return parsed;
    throw new Error(`Parse model failed to produce JSON. Parse output: ${result.substring(0, 200)}`);
}

// Schema constants for reuse
export const LEADS_SCHEMA = `[{"type":"organization","name":"...","website":"https://...","contactUrl":"https://..."},
 {"type":"person","name":"...","email":"...@...","linkedin":"https://linkedin.com/in/..."}]
Each entry MUST have "type" as either "person" or "organization" and "name" as a non-empty string.`;

export const SUGGESTIONS_SCHEMA = `["specific search query 1", "specific search query 2", ...]
Each entry must be a non-empty string describing a concrete search topic.`;

/**
 * Full pipeline: call primary model, try to parse, fallback to parse model.
 * @param {object} config - { tasks: { [taskName]: { model, tier } } }
 * @param {string} taskName - Primary task name
 * @param {string} prompt - Prompt for primary model
 * @param {string} schema - Expected JSON schema description
 * @returns {Array}
 */
export async function runPipeline(config, taskName, prompt, schema) {
    const { agent, opts } = createAgent(taskName, config.tasks?.[taskName]);
    const raw = await callLLM(agent, prompt, opts);

    // Try direct extraction
    const parsed = extractJsonArray(raw);
    if (parsed && parsed.length > 0) {
        // Validate entries have required fields
        const valid = validateEntries(parsed, schema);
        if (valid.length > 0) return valid;
    }

    // Fallback: use parse model
    const { agent: pAgent, opts: pOpts } = createAgent('parse', config.tasks?.parse);
    return parseWithLLM(raw, pAgent, pOpts, schema);
}

/**
 * Filter out entries that are clearly invalid (no name, or just placeholder text).
 */
function validateEntries(arr, schema) {
    if (!Array.isArray(arr)) return [];
    // For string arrays (suggestions)
    if (schema === SUGGESTIONS_SCHEMA) {
        return arr.filter(s => typeof s === 'string' && s.length > 5);
    }
    // For lead objects
    return arr.filter(entry => {
        if (!entry || typeof entry !== 'object') return false;
        const name = (entry.name || '').trim();
        return name.length > 1 && name.toLowerCase() !== 'unknown' && name !== '...';
    });
}
