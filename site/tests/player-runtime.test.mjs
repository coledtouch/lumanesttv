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
        import {seal, open} from './lib/player-crypto.ts';
        import {PLAYER_COOKIE} from './lib/player.ts';
        import {cleanup} from './lib/maintenance.ts';
        import {env} from 'cloudflare:workers';
        // Casts re-check sign-out once a minute; here every 200 ms, so a test can see an open cast stop.
        const setIntervalOnce = globalThis.setInterval.bind(globalThis);
        globalThis.setInterval = (callback, delay, ...args) => setIntervalOnce(callback, delay >= 60000 ? 200 : delay, ...args);
        // Keeps console.log lines, which \`wrangler tail\` would show, for /test/logs.
        const logged = [];
        console.log = (...args) => {logged.push(args.join(' '));};
        export default {async fetch(request) {
          globalThis.__testHeaders = request.headers;
          const headers = new Headers(request.headers);
          const kind = headers.get('test-player-session');
          // A 'brief' player session expires 4 seconds after its first request.
          if (kind === 'valid' || kind === 'revocable' || kind === 'brief' || kind === 'swept') {
            const sessions = globalThis.__testPlayerSessions ||= {};
            sessions[kind] ||= await seal({username:'runtime-private-user',password:'runtime-secret-password',exp:Date.now()+(kind === 'brief' ? 4000 : 60000),sid:crypto.randomUUID()}, env.PLAYER_COOKIE_KEY, 'player-session');
            headers.set('Cookie', PLAYER_COOKIE + '=' + sessions[kind]);
          }
          // Miniflare rejects Origin on direct worker fetches; the test adds the same-site header here instead.
          if (headers.get('test-same-origin')) headers.set('Origin', new URL(request.url).origin);
          const pathname = new URL(request.url).pathname;
          if (pathname === '/test/logs') return Response.json(logged.splice(0));
          // Maintenance cleanup as if it ran at ?now= (it runs about every 15 minutes in production).
          if (pathname === '/test/cleanup') return Response.json(await cleanup(Number(new URL(request.url).searchParams.get('now'))));
          // Re-seals a cast link to expire sooner, as if it had been made hours ago.
          if (pathname === '/test/shorten-cast') {
            const params = new URL(request.url).searchParams, link = new URL(params.get('link'));
            const item = await open(link.searchParams.get('t'), env.PLAYER_COOKIE_KEY, 'player-cast');
            item.exp = Date.now() + Number(params.get('ms'));
            link.searchParams.set('t', await seal(item, env.PLAYER_COOKIE_KEY, 'player-cast'));
            return Response.json({url: link.href, expiresAt: item.exp});
          }
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
  // enable_request_signal as in production (scripts/prepare-cloudflare.mjs): a viewer hanging up aborts request.signal.
  runtime = new Miniflare({
    compatibilityDate:'2026-05-15', compatibilityFlags:['nodejs_compat'], cf:false,
    workers:[{
      name:'player-runtime', compatibilityDate:'2026-05-15', compatibilityFlags:['nodejs_compat','enable_request_signal'], modules:true, script:bundle.outputFiles[0].text,scriptPath:fileURLToPath(new URL('../player-runtime-worker.js',import.meta.url)),d1Databases:{DB:'player-owner-default'},
      bindings:{ADMIN_USER_ID:'runtime-owner',PLAYER_COOKIE_KEY:'a'.repeat(64),CUSTOMER_PORTAL_URL:'https://tv.lumanest.tv',PLAYER_ALLOWED_HOSTS:'tv.lumanest.tv',PLAYER_ALLOWED_HTTP_HOSTS:'tv.lumanest.tv,turbobunny.net,38.190.178.54'},outboundService:'mock-player-upstream'
    },{
      name:'player-runtime-mapped', compatibilityDate:'2026-05-15', compatibilityFlags:['nodejs_compat','enable_request_signal'], modules:true, script:bundle.outputFiles[0].text,scriptPath:fileURLToPath(new URL('../player-runtime-worker.js',import.meta.url)),d1Databases:{DB:'player-owner-mapped'},
      bindings:{ADMIN_USER_ID:'runtime-owner',PLAYER_COOKIE_KEY:'a'.repeat(64),CUSTOMER_PORTAL_URL:'https://tv.lumanest.tv',PLAYER_ALLOWED_HOSTS:'tv.lumanest.tv',PLAYER_ALLOWED_HTTP_HOSTS:'tv.lumanest.tv,turbobunny.net,38.190.178.54,media.lumanest.tv',PLAYER_STREAM_ORIGIN_MAP:JSON.stringify({'http://38.190.178.54':'http://media.lumanest.tv'})},outboundService:'mock-player-upstream'
    },{
      name:'player-runtime-public-alias', compatibilityDate:'2026-05-15', compatibilityFlags:['nodejs_compat','enable_request_signal'], modules:true, script:bundle.outputFiles[0].text,scriptPath:fileURLToPath(new URL('../player-runtime-worker.js',import.meta.url)),d1Databases:{DB:'player-owner-public-alias'},
      bindings:{ADMIN_USER_ID:'runtime-owner',PLAYER_COOKIE_KEY:'a'.repeat(64),CUSTOMER_PORTAL_URL:'https://portal.lumanest.tv',CUSTOMER_PORTAL_PRIMARY_URL:'https://tv.lumanest.tv',PLAYER_ALLOWED_HOSTS:'tv.lumanest.tv,portal.lumanest.tv',PLAYER_ALLOWED_HTTP_HOSTS:'tv.lumanest.tv,portal.lumanest.tv,turbobunny.net,38.190.178.54,media.lumanest.tv',PLAYER_STREAM_ORIGIN_MAP:JSON.stringify({'http://38.190.178.54':'http://media.lumanest.tv'})},outboundService:'mock-player-upstream'
    },{
      name:'player-runtime-relay', compatibilityDate:'2026-05-15', compatibilityFlags:['nodejs_compat','enable_request_signal'], modules:true, script:bundle.outputFiles[0].text,scriptPath:fileURLToPath(new URL('../player-runtime-worker.js',import.meta.url)),d1Databases:{DB:'player-owner-relay'},
      bindings:{ADMIN_USER_ID:'runtime-owner',PLAYER_COOKIE_KEY:'a'.repeat(64),CUSTOMER_PORTAL_URL:'https://tv.lumanest.tv',PLAYER_ALLOWED_HOSTS:'tv.lumanest.tv',PLAYER_ALLOWED_HTTP_HOSTS:'tv.lumanest.tv,turbobunny.net,38.190.178.54,media.lumanest.tv',PLAYER_STREAM_ORIGIN_MAP:JSON.stringify({'http://38.190.178.54':'http://media.lumanest.tv'}),PLAYER_STREAM_RELAY_URL:'https://streams.lumanest.tv/relay',PLAYER_STREAM_RELAY_KEY:'b'.repeat(64)},outboundService:'mock-player-upstream'
    },{
      name:'mock-player-upstream', modules:true, compatibilityFlags:['streams_enable_constructors'],
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
            return new Response('#EXTM3U\\n#EXTINF:-1,First\\nhttp://tv.lumanest.tv/live/runtime-private-user/runtime-secret-password/1?token=runtime-private-token\\n#EXTINF:-1,Private second channel\\nhttps://tv.lumanest.tv/live/runtime-private-user/runtime-secret-password/2.m3u8?token=runtime-private-token\\n#EXTINF:-1,Unapproved provider source\\nhttps://127.0.0.1/private-stream?token=runtime-private-token\\n#EXTINF:-1,Blocked redirect\\nhttps://tv.lumanest.tv/live/runtime-private-user/runtime-secret-password/3?token=runtime-private-token\\n#EXTINF:-1,Rotating provider stream\\nhttp://136.148.65.42/live/runtime-private-user/runtime-secret-password/42?token=runtime-private-token\\n#EXTINF:-1,Other public stream\\nhttp://8.8.8.8/live/runtime-private-user/runtime-secret-password/42?token=runtime-private-token\\n#EXTINF:-1,Relay HLS playlist\\nhttp://136.148.65.43/live/runtime-private-user/runtime-secret-password/playlist.m3u8?token=runtime-private-token\\n#EXTINF:-1,Rotating provider redirect\\nhttps://tv.lumanest.tv/live/runtime-private-user/runtime-secret-password/4?token=runtime-private-token\\n#EXTINF:-1,Legacy direct provider\\nhttp://38.190.178.54/live/runtime-private-user/runtime-secret-password/42?token=runtime-private-token\\n#EXTINF:-1,Raw TS live\\nhttps://tv.lumanest.tv/live/runtime-private-user/runtime-secret-password/5.ts?token=runtime-private-token\\n#EXTINF:-1,Endless TS live\\nhttps://tv.lumanest.tv/live/runtime-private-user/runtime-secret-password/6.ts?token=runtime-private-token\\n#EXTINF:-1,Failing TS live\\nhttps://tv.lumanest.tv/live/runtime-private-user/runtime-secret-password/7.ts?token=runtime-private-token', {headers:{'Content-Type':'text/plain'}});
          }
          if (url.pathname === '/live/runtime-private-user/runtime-secret-password/2.m3u8' && url.search === '?token=runtime-private-token' && url.origin === 'https://tv.lumanest.tv') return new Response('#EXTM3U\\nprivate-second-stream-body',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
          if (url.pathname === '/live/runtime-private-user/runtime-secret-password/3' && url.origin === 'https://tv.lumanest.tv') return new Response(null,{status:302,headers:{Location:'https://private-user:private-password@blocked-provider.example:8443/private-path?secret=private-query'}});
          if (url.pathname === '/live/runtime-private-user/runtime-secret-password/4' && url.origin === 'https://tv.lumanest.tv') return new Response(null,{status:302,headers:{Location:'http://136.148.65.254/live/runtime-private-user/runtime-secret-password/254?token=runtime-private-token'}});
          if (url.hostname === 'blocked-provider.example') return new Response('should-never-be-fetched',{headers:{'Content-Type':'video/mp2t'}});
          // Like the real provider: raw MPEG-TS labelled video/mp4.
          if (url.pathname === '/live/runtime-private-user/runtime-secret-password/5.ts' && url.search === '?token=runtime-private-token' && url.origin === 'https://tv.lumanest.tv') return new Response('raw-ts-live-body',{headers:{'Content-Type':'video/mp4'}});
          // A live channel that never ends. /live-chunks counts what it has sent, which stops growing once nobody is connected.
          if (url.pathname === '/live/runtime-private-user/runtime-secret-password/6.ts' && url.search === '?token=runtime-private-token' && url.origin === 'https://tv.lumanest.tv') {
            let timer;
            return new Response(new ReadableStream({start(controller) {timer = setInterval(() => {try {controller.enqueue(new TextEncoder().encode('endless-ts-chunk')); globalThis.liveChunks = (globalThis.liveChunks || 0) + 1;} catch {clearInterval(timer);}}, 50);}, cancel() {clearInterval(timer);}}),{headers:{'Content-Type':'video/mp4'}});
          }
          // A live channel whose connection fails after a few chunks.
          if (url.pathname === '/live/runtime-private-user/runtime-secret-password/7.ts' && url.search === '?token=runtime-private-token' && url.origin === 'https://tv.lumanest.tv') {
            let timer, sent = 0;
            return new Response(new ReadableStream({start(controller) {timer = setInterval(() => {if (++sent > 3) {clearInterval(timer); controller.error(new Error('provider connection reset'));} else controller.enqueue(new TextEncoder().encode('failing-ts-chunk'));}, 50);}, cancel() {clearInterval(timer);}}),{headers:{'Content-Type':'video/mp4'}});
          }
          if (url.pathname === '/live-chunks') return new Response(String(globalThis.liveChunks || 0));
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
  assert.equal(data.profile,'cast');assert.equal(data.steps[0].request,'/live/*/*/N.m3u8');assert.equal(data.steps[0].hops[0].path,'/live/*/*/N.m3u8');assert.equal(data.variants,undefined);assert.equal(data.steps[0].container,'hls');
  assert.deepEqual(data.steps[0].playlist,{master:false,entries:1,childOrigin:'https://tv.lumanest.tv',childExtension:'',childApproved:true});
  assert.equal(data.steps[1].error,'upstream_400');
  const output=JSON.stringify(data);
  for(const secret of ['runtime-private-user','runtime-secret-password','runtime-private-token','private-second-stream-body','?token='])assert.ok(!output.includes(secret));
  assert.equal((await diagnose('cast',{'test-player-session':'valid'},'&index=1')).status,401);
});

test('when the provider answers without HLS, the cast profile probes other HLS requests without exposing the login',async()=>{
  const {status,data}=await diagnose('cast',ownerHeaders,'&index=0');
  assert.equal(status,200);assert.notEqual(data.steps[0].container,'hls');
  assert.deepEqual(data.variants.map(v=>v.label),['short-path','output-param','vlc-agent']);
  assert.equal(data.variants[0].request,'/*/*/N.m3u8');
  const output=JSON.stringify(data);
  for(const secret of ['runtime-private-user','runtime-secret-password','runtime-private-token','?token=','output=m3u8'])assert.ok(!output.includes(secret));
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

test('LumaNest\'s Cast receiver gets a raw MPEG-TS live.ts link labelled video/mp2t; other receivers keep HLS',async()=>{
  const worker=await runtime.getWorker('player-runtime-mapped'),headers={'test-player-session':'revocable'};
  const {channels}=await (await worker.fetch('https://lumanest.tv/api/player/channels',{headers})).json();
  const raw=channels[9];assert.equal(raw.format,'mpegts');assert.equal(typeof raw.token,'string');
  const cast=body=>worker.fetch('https://lumanest.tv/api/player/cast',{method:'POST',headers:{...headers,'test-same-origin':'1','Content-Type':'application/json'},body:JSON.stringify(body)});
  const secrets=['runtime-private-user','runtime-secret-password','runtime-private-token','5.ts?token','/live/'];

  // Default (Default Media Receiver, AirPlay, Remote Playback): unchanged HLS link.
  const plain=await (await cast({token:raw.token})).json();
  assert.match(plain.url,/^https:\/\/lumanest\.tv\/api\/cast\/live\.m3u8\?t=/);
  assert.equal(plain.contentType,'application/x-mpegURL');assert.equal(plain.format,undefined);
  // An unknown receiver value is ignored rather than trusted.
  assert.match((await (await cast({token:raw.token,receiver:'other'})).json()).url,/\/api\/cast\/live\.m3u8\?t=/);

  const created=await cast({token:raw.token,receiver:'lumanest'});assert.equal(created.status,200);
  assert.equal(created.headers.get('Cache-Control'),'no-store');
  const link=await created.json();
  assert.match(link.url,/^https:\/\/lumanest\.tv\/api\/cast\/live\.ts\?t=/);
  assert.deepEqual([link.contentType,link.live,link.format,typeof link.expiresAt],['video/mp2t',true,'mpegts','number']);
  assert.ok(link.expiresAt<=Date.now()+4*60*60*1000);
  for(const secret of secrets)assert.ok(!JSON.stringify(link).includes(secret),secret);

  // The TV fetches it without cookies; the provider's video/mp4 label becomes video/mp2t and the body passes through.
  const played=await worker.fetch(link.url);
  assert.equal(played.status,200);
  assert.equal(played.headers.get('Content-Type'),'video/mp2t');
  assert.equal(played.headers.get('Access-Control-Allow-Origin'),'*');
  assert.equal(played.headers.get('Cache-Control'),'private, no-store');
  assert.equal(played.headers.get('X-Content-Type-Options'),'nosniff');
  assert.equal(await played.text(),'raw-ts-live-body');
  for(const [name,value] of played.headers)for(const secret of secrets)assert.ok(!value.includes(secret),name);
  const head=await worker.fetch(link.url,{method:'HEAD'});
  assert.equal(head.status,200);assert.equal(head.headers.get('Content-Type'),'video/mp2t');assert.equal(head.headers.get('Access-Control-Allow-Origin'),'*');

  // HLS channels still get HLS from the custom receiver. The sealed token, not the file name, decides the format.
  const hls=await (await cast({token:channels[1].token,receiver:'lumanest'})).json();
  assert.match(hls.url,/\/api\/cast\/live\.m3u8\?t=/);assert.equal(hls.contentType,'application/x-mpegURL');assert.equal(hls.format,undefined);
  assert.equal((await worker.fetch(link.url.replace('/api/cast/live.ts','/api/cast/stream'))).headers.get('Content-Type'),'video/mp2t');
  const forged=await worker.fetch('https://lumanest.tv/api/cast/live.ts?t=forged');
  assert.equal(forged.status,403);assert.equal(forged.headers.get('Access-Control-Allow-Origin'),'*');
  // Signing out of the web player stops the TV's next connection with 401, which the receiver shows as "cast again".
  assert.equal((await worker.fetch('https://lumanest.tv/api/player/logout',{method:'POST',headers:{...headers,'test-same-origin':'1','Content-Type':'application/json'},body:'{}'})).status,200);
  const signedOut=await worker.fetch(link.url);
  assert.equal(signedOut.status,401);assert.equal(signedOut.headers.get('Access-Control-Allow-Origin'),'*');
});

// Lines the worker logged since the last call, waiting up to 3 s for `count` of them (a stream's end is logged once it settles).
async function loggedLines(worker,count=0){
  const lines=[];
  for(const started=Date.now();;await new Promise(resolve=>setTimeout(resolve,50))){
    lines.push(...await (await worker.fetch('https://lumanest.tv/test/logs')).json());
    if(lines.length>=count||Date.now()-started>3000)return lines;
  }
}
const streamEnd=line=>{
  const match=/^lumanest_cast_stream_end (\{"seconds":\d+,"end":"(clean|abort|error|expired|revoked)"\})$/.exec(line);
  assert.ok(match,line);
  return JSON.parse(match[1]);
};

test('an open live.ts cast stops when the player signs out or the cast link expires, and its provider connection closes',{timeout:20000},async()=>{
  const worker=await runtime.getWorker('player-runtime'),upstream=await runtime.getWorker('mock-player-upstream');
  const createLive=async headers=>{
    const {channels}=await (await worker.fetch('https://lumanest.tv/api/player/channels',{headers})).json();
    const created=await worker.fetch('https://lumanest.tv/api/player/cast',{method:'POST',headers:{...headers,'test-same-origin':'1','Content-Type':'application/json'},body:JSON.stringify({token:channels[10].token,receiver:'lumanest'})});
    const link=await created.json();assert.match(link.url,/\/api\/cast\/live\.ts\?t=/);
    return link;
  };
  const play=async url=>{
    const played=await worker.fetch(url);assert.equal(played.status,200);
    const reader=played.body.getReader();
    assert.equal((await reader.read()).done,false);
    return reader;
  };
  // Resolves once the server ends the TV's connection, whether it closes or fails.
  const untilCut=async reader=>{try {while(!(await reader.read()).done);} catch {}};
  const chunksSent=async()=>Number(await (await upstream.fetch('https://tv.lumanest.tv/live-chunks')).text());
  // A hang-up takes a moment to travel from this client through Miniflare to the worker, hence `settle`.
  const assertProviderClosed=async(settle=0)=>{
    await new Promise(resolve=>setTimeout(resolve,settle));
    const sent=await chunksSent();await new Promise(resolve=>setTimeout(resolve,300));
    assert.equal(await chunksSent(),sent);
  };
  await loggedLines(worker);

  const signedIn={'test-player-session':'revocable'};
  const live=await createLive(signedIn);
  const reader=await play(live.url);
  assert.equal((await worker.fetch('https://lumanest.tv/api/player/logout',{method:'POST',headers:{...signedIn,'test-same-origin':'1','Content-Type':'application/json'},body:'{}'})).status,200);
  const signedOutAt=Date.now();
  await untilCut(reader);
  assert.ok(Date.now()-signedOutAt<5000);
  await assertProviderClosed();
  assert.equal((await worker.fetch(live.url)).status,401);
  assert.equal(streamEnd((await loggedLines(worker,1))[0]).end,'revoked');

  // The link lasts 4 hours from the cast, not until the player's sign-in expires (4 s after it starts for 'brief').
  const brief={'test-player-session':'brief'};
  const lasting=await createLive(brief);
  assert.ok(lasting.expiresAt>Date.now()+4*60*60*1000-60000);
  // A TV hanging up ends the provider connection too.
  const hungUp=await play(lasting.url);
  await hungUp.cancel();
  await assertProviderClosed(300);
  assert.equal(streamEnd((await loggedLines(worker,1))[0]).end,'abort');

  // Re-sealed to end in 2 s, as if cast hours ago: the open stream is cut at expiry and reconnecting is refused.
  const short=await (await worker.fetch('https://lumanest.tv/test/shorten-cast?ms=2000&link='+encodeURIComponent(lasting.url))).json();
  const expiring=await play(short.url);
  await untilCut(expiring);
  assert.ok(Date.now()>=short.expiresAt-500);
  await assertProviderClosed();
  assert.equal((await worker.fetch(short.url)).status,403);
  const expired=streamEnd((await loggedLines(worker,1))[0]);
  assert.equal(expired.end,'expired');assert.ok(expired.seconds<=3,String(expired.seconds));

  // Once the brief sign-in has expired, the 4-hour link still plays and keeps playing through sign-out rechecks.
  while((await worker.fetch('https://lumanest.tv/api/player/channels',{headers:brief})).status!==401)await new Promise(resolve=>setTimeout(resolve,200));
  const stillPlaying=await play(lasting.url);
  for(const until=Date.now()+700;Date.now()<until;)assert.equal((await stillPlaying.read()).done,false);
  await stillPlaying.cancel();
  await assertProviderClosed(300);
  const lines=await loggedLines(worker,1);
  assert.equal(lines.length,1);assert.equal(streamEnd(lines[0]).end,'abort');
});

test('a live.ts cast logs one line, with no link or login, when its provider ends or fails the stream',{timeout:10000},async()=>{
  const worker=await runtime.getWorker('player-runtime-relay'),headers={'test-player-session':'valid'};
  const {channels}=await (await worker.fetch('https://lumanest.tv/api/player/channels',{headers})).json();
  const cast=async index=>(await (await worker.fetch('https://lumanest.tv/api/player/cast',{method:'POST',headers:{...headers,'test-same-origin':'1','Content-Type':'application/json'},body:JSON.stringify({token:channels[index].token,receiver:'lumanest'})})).json()).url;
  await loggedLines(worker);
  const finished=await worker.fetch(await cast(9));
  assert.equal(await finished.text(),'raw-ts-live-body');
  // Timings carry durations only: the sign-out check, then the provider hop.
  assert.match(finished.headers.get('Server-Timing'),/^session;dur=\d+, hop1;dur=\d+$/);
  const failed=await worker.fetch(await cast(11));
  assert.equal(failed.status,200);
  const reader=failed.body.getReader();
  let received='';
  // The response is cut short; Miniflare may report that as a plain end, and a TV sees EARLY_EOF either way.
  try {for(let read;!(read=await reader.read()).done;)received+=new TextDecoder().decode(read.value);} catch {}
  assert.equal(received,'failing-ts-chunk'.repeat(3));
  // A HEAD is not playback and is not logged.
  assert.equal((await worker.fetch(await cast(9),{method:'HEAD'})).status,200);
  const lines=await loggedLines(worker,2);
  await new Promise(resolve=>setTimeout(resolve,300));
  lines.push(...await loggedLines(worker));
  assert.deepEqual(lines.map(line=>streamEnd(line).end),['clean','error']);
  for(const secret of ['runtime-private-user','runtime-secret-password','runtime-private-token','/live/','?t=','tv.lumanest.tv'])assert.ok(!lines.join('\n').includes(secret),secret);
});

test('the web player\'s live stream is pumped natively: delivered, logged nowhere, and a hang-up closes the provider connection',{timeout:10000},async()=>{
  const worker=await runtime.getWorker('player-runtime-relay'),upstream=await runtime.getWorker('mock-player-upstream'),headers={'test-player-session':'valid'};
  const {channels}=await (await worker.fetch('https://lumanest.tv/api/player/channels',{headers})).json();
  const chunksSent=async()=>Number(await (await upstream.fetch('https://tv.lumanest.tv/live-chunks')).text());
  await loggedLines(worker);
  const played=await worker.fetch('https://lumanest.tv/api/player/stream?token='+encodeURIComponent(channels[10].token),{headers});
  assert.equal(played.status,200);assert.equal(played.headers.get('Content-Type'),'video/mp4');
  assert.match(played.headers.get('Server-Timing'),/^session;dur=\d+, hop1;dur=\d+$/);
  const reader=played.body.getReader();
  let text='';
  while(text.length<'endless-ts-chunk'.length*3)text+=new TextDecoder().decode((await reader.read()).value);
  assert.match(text,/^(endless-ts-chunk)+$/);
  await reader.cancel();
  // Give the hang-up a moment to travel from this client through Miniflare to the worker.
  await new Promise(resolve=>setTimeout(resolve,300));
  const sent=await chunksSent();await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(await chunksSent(),sent);
  assert.deepEqual(await loggedLines(worker),[]);
});

test('a signed-out session\'s cast links stay refused after maintenance cleanup passes the sign-in\'s expiry',async()=>{
  const worker=await runtime.getWorker('player-runtime'),headers={'test-player-session':'swept'};
  const {channels,expiresAt:signInExpires}=await (await worker.fetch('https://lumanest.tv/api/player/channels',{headers})).json();
  const cast=async(index,receiver)=>(await (await worker.fetch('https://lumanest.tv/api/player/cast',{method:'POST',headers:{...headers,'test-same-origin':'1','Content-Type':'application/json'},body:JSON.stringify({token:channels[index].token,receiver})})).json());
  // A raw MPEG-TS link for LumaNest's receiver and an HLS link for other receivers; both outlive the sign-in.
  const links=[await cast(9,'lumanest'),await cast(1)];
  for(const link of links)assert.ok(link.expiresAt>signInExpires);
  assert.equal((await worker.fetch('https://lumanest.tv/api/player/logout',{method:'POST',headers:{...headers,'test-same-origin':'1','Content-Type':'application/json'},body:'{}'})).status,200);
  const refused=async()=>{for(const link of links){const response=await worker.fetch(link.url);assert.equal(response.status,401,link.url.split('?')[0]);await response.body?.cancel();}};
  await refused();
  // Cleanup deletes rows whose `expires` has passed. Run just after the sign-in expired, it must keep this sign-out.
  assert.equal((await (await worker.fetch('https://lumanest.tv/test/cleanup?now='+(signInExpires+1))).json()).player_revoked_sessions,0);
  await refused();
  // And still just before the last of its links expires.
  await (await worker.fetch('https://lumanest.tv/test/cleanup?now='+(Math.max(...links.map(link=>link.expiresAt))-1))).json();
  await refused();
  // The row is kept for exactly as long as a cast link made at the end of the sign-in could play.
  const database=await runtime.getD1Database('DB','player-runtime');
  assert.equal(await database.prepare('SELECT COUNT(*) AS count FROM player_revoked_sessions WHERE expires=?').bind(signInExpires+4*60*60*1000).first('count'),1);
});

test('the Cast receiver serves the installed mpegts.js build unchanged, with its license notices',async()=>{
  const vendored=await readFile(new URL('../public/cast/mpegts.js',import.meta.url));
  const installed=await readFile(new URL('../node_modules/mpegts.js/dist/mpegts.js',import.meta.url));
  assert.ok(vendored.equals(installed),'Copy node_modules/mpegts.js/dist/mpegts.js to public/cast/mpegts.js and update mpegts.js.LICENSE.txt.');
  const {version}=JSON.parse(await readFile(new URL('../node_modules/mpegts.js/package.json',import.meta.url),'utf8'));
  assert.ok((await readFile(new URL('../public/cast/mpegts.js.LICENSE.txt',import.meta.url),'utf8')).startsWith('mpegts.js '+version+' '));
});
