"""Execute the existing Gateway PEP/Lua against signed test events; no live traffic."""
from pathlib import Path
from datetime import datetime
from unittest.mock import patch
import hashlib,json,sys
import fakeredis
from lupa import LuaRuntime

gateway,folder=map(Path,sys.argv[1:3])
bundle=json.loads((folder/'projection-decisions.json').read_text(encoding='utf-8'))
assert bundle['fixtureOnly'] is True
projections=[e['projection'] for e in bundle['projected']]
limits=projections[0]['limits'];second=projections[1]['limits']
assert limits['allocationId']==second['allocationId'] and limits['canonicalScope']==second['canonicalScope']
server=fakeredis.FakeServer();clients=[fakeredis.FakeRedis(server=server,decode_responses=True) for _ in range(3)]
lua=LuaRuntime(unpack_returned_tuples=True);pep=lua.execute((gateway/'adapters/pep.lua').read_text(encoding='utf-8'));script=(gateway/'limiter/admit.lua').read_text(encoding='utf-8')
timestamp=lambda text: datetime.fromisoformat(text.replace('Z','+00:00')).timestamp()
now=timestamp('2026-10-15T06:29:59.000Z');start=int(timestamp('2026-10-01T00:00:00.000Z')*1000);end=int(timestamp('2026-11-01T00:00:00.000Z')*1000)
values=(limits['allocationId'],limits['canonicalScope'],projections[0]['consumerTenantId']);framed=''.join(f'{len(v)}:{v}' for v in values);base='fanasa:admission:{'+hashlib.sha256(framed.encode()).hexdigest()+'}'
keys=[base+':bucket',base+f':period:{start}:{end}']
def to_lua(v):
 if isinstance(v,dict):return lua.table_from({k:to_lua(x) for k,x in v.items()})
 if isinstance(v,list):return lua.table_from([to_lua(x) for x in v])
 return v
def to_python(v):return {k:to_python(x) for k,x in v.items()} if hasattr(v,'items') else v
p=projections[0];conf=dict(productId=p['productId'],ownerTenantId=p['ownerTenantId'],environment='development',action='organization.unit.save',operationGroup='organization',audience='fanasa-organization-fabric-api',scope='organization.unit.save',allowedClients=['fixture-gateway-client'],issuer='https://sso.fanasa.net.local/realms/fanasa',allocationId=limits['allocationId'],allocationScope=limits['canonicalScope'])
claims=dict(active=True,iss=conf['issuer'],exp=now+300,sub='33333333-3333-4333-8333-333333333333',consumerTenantId=p['consumerTenantId'],aud=conf['audience'],scope=conf['scope'],client_id='fixture-gateway-client')
results=[];replies=[];current=None;replica=0
def decide(request):
 assert request['requestId']==current['requestId']
 return to_lua(dict(status=200,body=current))
def admit(allocation,authorized):
 a=to_python(allocation);assert a['id']==limits['allocationId'] and a['scope']==limits['canonicalScope'];assert a['period']['startMs']==start and a['period']['endMs']==end
 reply=clients[replica].eval(script,2,*keys,'admit',a['configRevision'],a['tps'],a['burst'],start,end,a['period']['quota'],1,0,0);replies.append(reply)
 if reply[:2]==[1,'OK']:return to_lua(dict(status=200,code='OK',allowed=True))
 return to_lua(dict(status=409 if reply[1] in ('CONFIG_STALE','CONFIG_CONFLICT') else 429,allowed=False))
lua.globals().py_decide=decide;lua.globals().py_admit=admit;deps=lua.eval('{decide=function(r) return py_decide(r) end,admit=function(a,c) return py_admit(a,c) end}')
with patch('time.time',return_value=now):
 assert clients[0].eval(script,2,*keys,'provision',limits['configRevision'],limits['rate']['requestsPerSecond'],limits['rate']['burstCapacity'],start,end,limits['quota']['requests'],1,limits['rate']['burstCapacity'],0)[:2]==[1,'PROVISIONED']
 for i,decision in enumerate(bundle['admissionDecisions']):
  current=decision;replica=i%3
  result=to_python(pep.authorize(to_lua(conf),to_lua(dict(requestId=current['requestId'],now=now,claims=claims)),deps));results.append(result['status'])
  assert result['status']==(200 if i<4 else 409),(i,result)
  if i==2:assert int(clients[0].hget(keys[1],'used'))==3
  if i==3:assert int(clients[0].hget(keys[1],'used'))==4 and float(replies[-1][3])==6 and int(replies[-1][4])==1996
 assert int(clients[0].hget(keys[1],'used'))==4
 assert clients[1].eval(script,2,*keys,'provision',second['configRevision'],second['rate']['requestsPerSecond'],second['rate']['burstCapacity'],start,end,second['quota']['requests'],1,second['rate']['burstCapacity'],0)[:2]==[1,'PROVISIONED']
 assert int(clients[0].hget(keys[1],'used'))==4 and float(clients[0].hget(keys[0],'tokens'))==6
evidence=dict(gatewayCompatibility='PASS',fixtureOnly=True,actualPep=True,actualLimiter=True,replicas=3,accepted=4,usedAfterAmendment=4,remainingTokens=6,remainingQuota=1996,staleRevisionDenied=True,reprovisionDidNotReset=True,nativeApisix=False,liveRedis=False,sources={f:hashlib.sha256((gateway/f).read_bytes()).hexdigest() for f in ['adapters/pep.lua','limiter/admit.lua']})
(folder/'gateway-compatibility.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8');print(json.dumps(evidence))
