// Read-only local compatibility with the policy owner's actual projector/evaluator.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {serviceLimitProjection} from '../lib/service-limit-projection.mjs';
const [policyRoot,evidenceDir]=process.argv.slice(2);if(!policyRoot||!evidenceDir)throw Error('Policy package and isolated test evidence directory are required.');
const dir=resolve(evidenceDir),source=JSON.parse(await readFile(dir+'/signed-events.json','utf8'));assert.equal(source.fixtureOnly,true);assert.equal(source.events.length,2);
const require=createRequire(import.meta.url),owner=require(resolve(policyRoot,'sample/contract-policy.cjs'));
const base=JSON.parse(await readFile(resolve(policyRoot,'fixtures/integration-projection.v2.json'),'utf8')),context=JSON.parse(await readFile(resolve(policyRoot,'fixtures/integration-context.v2.json'),'utf8'));
let state=null;const decisions=[],projected=[];
for(const [i,event] of source.events.entries()){
 const binding={localTenantId:event.localTenantId,contractId:event.contractId,serviceKey:event.terms.serviceKey,registryReference:'isolated owner fixture; not a live registry binding',projection:base,allocationRevisions:{[event.eventId]:41+i}};
 const normalized=serviceLimitProjection(event,binding),result=owner.projectEvent(state,normalized,'fanasa-contracts');assert.equal(result.status,'applied');state=result.state;
 assert.equal(owner.projectEvent(state,normalized,'fanasa-contracts').status,'duplicate');
 const ctx=structuredClone(context);ctx.evidence.contractVersion=normalized.aggregateVersion;ctx.environment.now=i?'2026-10-15T06:29:59.000Z':'2026-10-10T06:29:59.000Z';ctx.evidence.validUntil=i?'2026-10-15T06:30:59.000Z':'2026-10-10T06:30:59.000Z';ctx.requestId='g-'+String(i+1).repeat(32);
 const decision=owner.evaluate(state.projection,ctx);assert.equal(decision.decision,'Permit');decisions.push(decision);projected.push(normalized);
 if(i){assert.equal(owner.projectEvent(state,projected[0],'fanasa-contracts').status,'duplicate');assert.equal(state.projection.limits.rate.requestsPerSecond,12);}
}
assert.equal(projected[0].projection.limits.allocationId,projected[1].projection.limits.allocationId);assert.equal(projected[0].projection.limits.canonicalScope,projected[1].projection.limits.canonicalScope);
const future=structuredClone(context);future.evidence.contractVersion=projected[1].aggregateVersion;assert.equal(owner.evaluate(projected[1].projection,future).decision,'Deny');
const admissionDecisions=[0,0,0,1,0].map((version,i)=>{const ctx=structuredClone(context);ctx.requestId='g-'+String(i+1).repeat(32);ctx.environment.now='2026-10-15T06:29:59.000Z';ctx.evidence.validUntil='2026-10-15T06:30:59.000Z';ctx.evidence.contractVersion=projected[version].aggregateVersion;const decision=owner.evaluate(projected[version].projection,ctx);assert.equal(decision.decision,'Permit');return decision;});
await mkdir(dir,{recursive:true});await writeFile(dir+'/projection-decisions.json',JSON.stringify({fixtureOnly:true,projected,decisions,admissionDecisions,scopePreserved:true,independentConfigRevisions:[41,42],futureDenied:true},null,2));
console.log(JSON.stringify({policyCompatibility:'PASS',signedDatabaseEvents:2,realProjector:true,realEvaluator:true,amendedTPS:12,allocationPreserved:true,futureDenied:true,nativeGateway:false}));
