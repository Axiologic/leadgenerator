// Resolve AchillesAgentLib from node_modules or parent directory
let mod;
try { mod = await import('achillesAgentLib/LLMAgents'); }
catch { mod = await import('../../AchillesAgentLib/LLMAgents/index.mjs'); }
export const { LLMAgent } = mod;

let utils;
try { utils = await import('achillesAgentLib/utils/LLMClient.mjs'); }
catch { utils = await import('../../AchillesAgentLib/utils/LLMClient.mjs'); }
export const { listModelsFromCache } = utils;
