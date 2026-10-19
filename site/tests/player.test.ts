import test from 'node:test';import assert from 'node:assert/strict';import {parseM3U,trustedStreamURL,normalizeProviderURL,mapProviderOrigin,rewriteHLS,validSession,validMedia} from '../lib/player-data.ts';import {seal,open,digest} from '../lib/player-crypto.ts';
test('playlist parser returns only media entries with metadata and supported URL schemes',()=>{const data=parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="News" group-title="Local",News\nhttps://connect.turbobunny.net/live/u/p/1.m3u8\n#EXTINF:-1,Film\nhttps://tv.lumanest.tv/movie/u/p/2.mp4\n#EXTINF:-1,Unsafe\nfile:///etc/passwd');assert.equal(data.length,2);assert.equal(data[0].group,'Local');assert.equal(data[0].format,'hls');assert.equal(data[1].format,'file');assert.throws(()=>parseM3U('<html>Sign in</html>'))});
test('stream proxy restricts origins, protocols and ports',()=>{const allowed=['tv.lumanest.tv','*.turbobunny.net'];assert.equal(trustedStreamURL('https://connect.turbobunny.net/live/1.m3u8',allowed).hostname,'connect.turbobunny.net');for(const url of ['http://tv.lumanest.tv/live','https://127.0.0.1','https://turbobunny.net.evil.test/live','https://evil.test/live','https://tv.lumanest.tv:8080/live','https://user:password@tv.lumanest.tv/live'])assert.throws(()=>trustedStreamURL(url,allowed))});
test('HLS rewrite covers segments, rendition playlists and encryption keys',async()=>{const seen:string[]=[];const output=await rewriteHLS('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/list.m3u8"\nsegment.ts','https://tv.lumanest.tv/live/main.m3u8',async u=>{seen.push(u);return '/sealed/'+seen.length});assert.deepEqual(seen,['https://tv.lumanest.tv/live/key.bin','https://tv.lumanest.tv/live/audio/list.m3u8','https://tv.lumanest.tv/live/segment.ts']);assert.ok(!output.includes('key.bin'));assert.ok(output.includes('URI="/sealed/1"'))});
test('player credentials and media tokens are authenticated encrypted, and tampering is rejected',async()=>{const secret='a'.repeat(64);const token=await seal({username:'customer',password:'private-line-password'},secret,'player-session');assert.ok(!token.includes('private-line-password'));assert.deepEqual(await open(token,secret,'player-session'),{username:'customer',password:'private-line-password'});await assert.rejects(open(token.slice(0,-5)+'XXXXX',secret,'player-session'));await assert.rejects(open(token,'b'.repeat(64),'player-session'));assert.notEqual(await digest('session-one'),await digest('session-two'))});
test('each token purpose uses its own derived key and authenticated label',async()=>{const secret='a'.repeat(64),purposes=['player-session','player-media','renewal-session','renewal-quote'] as const;for(const purpose of purposes){const token=await seal({purpose},secret,purpose);assert.deepEqual(await open(token,secret,purpose),{purpose});for(const other of purposes.filter(value=>value!==purpose))await assert.rejects(open(token,secret,other))}});

test('duplicate provider entries do not produce duplicate channel keys and formats use the URL path',()=>{
  const channels=parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="News, Local" group-title="News",Fallback\nhttps://tv.lumanest.tv/live/1.m3u8?auth=signed#live\n#EXTINF:-1 group-title="Favorites",Duplicate\nhttps://tv.lumanest.tv/live/1.m3u8?auth=signed#live\n#EXTINF:-1,Film\nhttps://tv.lumanest.tv/movie/2.mp4#movie');
  assert.equal(channels.length,2);assert.equal(channels[0].name,'News, Local');assert.equal(channels[0].format,'hls');assert.equal(channels[1].format,'file');
});

test('HLS rewrite uses the redirected playlist base and accepts indented tags',async()=>{
  const seen:string[]=[];
  const output=await rewriteHLS(' #EXTM3U\r\n  #EXT-X-MAP:URI="../init.mp4"\r\n #EXT-X-PART:DURATION=0.5,URI="part.m4s"\r\n segment.ts ','https://connect.turbobunny.net/edge/relocated/main.m3u8',async url=>{seen.push(url);return '/media/'+seen.length});
  assert.deepEqual(seen,['https://connect.turbobunny.net/edge/init.mp4','https://connect.turbobunny.net/edge/relocated/part.m4s','https://connect.turbobunny.net/edge/relocated/segment.ts']);
  assert.ok(output.includes('#EXT-X-MAP:URI="/media/1"'));assert.ok(!output.includes('part.m4s'));
});

test('player sessions require real credentials and finite, future expiry values',()=>{
  const now=1000,session={username:'customer',password:'secret',exp:1001,sid:'0f8b4c1e-2a3d-4b5c-9d6e-7f8091a2b3c4'};
  assert.ok(validSession(session,now));
  for(const value of [null,{}, {...session,username:''},{...session,password:''},{...session,exp:1000},{...session,exp:'1001'},{...session,exp:NaN},{...session,exp:Infinity},{...session,sid:undefined},{...session,sid:'short'},{...session,sid:'x'.repeat(65)},{...session,sid:'bad sid with spaces!!'}])assert.equal(validSession(value,now),false);
});

test('media tokens require a valid URL value, future expiry and the exact player session binding',()=>{
  const media={url:'https://tv.lumanest.tv/segment.ts',bind:'session-a',exp:2000};
  assert.ok(validMedia(media,'session-a',1000));
  for(const value of [null,{}, {...media,url:''},{...media,exp:1000},{...media,exp:Infinity}])assert.equal(validMedia(value,'session-a',1000),false);
  assert.equal(validMedia(media,'session-b',1000),false);
});

test('legacy portal streams upgrade to HTTPS only for the exact configured secure portal',()=>{
  const portal='https://tv.lumanest.tv',allowed=['tv.lumanest.tv','*.turbobunny.net'];
  const source='http://tv.lumanest.tv:80/live/username/password/123.ts?token=signed';
  assert.equal(normalizeProviderURL(source,portal).href,'https://tv.lumanest.tv/live/username/password/123.ts?token=signed');
  assert.equal(trustedStreamURL(normalizeProviderURL(source,portal).href,allowed).protocol,'https:');
  for(const value of ['http://connect.turbobunny.net/live/1.ts','http://tv.lumanest.tv.evil.test/live/1.ts','http://127.0.0.1/live/1.ts','http://tv.lumanest.tv:8080/live/1.ts','http://username:password@tv.lumanest.tv/live/1.ts']){
    assert.equal(normalizeProviderURL(value,portal).protocol,'http:');assert.throws(()=>trustedStreamURL(normalizeProviderURL(value,portal).href,allowed));
  }
  assert.equal(normalizeProviderURL(source).protocol,'http:');
  assert.equal(normalizeProviderURL(source,'http://tv.lumanest.tv').protocol,'http:');
  assert.equal(normalizeProviderURL(source,'https://tv.lumanest.tv:8443').protocol,'http:');
});

test('portal playlist normalization deduplicates HTTP and HTTPS versions of a channel',()=>{
  const playlist='#EXTM3U\n#EXTINF:-1,First\nhttp://tv.lumanest.tv/live/u/p/1.ts\n#EXTINF:-1,Duplicate\nhttps://tv.lumanest.tv/live/u/p/1.ts';
  const channels=parseM3U(playlist,'https://tv.lumanest.tv');assert.equal(channels.length,1);assert.equal(channels[0].url,'https://tv.lumanest.tv/live/u/p/1.ts');
});

test('a real-sized provider lineup is not truncated at fifteen thousand channels',()=>{
  let text='#EXTM3U';
  for(let index=0;index<17035;index++)text+='\n#EXTINF:-1,Channel '+index+'\nhttp://tv.lumanest.tv/live/u/p/'+index+'.ts';
  const channels=parseM3U(text,'https://tv.lumanest.tv');assert.equal(channels.length,17035);assert.equal(channels[17034].name,'Channel 17034');
});

test('HTTP stream exceptions require an exact separately configured public provider host',()=>{
  const allowed=['tv.lumanest.tv','*.turbobunny.net'],httpHosts=['tv.lumanest.tv','turbobunny.net','38.190.178.54'];
  for(const host of httpHosts)assert.equal(trustedStreamURL('http://'+host+':80/live/u/p/1.ts',allowed,httpHosts).hostname,host);
  for(const url of ['http://38.190.178.55/live','http://connect.turbobunny.net/live','http://turbobunny.net.evil.test/live','http://38.190.178.54:8080/live','http://user:password@38.190.178.54/live'])assert.throws(()=>trustedStreamURL(url,allowed,httpHosts));
  assert.throws(()=>trustedStreamURL('http://connect.turbobunny.net/live',allowed,['*.turbobunny.net']));
  assert.throws(()=>trustedStreamURL('http://38.190.178.54/live',allowed));
});

test('private, local and reserved HTTP addresses remain blocked even when explicitly listed',()=>{
  const forbidden=['localhost','box.localhost','box.local','box.internal','box.lan','10.0.0.1','127.0.0.1','0.0.0.0','100.64.0.1','169.254.169.254','172.16.0.1','172.31.255.255','192.168.1.1','192.0.0.1','192.0.2.1','192.88.99.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','[::1]','[fe80::1]','[2001:4860:4860::8888]'];
  for(const host of forbidden)assert.throws(()=>trustedStreamURL('http://'+host+'/live',[],[host]),host);
  assert.throws(()=>trustedStreamURL('http://2130706433/live',[],['127.0.0.1']));
});

test('IP stream origin aliases preserve paths and query only for an explicit trusted hostname in the portal zone',()=>{
  const hosts=['tv.lumanest.tv'],httpHosts=['38.190.178.54','media.lumanest.tv'],source='http://38.190.178.54/live/private/user/1.ts?token=private';
  const map=JSON.stringify({'http://38.190.178.54':'http://media.lumanest.tv'});
  assert.equal(mapProviderOrigin(source,map,hosts,httpHosts,'lumanest.tv').href,'http://media.lumanest.tv/live/private/user/1.ts?token=private');
  assert.equal(mapProviderOrigin(source,undefined,hosts,httpHosts,'lumanest.tv').href,source);
  const unusual='http://38.190.178.54//external.test/private?token=private';
  assert.equal(mapProviderOrigin(unusual,map,hosts,httpHosts,'lumanest.tv').hostname,'media.lumanest.tv');
  for(const target of ['http://media.lumanest.tv:8080','http://media.lumanest.tv/custom','http://media.lumanest.tv?query=1','http://user:pass@media.lumanest.tv','http://127.0.0.1','http://38.190.178.54.nip.io']){
    assert.throws(()=>mapProviderOrigin(source,JSON.stringify({'http://38.190.178.54':target}),hosts,[...httpHosts,'127.0.0.1','38.190.178.54.nip.io'],'lumanest.tv'));
  }
  assert.throws(()=>mapProviderOrigin(source,map,hosts,['38.190.178.54'],'lumanest.tv'));
  assert.throws(()=>mapProviderOrigin('http://tv.lumanest.tv/live',JSON.stringify({'http://tv.lumanest.tv':'http://media.lumanest.tv'}),hosts,[...httpHosts,'tv.lumanest.tv'],'lumanest.tv'));
});

test('movie and series entries keep their tvg-logo poster address; other entries are unchanged',()=>{
  const channels=parseM3U('#EXTM3U\n#EXTINF:-1 tvg-logo="https://image.tmdb.org/t/p/w600/a.jpg" group-title="VOD",Heat (1995)\nhttps://tv.lumanest.tv/movie/u/p/7.mkv\n#EXTINF:-1 group-title="News",News\nhttps://tv.lumanest.tv/live/u/p/1.m3u8\n#EXTINF:-1 tvg-logo="'+'x'.repeat(1100)+'",Long\nhttps://tv.lumanest.tv/movie/u/p/8.mp4');
  assert.equal(channels[0].logo,'https://image.tmdb.org/t/p/w600/a.jpg');assert.equal(channels[0].format,'mpegts');
  assert.equal(channels[1].logo,undefined);assert.equal(channels[2].logo,undefined,'an overlong logo is dropped');
});
