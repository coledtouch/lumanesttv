import test from 'node:test';import assert from 'node:assert/strict';import {portalReady,renewalOffer,walletCanActivate,activatedLineId} from '../lib/provider-readiness.ts';
test('provider approved site is live while drafts and missing addresses stay closed',()=>{assert.equal(portalReady({status:'approved',address:'https://tv.lumanest.tv'}),true);assert.equal(portalReady({status:'draft',address:'https://tv.lumanest.tv'}),false);assert.equal(portalReady({status:'approved'}),false);assert.equal(portalReady(undefined),false)});
test('renewals use the actual line screen count and its provider renewal quote',()=>{assert.deepEqual(renewalOffer({devices:2,prices:{renew:[{months:3,price:43}]}},3),{devices:2,amount:59,cost:43});assert.throws(()=>renewalOffer({devices:2,prices:{renew:[{months:3,price:43}]}},12));assert.throws(()=>renewalOffer({devices:9,prices:{renew:[{months:3,price:25}]}},3));assert.throws(()=>renewalOffer({devices:1,prices:{renew:[{months:3,price:0}]}},3))});
test('checkout requires an HTTPS provider portal matching customer sign in',()=>{assert.equal(portalReady({status:'active',address:'https://tv.lumanest.tv/'},'https://tv.lumanest.tv'),true);for(const address of ['http://tv.lumanest.tv','javascript:alert(1)','https://user:password@tv.lumanest.tv','invalid'])assert.equal(portalReady({status:'active',address}),false);assert.equal(portalReady({status:'active',address:'https://other.tv'},'https://tv.lumanest.tv'),false)});
test('a public portal alias requires an explicitly matching approved provider origin',()=>{
  const site={status:'approved',address:'https://tv.lumanest.tv/'};
  assert.equal(portalReady(site,'https://portal.lumanest.tv'),false);
  assert.equal(portalReady(site,'https://portal.lumanest.tv','https://tv.lumanest.tv'),true);
  for(const primary of ['https://portal.lumanest.tv','https://other.tv','https://lumanest.tv','https://tv.lumanest.tv.evil.example'])assert.equal(portalReady(site,'https://portal.lumanest.tv',primary),false);
  assert.equal(portalReady({status:'approved',address:'https://tv.lumanest.tv.evil.example'},'https://portal.lumanest.tv','https://tv.lumanest.tv'),false);
});
test('invalid explicit public or provider primary configuration fails closed',()=>{
  const site={status:'approved',address:'https://tv.lumanest.tv'};
  for(const invalid of ['','invalid','http://tv.lumanest.tv','https://user:password@tv.lumanest.tv','https://tv.lumanest.tv:8443','https://*.lumanest.tv']){
    assert.equal(portalReady(site,invalid,'https://tv.lumanest.tv'),false);
    assert.equal(portalReady(site,'https://tv.lumanest.tv',invalid),false);
    assert.equal(portalReady({status:'approved',address:invalid},'https://tv.lumanest.tv'),false);
  }
});
test('an explicit provider primary never overrides missing or unapproved site data',()=>{
  for(const site of [undefined,{status:'approved'},{status:'draft',address:'https://tv.lumanest.tv'},{address:'https://tv.lumanest.tv'}])assert.equal(portalReady(site,'https://portal.lumanest.tv','https://tv.lumanest.tv'),false);
});
test('unknown wallet balances and nonpositive quotes keep checkout closed',()=>{assert.equal(walletCanActivate('45.00','45'),true);assert.equal(walletCanActivate(44,45),false);for(const balance of [undefined,null,'',true,NaN,'unknown',Infinity])assert.equal(walletCanActivate(balance,25),false);for(const quote of [undefined,null,'',false,0,-25,NaN,Infinity])assert.equal(walletCanActivate(100,quote),false)});
test('fulfillment requires a confirmed line and matching renewal target',()=>{assert.equal(activatedLineId({line:{id:42}}),42);assert.equal(activatedLineId({id:42},42),42);for(const data of [null,{}, {line:{}},{line:{id:0}},{line:{id:'42'}},{line:{id:43}}])assert.throws(()=>activatedLineId(data,42))});
