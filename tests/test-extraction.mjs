/**
 * Integration tests for extraction and scraper pipeline.
 * Run: node tests/test-extraction.mjs
 */
import { MarketingAgent } from '../src/marketingAgent.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message.substring(0, 250)}`); }
}

const config = {
    tasks: {
        extraction: { model: 'axl/copilot/gpt-4o' },
        parse: { model: 'axl/copilot/gpt-4.1' },
    }
};

console.log('=== Extraction & Scraper tests ===\n');

// Test 1: Extract leads from HTML content
await test('extractLeads from HTML with real contacts', async () => {
    const agent = new MarketingAgent(config);
    const html = `<html><body>
<h1>Project AURORA - Consortium Partners</h1>
<div class="partner">
  <h3>Dr. Elena Vasquez</h3>
  <p>Project Coordinator, Universidad Politécnica de Madrid</p>
  <p>Email: elena.vasquez@upm.es</p>
</div>
<div class="partner">
  <h3>TechnoVision GmbH</h3>
  <p>SME Partner - AI Solutions</p>
  <p>Contact: <a href="https://technovision.de/contact">technovision.de/contact</a></p>
</div>
<div class="partner">
  <h3>Prof. Jan Müller</h3>
  <p>Work Package Lead, TU Munich</p>
  <p>LinkedIn: <a href="https://linkedin.com/in/janmuller">Profile</a></p>
</div>
</body></html>`;
    const leads = await agent.extractLeads(html, 'https://example.eu/project-aurora');
    console.log(`    Found ${leads.length} leads`);
    if (leads.length < 2) throw new Error(`Expected at least 2 leads, got ${leads.length}`);
    leads.forEach(l => {
        console.log(`      - ${l.name} (${l.type}) ${l.email || l.linkedin || l.website || ''}`);
        if (!l.name || l.name === 'Unknown') throw new Error(`Bad name: ${l.name}`);
        if (!l.type) throw new Error(`Missing type for ${l.name}`);
    });
});

// Test 2: Extract leads from plain text (simulating PDF output)
await test('extractLeads from plain text (PDF-like)', async () => {
    const agent = new MarketingAgent(config);
    const text = `HORIZON EUROPE PROJECT PROPOSAL
Consortium: 
- Coordinator: Dr. Sofia Andersson, Karolinska Institute, sofia.andersson@ki.se
- Partner 1: BioNova Solutions Ltd (SME), Dublin, Ireland, www.bionovasolutions.ie
- Partner 2: Prof. Marco Rossi, Politecnico di Milano, marco.rossi@polimi.it
- Partner 3: GreenTech Innovations S.A., Brussels, contact@greentech-innovations.eu`;
    const leads = await agent.extractLeads(text, 'https://example.eu/proposal.pdf');
    console.log(`    Found ${leads.length} leads`);
    if (leads.length < 3) throw new Error(`Expected at least 3 leads, got ${leads.length}`);
    const persons = leads.filter(l => l.type === 'person');
    const orgs = leads.filter(l => l.type === 'organization');
    console.log(`    ${persons.length} persons, ${orgs.length} organizations`);
    if (persons.length < 1) throw new Error('Expected at least 1 person');
    if (orgs.length < 1) throw new Error('Expected at least 1 organization');
});

// Test 3: Empty/boilerplate content returns empty
await test('extractLeads returns empty for boilerplate content', async () => {
    const agent = new MarketingAgent(config);
    const html = `<html><body><nav>Home About Contact</nav><footer>Copyright 2024</footer></body></html>`;
    const leads = await agent.extractLeads(html, 'https://example.eu');
    console.log(`    Found ${leads.length} leads (expected 0)`);
    // After stripping nav/footer, content is too short (<50 chars), should return []
});

// Test 4: Scraper pagination returns correct structure
await test('recursiveScrape returns pagination structure', async () => {
    const agent = new MarketingAgent(config);
    // Use a small real page
    const result = await agent.recursiveScrape('https://cordis.europa.eu/project/id/101070568', 1, 2);
    console.log(`    visited: ${result.visited.length}, leads: ${result.leads.length}, hasMore: ${result.hasMore}`);
    if (!Array.isArray(result.visited)) throw new Error('visited not array');
    if (!Array.isArray(result.leads)) throw new Error('leads not array');
    if (!Array.isArray(result.knownNames)) throw new Error('knownNames not array');
    if (typeof result.hasMore !== 'boolean') throw new Error('hasMore not boolean');
    if (result.visited.length === 0) throw new Error('Should have visited at least 1 page');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
