/**
 * Integration tests for the full LLM pipeline with real model calls.
 * Run: node tests/test-pipeline.mjs
 * 
 * Requires SOUL_GATEWAY_API_KEY in .env
 */
import { extractJsonArray, runPipeline, callLLM, createAgent, parseWithLLM, LEADS_SCHEMA, SUGGESTIONS_SCHEMA } from '../src/llmPipeline.mjs';

let passed = 0, failed = 0, skipped = 0;
async function test(name, fn) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message.substring(0, 200)}`); }
}

const config = {
    tasks: {
        discovery: { tier: 'fast' },
        suggest: { tier: 'fast' },
        parse: { tier: 'fast' },
    }
};

console.log('=== Pipeline integration tests ===\n');

// Test 1: instruct model returns JSON directly (no parse step needed)
await test('instruct model (axl/copilot/gpt-4.1) returns valid JSON for discovery', async () => {
    const { agent, opts } = createAgent('discovery', { model: 'axl/copilot/gpt-4.1' });
    const raw = await callLLM(agent, `Identify 3 organizations involved in "European AI research".
Return ONLY a JSON array:
[{"type":"organization","name":"...","website":"...","contactUrl":"..."}]`, opts);
    console.log(`    Raw (${raw.length} chars): ${raw.substring(0, 100)}...`);
    const parsed = extractJsonArray(raw);
    if (!parsed) throw new Error('extractJsonArray returned null');
    if (!Array.isArray(parsed)) throw new Error('Not an array');
    if (parsed.length === 0) throw new Error('Empty array');
    if (!parsed[0].name || parsed[0].name === '...' || parsed[0].name === 'Unknown') throw new Error(`Bad name: ${parsed[0].name}`);
    console.log(`    Parsed ${parsed.length} entries, first: ${parsed[0].name}`);
});

// Test 2: search model returns non-JSON, parse model structures it
await test('axl/search/exa-search → axl/copilot/gpt-4.1 parse pipeline', async () => {
    const { agent, opts } = createAgent('search', { model: 'axl/search/exa-search' });
    const raw = await callLLM(agent, 'Find organizations involved in European AI research projects', opts);
    console.log(`    Search raw (${raw.length} chars): ${raw.substring(0, 100)}...`);

    // Verify search output is NOT valid JSON
    const directParse = extractJsonArray(raw);
    console.log(`    Direct parse: ${directParse ? 'succeeded (unexpected)' : 'null (expected)'}`);

    // Now parse with instruct model
    const { agent: pAgent, opts: pOpts } = createAgent('parse', { model: 'axl/copilot/gpt-4.1' });
    const parsed = await parseWithLLM(raw, pAgent, pOpts, LEADS_SCHEMA);
    if (!Array.isArray(parsed)) throw new Error('Not an array');
    if (parsed.length === 0) throw new Error('Empty array');
    if (!parsed[0].name || parsed[0].name === '...' || parsed[0].name === 'Unknown') throw new Error(`Bad name: ${parsed[0].name}`);
    if (!parsed[0].type) throw new Error('Missing type field');
    console.log(`    Parsed ${parsed.length} leads, first: ${parsed[0].name} (${parsed[0].type})`);
});

// Test 3: full pipeline with search model for discovery
await test('runPipeline with search model auto-falls back to parse', async () => {
    const pipeConfig = {
        tasks: {
            discovery: { model: 'axl/search/exa-search' },
            parse: { model: 'axl/copilot/gpt-4.1' },
        }
    };
    const results = await runPipeline(pipeConfig, 'discovery',
        'Find organizations involved in European AI research projects',
        LEADS_SCHEMA);
    if (!Array.isArray(results)) throw new Error('Not an array');
    if (results.length === 0) throw new Error('Empty results');
    if (!results[0].name || results[0].name === 'Unknown') throw new Error(`Bad entry: ${JSON.stringify(results[0])}`);
    console.log(`    Pipeline returned ${results.length} leads`);
    results.slice(0, 3).forEach(r => console.log(`      - ${r.name} (${r.type})`));
});

// Test 4: full pipeline with instruct model (should skip parse step)
await test('runPipeline with instruct model returns directly', async () => {
    const pipeConfig = {
        tasks: {
            suggest: { model: 'axl/copilot/gpt-4.1' },
            parse: { model: 'axl/copilot/gpt-4.1' },
        }
    };
    const results = await runPipeline(pipeConfig, 'suggest',
        'Suggest 3 specific search queries for finding marketing leads in European biotech. Return ONLY a JSON array of strings.',
        SUGGESTIONS_SCHEMA);
    if (!Array.isArray(results)) throw new Error('Not an array');
    if (results.length === 0) throw new Error('Empty results');
    if (typeof results[0] !== 'string') throw new Error(`Expected string, got ${typeof results[0]}`);
    console.log(`    Suggestions: ${results.join(' | ')}`);
});

// Test 5: validation filters out bad entries
await test('validation filters Unknown and placeholder entries', async () => {
    const pipeConfig = {
        tasks: {
            discovery: { model: 'axl/copilot/gpt-4.1' },
            parse: { model: 'axl/copilot/gpt-4.1' },
        }
    };
    // This should return real names, not "Unknown" or "..."
    const results = await runPipeline(pipeConfig, 'discovery',
        `Identify 3 organizations in "Nordic fintech startups".
Return ONLY a JSON array: [{"type":"organization","name":"...","website":"...","contactUrl":"..."}]`,
        LEADS_SCHEMA);
    const bad = results.filter(r => !r.name || r.name === 'Unknown' || r.name === '...');
    if (bad.length > 0) throw new Error(`Found ${bad.length} invalid entries: ${JSON.stringify(bad)}`);
    console.log(`    All ${results.length} entries have valid names`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
