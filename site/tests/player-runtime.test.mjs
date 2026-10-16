import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {readFile, readdir} from 'node:fs/promises';

let runtime;
const ownerHeaders = {'oai-authenticated-user-id': 'runtime-owner', 'oai-authenticated-user-email': 'owner@lumanest.tv', 'test-player-session': 'valid'};

test.before(async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import {GET as diagnosticsGET} from './app/api/player/diagnostics/route.ts';
        import {GET as channelsGET} from './app/api/player/channels/route.ts';
        import {GET as streamGET} from './app/api/player/stream/route.ts';
        import {POST as logoutPOST} from './app/api/player/logout/route.ts';
        import {POST as castPOST} from './app/api/player/cast/route.ts';
        import {GET as castGET, HEAD as castHEAD} from './app/api/cast/stream/route.ts';
        import {GET as castFileGET} from './app/api/cast/[file]/route.ts';
        import {seal} from './lib/player-crypto.ts';
        import {PLAYER_COOKIE} from './lib/player.ts';
        import {env} from 'cloudflare:workers';
        export default {async fetch(request) {
          globalThis.__testHeaders = request.headers;
          const headers = new Headers(request.headers);
          const kind = headers.get('test-player-session');
          if (kind === 'valid' || kind === 'revocable') {
            const sealed = () => seal({username:'runtime-private-user',password:'runtime-secret-password',exp:Date.now()+60000,sid:crypto.randomUUID()}, env.PLAYER_COOKIE_KEY, 'player-session');
            const value = kind === 'valid' ? globalThis.__testPlayerCookie ||= await sealed() : globalThis.__testRevocableCookie ||= await sealed();
            headers.set('Cookie', PLAYER_COOKIE + '=' + value);
          }
          // Miniflare rejects Origin on direct worker fetches; the test adds the same-site header here instead.
          if (headers.get('test-same-origin')) headers.set('Origin', new URL(request.url).origin);
          const pathname = new URL(request.url).pathname;
          if (pathname === '/api/player/cast') return castPOST(new Request(request, {headers}));
          if (pathname === '/api/cast/stream') return castGET(new Request(request, {headers}));
          if (pathname.startsWith('/api/cast/')) return request.method === 'HEAD' ? castHEAD(new Request(request, {headers})) : castFileGET(new Request(request, {headers}));
          return (pathname.endsWith('/logout') ? logoutPOST : pathname.endsWith('/channels') ? channelsGET : pathname.endsWith('/stream') ? streamGET : diagnosticsGET)(new Request(request, {headers}));
        }};
      `,
      resolveDir: fileURLToPath(new URL('../', import.meta.url)), sourcefile: 'player-runtime-worker.ts', loader: 'ts'
    },
    write: false, bundle: true, format: 'esm', platform: 'browser', external: ['cloudflare:workers', 'node:crypto'],
    plugins: [{name:'mock-framework-request-context',setup(builder) {
      builder.onResolve({filter:/^next\/(headers|navigation)$/}, args => ({path:args.path,namespace:'mock-framework'}));
      builder.onLoad({filter:/.*/,namespace:'mock-framework'}, args => ({contents:args.path.endsWith('/headers') ? 'export async function headers(){return globalThis.__testHeaders || new Headers();}' : 'export function redirect(){throw new Error("Unexpected navigation");}',loader:'js'}));
    }}]
  });
  runtime = new Miniflare({
    compatibilityDate:'2026-05-15', compatibilityFlags:['nodejs_compat'], cf:false,
    workers:[{
      name:'player-runtime', compatibilityDate:'2026-05-15', compatibilityFlags:['nodejs_compat'], modules:true, script:bundle.outputFiles[0].text,scriptPath:fileURLToPath(new URL('../player-runtime-worker.js',import.meta.url)),d1Databases:{DB:'player-owner-default'},
      bindings:{ADMIN_USER_ID:'runtime-owner',PLAYER_COOKIE_KEY:'a'.repeat(64),CUSTOMER_PORTAL_URL:'https://tv.lumanest.tv',PLAYER_ALLOWED_HOSTS:'tv.lumanest.tv',PLAYER_ALLOWED_HTTP_HOSTS:'tv.lumanest.tv,turbobunny.net,38.190.178.54'},outboundService:'mock-player-upstream'
    },{
      name:'player-runtime-mapped', compatibilityDate:'2026-05-15', compatibilityFlags:['nodejs_compat'], modules:true, script:bundle.outputFiles[0].text,scriptPath:fileURLToPath(new URL('../player-runtime-worker.js',import.meta.url)),d1Databases:{DB:'player-owner-mapped'},
      bindings:{ADMIN_USER_ID:'runtime-owner',PLAYER_COOKIE_KEY:'a'.repeat(64),CUSTOMER_PORTAL_URL:'https://tv.lumanest.tv',PLAYER_ALLOWED_HOSTS:'tv.lumanest.tv',PLAYER_ALLOWED_HTTP_HOSTS:'tv.lumanest.tv,turbobunny.net,38.190.178.54,media.lumanest.tv',PLAYER_STREAM_ORIGIN_MAP:JSON.stringify({'http://38.190.178.54':'http://media.lumanest.tv'})},outboundService:'mock-player-upstream'
    },{
      name:'player-runtime-public-alias', compatibilityDate:'2026-05-15', compatibilityFlags:['nodejs_compat'], modules:true, script:bundle.outputFiles[0].text,scriptPath:fileURLToPath(new URL('../player-runtime-worker.js',import.meta.url)),d1Databases:{DB:'player-owner-public-alias'},
      bindings:{ADMIN_USER_ID:'runtime-owner',PLAYER_COOKIE_KEY:'a'.repeat(64),CUSTOMER_PORTAL_URL:'https://portal.lumanest.tv',CUSTOMER_PORTAL_PRIMARY_URL:'https://tv.lumanest.tv',PLAYER_ALLOWED_HOSTS:'tv.lumanest.tv,portal.lumanest.tv',PLAYER_ALLOWED_HTTP_HOSTS:'tv.lumanest.tv,portal.lumanest.tv,turbobunny.net,38.190.178.54,media.lumanest.tv',PLAYER_STREAM_ORIGIN_MAP:JSON.stringify({'http://38.190.178.54':'http://media.lumanest.tv'})},outboundService:'mock-player-upstream'
    },{
      name:'player-runtime-relay', compatibilityDate:'2026-05-15', compatibilityFlags:['nodejs_compat'], modules:true, script:bundle.outputFiles[0].text,scriptPath:fileURLToPath(new URL('../player-runtime-worker.js',import.meta.url)),d1Databases:{DB:'player-owner-relay'},
      bindings:{ADMIN_USER_ID:'runtime-owner',PLAYER_COOKIE_KEY:'a'.repeat(64),CUSTOMER_PORTAL_URL:'https://tv.lumanest.tv',PLAYER_ALLOWED_HOSTS:'tv.lumanest.tv',PLAYER_ALLOWED_HTTP_HOSTS:'tv.lumanest.tv,turbobunny.net,38.190.178.54,media.lumanest.tv',PLAYER_STREAM_ORIGIN_MAP:JSON.stringify({'http://38.190.178.54':'http://media.lumanest.tv'}),PLAYER_STREAM_RELAY_URL:'https://streams.lumanest.tv/relay',PLAYER_STREAM_RELAY_KEY:'b'.repeat(64)},outboundService:'mock-player-upstream'
    },{
      name:'mock-player-upstream', modules:true,
      script:`
        export default {async fetch(request) {
          const url = new URL(request.url);
          if (url.origin === 'https://streams.lumanest.tv') {
            if (url.pathname !== '/relay' || request.method !== 'POST' || request.headers.get('Authorization') !== 'Bearer ' + 'b'.repeat(64) || request.headers.get('Content-Type') !== 'application/json' || request.headers.has('Cookie') || request.headers.has('Range')) return new Response('relay-request-rejected',{status:403});
            const body = await request.json();
            const source = new URL(body.url);
            if (!['136.148.65.42','136.148.65.43','136.148.65.254','38.190.178.54'].includes(source.hostname) || source.protocol !== 'http:' || source.search !== '?token=runtime-private-token') return new Response('relay-source-rejected',{status:400});
            if (source.pathname.endsWith('/playlist.m3u8')) return new Response('#EXTM3U\\n#EXT-X-TARGETDURATION:6\\n#EXTINF:6,\\nsegment.ts?token=runtime-private-token\\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
            if (body.range) return new Response('relay-range-body',{status:206,headers:{'Content-Type':'video/mp2t','Content-Range':body.range === 'bytes=120-240' ? 'bytes 120-240/1000' : 'invalid','Accept-Ranges':'bytes'}});
            return new Response('relay-stream-body-' + source.hostname,{headers:{'Content-Type':'video/mp2t'}});
          }
          if (url.pathname === '/m3u') {
            if (url.origin !== 'https://tv.lumanest.tv' || url.searchParams.get('u') !== 'runtime-private-user' || url.searchParams.get('p') !== 'runtime-secret-password') return new Response('wrong-playlist-connection',{status:404});
            return new Response('#EXTM3U\\n#EXTINF:-1,First\\nhttp://tv.lumanest.tv/live/runtime-private-user/runtime-secret-password/1?token=runtime-private-token\\n#EXTINF:-1,Private second channel\\nhttps://tv.lumanest.tv/live/runtime-private-user/runtime-secret-password/2.m3u8?token=runtime-private-token\\n#EXTINF:-1,Unapproved provider source\\nhttps://127.0.0.1/private-stream?token=runtime-private-token\\n#EXTINF:-1,Blocked redirect\\nhttps://tv.lumanest.tv/live/runtime-private-user/runtime-secret-password/3?token=runtime-private-token\\n#EXTINF:-1,Rotating provider stream\\nhttp://136.148.65.42/live/runtime-private-user/runtime-secret-password/42?token=runtime-private-token\\n#EXTINF:-1,Other public stream\\nhttp://8.8.8.8/live/runtime-private-user/runtime-secret-password/42?token=runtime-private-token\\n#EXTINF:-1,Relay HLS playlist\\nhttp://136.148.65.43/live/runtime-private-user/runtime-secret-password/playlist.m3u8?token=runtime-private-token\\n#EXTINF:-1,Rotating provider redirect\\nhttps://tv.lumanest.tv/live/runtime-private-user/runtime-secret-password/4?token=runtime-private-token\\n#EXTINF:-1,Legacy direct provider\\nhttp://38.190.178.54/live/runtime-private-user/runtime-secret-password/42?token=runtime-private-token', {headers:{'Content-Type':'text/plain'}});
          }
          if (url.pathname === '/live/runtime-private-user/runtime-secret-password/2.m3u8' && url.search === '?token=runtime-private-token' && url.origin === 'https://tv.lumanest.tv') return new Response('#EXTM3U\\nprivate-second-stream-body',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
          if (url.pathname === '/live/runtime-private-user/runtime-secret-password/3' && url.origin === 'https://tv.lumanest.tv') return new Response(null,{status:302,headers:{Location:'https://private-user:private-password@blocked-provider.example:8443/private-path?secret=private-query'}});
          if (url.pathname === '/live/runtime-private-user/runtime-secret-password/4' && url.origin === 'https://tv.lumanest.tv') return new Response(null,{status:302,headers:{Location:'http://136.148.65.254/live/runtime-private-user/runtime-secret-password/254?token=runtime-private-token'}});
          if (url.hostname === 'blocked-provider.example') return new Response('should-never-be-fetched',{headers:{'Content-Type':'video/mp2t'}});
          if (url.pathname !== '/live/runtime-private-user/runtime-secret-password/1' || url.search !== '?token=runtime-private-token') return new Response('wrong-stream-path-or-query',{status:400});
          if (url.hostname === 'tv.lumanest.tv') return new Response(null,{status:301,headers:{Location:'http://turbobunny.net/live/runtime-private-user/runtime-secret-password/1?token=runtime-private-token'}});
          if (url.hostname === 'turbobunny.net') return new Response(null,{status:302,headers:{Location:'http://38.190.178.54/live/runtime-private-user/runtime-secret-password/1?token=runtime-private-token'}});
          if (url.hostname === 'media.lumanest.tv') return new Response('private-stream-body',{headers:{'Content-Type':'video/mp2t'}});
          const withAgent = request.headers.get('User-Agent') === 'LumaNestTV/1.0';
          return new Response(withAgent ? 'private-stream-body' : 'private-denied-body', {status:withAgent ? 200 : 403,headers:{'Content-Type':withAgent ? 'video/mp2t' : 'text/html; charset=UTF-8'}});
        }};
      `
    }]
  });
  const migrations = [];
  for (const file of (await readdir(new URL('../drizzle/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()) migrations.push(await readFile(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  for (const name of ['player-runtime','player-runtime-mapped','player-runtime-public-alias','player-runtime-relay']) {
    const database = await runtime.getD1Database('DB', name);
    for (const migration of migrations) await database.batch(migration.split('--> statement-breakpoint').map(sql => database.prepare(sql.trim())));
  }
});
test.after(async () => {await runtime?.dispose();});

async function diagnose(profile='default', headers=ownerHeaders, query='') {
  const response=await runtime.dispatchFetch('https://lumanest.tv/api/player/diagnostics?profile='+profile+query,{headers});
  return {status:response.status,data:await response.json()};
}

test('stream diagnostics require both owner identity and a valid encrypted player session',async()=>{
  assert.equal((await diagnose('default',{'test-player-session':'valid'})).status,401);
  assert.equal((await diagnose('default',{...ownerHeaders,'oai-authenticated-user-id':'different-owner'})).status,403);
  const headers={...ownerHeaders};delete headers['test-player-session'];assert.equal((await diagnose('default',headers)).status,401);
});

test('diagnostics preserve redirect statuses while withholding credentials, paths, queries and provider bodies',async()=>{
  const {status,data}=await diagnose();assert.equal(status,200);
  assert.deepEqual(data,{profile:'default',hops:[{origin:'https://tv.lumanest.tv',status:301,contentType:'other'},{origin:'http://turbobunny.net',status:302,contentType:'other'},{origin:'http://38.190.178.54',status:403,contentType:'text/html'}],hint:'worker_ip_origin_requires_hostname'});
  const text=JSON.stringify(data);for(const secret of ['runtime-private-user','runtime-secret-password','/live/','private-denied-body','?u='])assert.ok(!text.includes(secret));
});

test('bounded diagnostic profiles isolate user-agent and original HTTP portal behavior',async()=>{
  const ua=(await diagnose('ua')).data;assert.equal(ua.hops[0].origin,'https://tv.lumanest.tv');assert.equal(ua.hops.at(-1).status,200);
  const http=(await diagnose('http')).data;assert.equal(http.hops[0].origin,'http://tv.lumanest.tv');assert.equal(http.hops.at(-1).status,403);
  const combined=(await diagnose('http-ua')).data;assert.equal(combined.hops[0].origin,'http://tv.lumanest.tv');assert.equal(combined.hops.at(-1).status,200);
  assert.equal((await diagnose('arbitrary')).status,400);
});

test('explicit channel indices select only the matching authenticated playlist entry and disclose its format',async()=>{
  const first=(await diagnose('default',ownerHeaders,'&index=0')).data;
  assert.equal(first.index,0);assert.equal(first.format,'mpegts');assert.equal(first.hops.at(-1).status,403);
  const {status,data}=await diagnose('default',ownerHeaders,'&index=1');assert.equal(status,200);
  assert.deepEqual(data,{profile:'default',index:1,format:'hls',container:'hls',hops:[{origin:'https://tv.lumanest.tv',status:200,contentType:'application/vnd.apple.mpegurl'}]});
  const output=JSON.stringify(data);
  for(const secret of ['runtime-private-user','runtime-secret-password','runtime-private-token','Private second channel','/live/','private-second-stream-body','?token='])assert.ok(!output.includes(secret));
});

test('the cast profile follows the playlist a TV would fetch and reports only origins and formats',async()=>{
  const {status,data}=await diagnose('cast',ownerHeaders,'&index=1');
  assert.equal(status,200);
  assert.equal(data.profile,'cast');assert.equal(data.steps[0].container,'hls');
  assert.deepEqual(data.steps[0].playlist,{master:false,entries:1,childOrigin:'https://tv.lumanest.tv',childExtension:'',childApproved:true});
  assert.equal(data.steps[1].error,'upstream_400');
  const output=JSON.stringify(data);
  for(const secret of ['runtime-private-user','runtime-secret-password','runtime-private-token','private-second-stream-body','/live/','?token='])assert.ok(!output.includes(secret));
  assert.equal((await diagnose('cast',{'test-player-session':'valid'},'&index=1')).status,401);
});

test('channel selection rejects malformed, duplicated and out-of-playlist indices',async()=>{
  for(const index of ['', '-1', '01', '1.0', '1e0', '0x1', ' 1', '+1', 'NaN', 'Infinity', '49999', '50000', '100000', 'https://attacker.invalid/private']) {
    const {status,data}=await diagnose('default',ownerHeaders,'&index='+encodeURIComponent(index));
    assert.equal(status,400,index);assert.equal(data.error.code,'invalid_diagnostic_index',index);
    assert.ok(!JSON.stringify(data).includes('runtime-private-user'));
  }
  assert.equal((await diagnose('default',ownerHeaders,'&index=0&index=1')).status,400);
  assert.equal((await diagnose('default',{'test-player-session':'valid'},'&index=1')).status,401);
  const noSession={...ownerHeaders};delete noSession['test-player-session'];
  assert.equal((await diagnose('default',noSession,'&index=1')).status,401);
});

test('indexed diagnostics retain the provider allowlist and ignore arbitrary caller supplied stream URLs',async()=>{
  const unapproved=(await diagnose('default',ownerHeaders,'&index=2')).data;
  assert.deepEqual(unapproved,{profile:'default',index:2,format:'mpegts',hops:[],error:'stream_connection_failed',errorCode:'stream_origin_blocked',blockedOrigin:'https://127.0.0.1'});
  const injection=(await diagnose('default',ownerHeaders,'&index=1&url='+encodeURIComponent('http://169.254.169.254/private'))).data;
  assert.deepEqual(injection,{profile:'default',index:1,format:'hls',container:'hls',hops:[{origin:'https://tv.lumanest.tv',status:200,contentType:'application/vnd.apple.mpegurl'}]});
});

test('a blocked redirect discloses only its origin and fixed failure code without fetching its destination',async()=>{
  const {status,data}=await diagnose('default',ownerHeaders,'&index=3');
  assert.equal(status,200);
  assert.deepEqual(data,{profile:'default',index:3,format:'mpegts',hops:[{origin:'https://tv.lumanest.tv',status:302,contentType:'other'}],error:'stream_connection_failed',errorCode:'stream_origin_blocked',blockedOrigin:'https://blocked-provider.example:8443'});
  for(const secret of ['private-user','private-password','private-path','private-query','should-never-be-fetched','runtime-private-user','runtime-secret-password'])assert.ok(!JSON.stringify(data).includes(secret));
});

test('configured stream alias avoids direct IP fetches without exposing the private media path',async()=>{
  const worker=await runtime.getWorker('player-runtime-mapped');
  const response=await worker.fetch('https://lumanest.tv/api/player/diagnostics',{headers:ownerHeaders});
  const data=await response.json();assert.equal(response.status,200);
  assert.deepEqual(data.hops.at(-1),{origin:'http://media.lumanest.tv',status:200,contentType:'video/mp2t'});
  assert.equal(data.hint,undefined);assert.ok(!JSON.stringify(data).includes('runtime-private-user'));
});

test('a public portal alias preserves the primary playlist connection and approved media origin mapping',async()=>{
  const worker=await runtime.getWorker('player-runtime-public-alias');
  const response=await worker.fetch('https://lumanest.tv/api/player/diagnostics',{headers:ownerHeaders});
  const data=await response.json();assert.equal(response.status,200);
  assert.deepEqual(data,{profile:'default',hops:[{origin:'https://tv.lumanest.tv',status:301,contentType:'other'},{origin:'http://turbobunny.net',status:302,contentType:'other'},{origin:'http://media.lumanest.tv',status:200,contentType:'video/mp2t'}]});
  const output=JSON.stringify(data);
  for(const secret of ['runtime-private-user','runtime-secret-password','runtime-private-token','/live/','private-stream-body','?u='])assert.ok(!output.includes(secret));
});

test('configured relay diagnostics use original provider origins while allowing only the bounded rotating pool',async()=>{
  const worker=await runtime.getWorker('player-runtime-relay');
  const diagnoseRelay=async index=>{
    const response=await worker.fetch('https://lumanest.tv/api/player/diagnostics?index='+index,{headers:ownerHeaders});
    assert.equal(response.status,200);
    return response.json();
  };
  const first=await diagnoseRelay(0);
  assert.deepEqual(first.hops,[{origin:'https://tv.lumanest.tv',status:301,contentType:'other'},{origin:'http://turbobunny.net',status:302,contentType:'other'},{origin:'http://38.190.178.54',status:200,contentType:'video/mp2t'}]);
  const rotating=await diagnoseRelay(4);
  assert.deepEqual(rotating.hops,[{origin:'http://136.148.65.42',status:200,contentType:'video/mp2t'}]);
  const redirected=await diagnoseRelay(7);
  assert.deepEqual(redirected.hops,[{origin:'https://tv.lumanest.tv',status:302,contentType:'other'},{origin:'http://136.148.65.254',status:200,contentType:'video/mp2t'}]);
  for(const index of [2,5]){
    const blocked=await diagnoseRelay(index);
    assert.equal(blocked.errorCode,'stream_origin_blocked');assert.deepEqual(blocked.hops,[]);
  }
  const withoutRelay=await diagnose('default',ownerHeaders,'&index=4');
  assert.equal(withoutRelay.data.errorCode,'stream_origin_blocked');assert.deepEqual(withoutRelay.data.hops,[]);
  const output=JSON.stringify([first,rotating,redirected]);
  for(const secret of ['runtime-private-user','runtime-secret-password','runtime-private-token','/live/','relay-stream-body','streams.lumanest.tv','Bearer','b'.repeat(64),'media.lumanest.tv'])assert.ok(!output.includes(secret));
});

test('encrypted playlist tokens deliver relay MPEG-TS and ranges without exposing or remapping provider URLs',async()=>{
  const worker=await runtime.getWorker('player-runtime-relay');
  const listed=await worker.fetch('https://lumanest.tv/api/player/channels',{headers:{'test-player-session':'valid'}});
  assert.equal(listed.status,200);
  const {channels}=await listed.json();
  for(const index of [4,6,7,8])assert.equal(typeof channels[index].token,'string');
  for(const index of [2,5])assert.equal(channels[index].token,null);
  const publicPlaylist=JSON.stringify(channels);
  for(const secret of ['runtime-private-user','runtime-secret-password','runtime-private-token','136.148.65.42','38.190.178.54','/live/','streams.lumanest.tv','b'.repeat(64)])assert.ok(!publicPlaylist.includes(secret));
  const streamURL=index=>'https://lumanest.tv/api/player/stream?token='+encodeURIComponent(channels[index].token);
  for(const [index,host] of [[4,'136.148.65.42'],[7,'136.148.65.254'],[8,'38.190.178.54']]){
    const response=await worker.fetch(streamURL(index)+'&url='+encodeURIComponent('http://169.254.169.254/private'),{headers:{'test-player-session':'valid'}});
    assert.equal(response.status,200);
    assert.equal(response.headers.get('Content-Type'),'video/mp2t');
    assert.equal(response.headers.get('Cache-Control'),'private, no-store');
    assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
    assert.equal(await response.text(),'relay-stream-body-'+host);
  }
  const range=await worker.fetch(streamURL(4),{headers:{'test-player-session':'valid',Range:'bytes=120-240'}});
  assert.equal(range.status,206);assert.equal(range.headers.get('Content-Range'),'bytes 120-240/1000');assert.equal(range.headers.get('Accept-Ranges'),'bytes');
  assert.equal(await range.text(),'relay-range-body');
});

test('HLS returned by the relay seals relative segments against the original provider URL',async()=>{
  const worker=await runtime.getWorker('player-runtime-relay');
  const listed=await worker.fetch('https://lumanest.tv/api/player/channels',{headers:{'test-player-session':'valid'}});
  const {channels}=await listed.json();
  const response=await worker.fetch('https://lumanest.tv/api/player/stream?token='+encodeURIComponent(channels[6].token),{headers:{'test-player-session':'valid'}});
  assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'application/vnd.apple.mpegurl');
  const playlist=await response.text();
  const segment=playlist.split('\n').find(line=>line.startsWith('/api/player/stream?token='));
  assert.ok(segment);
  for(const secret of ['runtime-private-user','runtime-secret-password','runtime-private-token','136.148.65.43','streams.lumanest.tv','segment.ts','b'.repeat(64)])assert.ok(!playlist.includes(secret));
  const media=await worker.fetch('https://lumanest.tv'+segment,{headers:{'test-player-session':'valid'}});
  assert.equal(media.status,200);assert.equal(await media.text(),'relay-stream-body-136.148.65.43');
});

test('relay media keeps customer authentication and encrypted-token checks before outbound access',async()=>{
  const worker=await runtime.getWorker('player-runtime-relay');
  const missing=await worker.fetch('https://lumanest.tv/api/player/stream?url='+encodeURIComponent('http://136.148.65.42/private'));
  assert.equal(missing.status,401);
  const noToken=await worker.fetch('https://lumanest.tv/api/player/stream?url='+encodeURIComponent('http://136.148.65.42/private'),{headers:{'test-player-session':'valid'}});
  assert.equal(noToken.status,400);
  const invalid=await worker.fetch('https://lumanest.tv/api/player/stream?token='+encodeURIComponent('http://136.148.65.42/private'),{headers:{'test-player-session':'valid'}});
  assert.equal(invalid.status,403);
  const output=JSON.stringify([await missing.json(),await noToken.json(),await invalid.json()]);
  for(const secret of ['runtime-private-user','runtime-secret-password','136.148.65.42','streams.lumanest.tv','Bearer','b'.repeat(64)])assert.ok(!output.includes(secret));
});

test('player sign-out revokes the sealed session for channel lists, stream starts and HLS playlist refreshes',async()=>{
  const worker=await runtime.getWorker('player-runtime-relay'),headers={'test-player-session':'revocable'};
  const listed=await worker.fetch('https://lumanest.tv/api/player/channels',{headers});
  assert.equal(listed.status,200);
  const {channels}=await listed.json();
  const stream=index=>worker.fetch('https://lumanest.tv/api/player/stream?token='+encodeURIComponent(channels[index].token),{headers});
  const playlist=await stream(6);assert.equal(playlist.status,200);
  const segment=(await playlist.text()).split('\n').find(line=>line.startsWith('/api/player/stream?token='));
  const signedOut=await worker.fetch('https://lumanest.tv/api/player/logout',{method:'POST',headers:{...headers,'test-same-origin':'1','Content-Type':'application/json'},body:'{}'});
  assert.equal(signedOut.status,200);assert.match(signedOut.headers.get('Set-Cookie'),/Max-Age=0/);
  const database=await runtime.getD1Database('DB','player-runtime-relay');
  assert.equal(await database.prepare('SELECT COUNT(*) AS count FROM player_revoked_sessions').first('count'),1);
  const relisted=await worker.fetch('https://lumanest.tv/api/player/channels',{headers});
  assert.equal(relisted.status,401);assert.match(relisted.headers.get('Set-Cookie'),/Max-Age=0/);
  for(const index of [4,6])assert.equal((await stream(index)).status,401);
  // Segment tokens already handed out stay usable; new live segments need a playlist refresh, which is checked.
  assert.equal((await worker.fetch('https://lumanest.tv'+segment,{headers})).status,200);
  assert.equal((await worker.fetch('https://lumanest.tv/api/player/channels',{headers:{'test-player-session':'valid'}})).status,200);
});

test('casting hands a TV a cookie-free, CORS-enabled HLS link that stops when the player signs out',async()=>{
  const worker=await runtime.getWorker('player-runtime'),headers={'test-player-session':'valid'};
  const {channels}=await (await worker.fetch('https://lumanest.tv/api/player/channels',{headers})).json();
  const token=channels[1].token;assert.equal(typeof token,'string');
  const cast=body=>worker.fetch('https://lumanest.tv/api/player/cast',{method:'POST',headers:{...headers,'test-same-origin':'1','Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await worker.fetch('https://lumanest.tv/api/player/cast',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({token})})).status,403);
  assert.equal((await cast({token:'not-a-token'})).status,403);
  const created=await cast({token});assert.equal(created.status,200);
  const link=await created.json();
  assert.match(link.url,/^https:\/\/lumanest\.tv\/api\/cast\/live\.m3u8\?t=/);
  assert.equal(link.contentType,'application/x-mpegURL');assert.equal(link.live,true);
  for(const secret of ['runtime-private-user','runtime-secret-password','runtime-private-token'])assert.ok(!JSON.stringify(link).includes(secret));
  const played=await worker.fetch(link.url);
  assert.equal(played.status,200);assert.equal(played.headers.get('Access-Control-Allow-Origin'),'*');
  const playlist=await played.text();
  assert.match(playlist,/^#EXTM3U/);assert.match(playlist,/\/api\/cast\/(media|segment\.ts|live\.m3u8)\?t=/);
  const head=await worker.fetch(link.url,{method:'HEAD'});
  assert.equal(head.status,200);assert.equal(head.headers.get('Access-Control-Allow-Origin'),'*');assert.equal(await head.text(),'');
  // Links handed out before cast links were named like files keep working.
  assert.equal((await worker.fetch(link.url.replace('/api/cast/live.m3u8','/api/cast/stream'))).status,200);
  for(const secret of ['runtime-private-user','runtime-secret-password','runtime-private-token'])assert.ok(!playlist.includes(secret));
  const forged=await worker.fetch('https://lumanest.tv/api/cast/stream?t=forged');
  assert.equal(forged.status,403);assert.equal(forged.headers.get('Access-Control-Allow-Origin'),'*');
  assert.equal((await worker.fetch('https://lumanest.tv/api/player/logout',{method:'POST',headers:{...headers,'test-same-origin':'1','Content-Type':'application/json'},body:'{}'})).status,200);
  assert.equal((await worker.fetch(link.url)).status,401);
});
