import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {fileURLToPath} from 'node:url';

// The relay Worker in workerd, where its EOF-delimited live TV path pumps a real TCP socket through a native
// IdentityTransformStream. The provider is a local server; connect() ignores the approved address and dials it.
let runtime, provider;
const key = 'c'.repeat(64);
const live = {sent: 0, open: 0};

test.before(async () => {
  provider = net.createServer(socket => {
    let timer;
    live.open++;
    socket.once('data', () => {
      // The header and the first bytes in one packet, then a chunk every 50 ms until the relay hangs up.
      socket.write('HTTP/1.0 200 OK\r\nContent-Type: video/mp2t\r\n\r\nfirst-bytes;');
      timer = setInterval(() => {socket.write('live-chunk;'); live.sent++;}, 50);
    });
    socket.on('error', () => {});
    socket.on('close', () => {live.open--; clearInterval(timer);});
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const bundle = await build({
    stdin: {
      contents: `
        import {connect as connectSocket} from 'cloudflare:sockets';
        import {createStreamRelay} from './cloudflare/lumanest-stream-relay.mjs';
        const Native = globalThis.IdentityTransformStream;
        const state = {identities: 0, closes: 0};
        globalThis.IdentityTransformStream = function (...args) {state.identities++; return new Native(...args);};
        let port;
        const relay = createStreamRelay((address, options) => {
          const socket = connectSocket({hostname: '127.0.0.1', port}, options);
          return {readable: socket.readable, writable: socket.writable, opened: socket.opened, closed: socket.closed, close() {state.closes++; return socket.close();}};
        });
        export default {fetch(request, env) {
          port = Number(env.PROVIDER_PORT);
          if (new URL(request.url).pathname === '/state') return Response.json(state);
          return relay.fetch(request, env);
        }};
      `,
      resolveDir: fileURLToPath(new URL('../', import.meta.url)), sourcefile: 'stream-relay-runtime-worker.mjs', loader: 'js',
    },
    write: false, bundle: true, format: 'esm', platform: 'browser', external: ['cloudflare:sockets'],
  });
  runtime = new Miniflare({
    // As deployed (cloudflare/stream-relay.wrangler.jsonc), on the newest date this workerd supports.
    name: 'stream-relay', modules: true, compatibilityDate: '2026-05-15', compatibilityFlags: ['enable_request_signal'],
    script: bundle.outputFiles[0].text, bindings: {STREAM_RELAY_KEY: key, PROVIDER_PORT: String(provider.address().port)},
  });
});
test.after(async () => {await runtime?.dispose(); provider?.close();});

test('EOF-delimited live TV streams through a native IdentityTransformStream, and a hang-up closes the provider socket', {timeout: 10000}, async () => {
  const state = async () => (await runtime.dispatchFetch('https://streams.lumanest.tv/state')).json();
  const response = await runtime.dispatchFetch('https://streams.lumanest.tv/relay', {
    method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key},
    body: JSON.stringify({url: 'http://136.148.65.126/live/user/password/1.ts?token=private'}),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'video/mp2t');
  const reader = response.body.getReader();
  let text = '';
  while (text.split('live-chunk;').length < 4) {
    const {value, done} = await reader.read();
    assert.equal(done, false, text);
    text += new TextDecoder().decode(value);
  }
  // The bytes that arrived with the header come first, then the socket's own stream.
  assert.match(text, /^first-bytes;(live-chunk;)+$/);
  assert.deepEqual(await state(), {identities: 1, closes: 0});
  assert.equal(live.open, 1);

  await reader.cancel();
  // Give the hang-up a moment to travel from this client through Miniflare to the worker.
  await new Promise(resolve => setTimeout(resolve, 300));
  const sent = live.sent;
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(live.sent, sent);
  assert.equal(live.open, 0);
  assert.equal((await state()).closes, 1);
});
