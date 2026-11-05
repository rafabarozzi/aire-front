import test from 'node:test';
import assert from 'node:assert/strict';
import { customerReport } from '../lib/aire/customer-report.ts';
import type { ReadinessEvaluation } from '../lib/aire/observability.ts';

test('download includes only decisions on the displayed evidence revision', () => {
  const approval = {actor:'reviewer',at:'2026-11-05T15:00:00Z',choice:'approved' as const,fingerprint:'v1'};
  const row = {id:'r1',version:'v1',title:'Revisar alerta',action:'adjust',explanation:'Revisar o limite de latência.',
    monitor_ids:[123],scopes:[{service:'orders',route:'/checkout'}],evidence:[{metric:'latency',metric_context:{observed_min:0.1,observed_max:0.4,samples:4,unit:[{short_name:'s'}]}}]};
  const run: ReadinessEvaluation = {id:'evaluation',state:'READY',customer_review:{revision:1,decisions:{r1:approval}},data:{input:{mode:'real',environment:'demo'},recommendations:[],findings:[],customer_recommendations:[row]}};
  assert.match(customerReport(run),/Decisão: aprovada/);
  row.version='v2';
  const text=customerReport(run);
  assert.match(text,/aguardando revisão do cliente/);
  assert.match(text,/orders · \/checkout/);
  assert.match(text,/0,1 a 0,4 s/);
  assert.doesNotMatch(text,/Decisão: aprovada/);
});
