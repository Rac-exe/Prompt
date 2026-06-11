import { createPipeline } from './platform/pipeline.js';
import { authorizeWorkspace } from './security/authorizeWorkspace.js';
import { scoreLead } from './features/leads/leadScoring.js';

const pipeline = createPipeline('demo-workspace');
const lead = scoreLead({ id: 'lead_1', companySize: 42, activities: ['visit', 'reply'], tags: ['trial'] });
console.log(JSON.stringify({ pipeline: pipeline.name, leadScore: lead.score, access: authorizeWorkspace({ id: 'u1', roles: ['admin'] }, 'admin') }));
