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
  assert.doesNotMatch(text,/aguardando revisão do cliente/);
  assert.match(text,/orders · \/checkout/);
  assert.match(text,/0,1 a 0,4 s/);
  assert.doesNotMatch(text,/Decisão: aprovada/);
});

test('technical hypotheses consolidate repeated routes and do not ask for approval', () => {
  const row={id:'a',version:'v',title:'Cobertura',action:'create',explanation:'Teste',scopes:[{service:'catalog',route:'/release',metric:'a'}]};
  const run:ReadinessEvaluation={id:'x',state:'READY',data:{input:{mode:'real'},recommendations:[],findings:[],customer_recommendations:[row,{...row,id:'b',scopes:[{...row.scopes[0],metric:'b'}]}],
    entry_monitoring:{status:'measured',route:'/buy',method:'POST',counts:{201:4,504:1},buckets_with_traffic:2,buckets_with_5xx:1,buckets_without_traffic_witness:286}}};
  const report=customerReport(run);
  assert.equal(report.split('## Cobertura a completar').length-1,1);
  assert.match(report,/5 respostas HTTP classificadas, 1 com erro/);
  assert.match(report,/catalog · \/release · b/);
  assert.doesNotMatch(report,/aguardando revisão do cliente/);
});
