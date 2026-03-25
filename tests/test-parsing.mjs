/**
 * Unit tests for extractJsonArray — pure parsing, no LLM calls.
 * Run: node tests/test-parsing.mjs
 */
import { extractJsonArray } from '../src/llmPipeline.mjs';

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}
function eq(a, b) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

console.log('=== extractJsonArray tests ===\n');

test('direct JSON array', () => {
    eq(extractJsonArray('[{"name":"Alice"},{"name":"Bob"}]'), [{ name: 'Alice' }, { name: 'Bob' }]);
});

test('direct JSON string array', () => {
    eq(extractJsonArray('["query 1","query 2","query 3"]'), ['query 1', 'query 2', 'query 3']);
});

test('markdown fence json', () => {
    const input = 'Here are results:\n```json\n[{"type":"person","name":"Alice"}]\n```\nHope this helps!';
    eq(extractJsonArray(input), [{ type: 'person', name: 'Alice' }]);
});

test('markdown fence without json label', () => {
    const input = '```\n[{"name":"Test"}]\n```';
    eq(extractJsonArray(input), [{ name: 'Test' }]);
});

test('bracket extraction with surrounding text', () => {
    const input = 'I found these: [{"name":"CORDIS","type":"organization"}] Let me know if you need more.';
    eq(extractJsonArray(input), [{ name: 'CORDIS', type: 'organization' }]);
});

test('returns null for plain text', () => {
    eq(extractJsonArray('No results found for this query.'), null);
});

test('returns null for empty string', () => {
    eq(extractJsonArray(''), null);
});

test('returns null for null', () => {
    eq(extractJsonArray(null), null);
});

test('returns null for search results format', () => {
    const input = `## Search Results for: "European AI"
### 1. [euROBIN](https://eurobin.eu)
euROBIN network aims to advance AI`;
    eq(extractJsonArray(input), null);
});

test('handles JSON with trailing comma (common LLM mistake)', () => {
    // This should fail gracefully — JSON.parse doesn't accept trailing commas
    const input = '[{"name":"Alice"},]';
    // Should return null (invalid JSON), not crash
    const result = extractJsonArray(input);
    eq(result, null);
});

test('handles nested brackets in text', () => {
    const input = 'Results [see below] are: [{"name":"Real"}]';
    // Should find the valid JSON array
    const result = extractJsonArray(input);
    eq(result, [{ name: 'Real' }]);
});

test('handles multiline JSON', () => {
    const input = `[
  {
    "type": "organization",
    "name": "euROBIN",
    "website": "https://eurobin.eu"
  }
]`;
    const result = extractJsonArray(input);
    eq(result[0].name, 'euROBIN');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
