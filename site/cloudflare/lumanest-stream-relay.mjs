const MAX_JSON = 12 * 1024;
const MAX_HEADERS = 32 * 1024;
const MAX_CHUNK_LINE = 1024;
const FAILURE = 'The stream connection is unavailable.';

function reply(status, error) {
  return Response.json({error}, {status, headers: {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'}});
}

async function authenticated(request, key) {
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) return false;
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ') || authorization.length > 263) return false;
  const encoder = new TextEncoder();
  const [expected, actual] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(key)),
    crypto.subtle.digest('SHA-256', encoder.encode(authorization.slice(7))),
  ]);
  const first = new Uint8Array(expected), second = new Uint8Array(actual);
  let difference = 0;
  for (let index = 0; index < first.length; index++) difference |= first[index] ^ second[index];
  return difference === 0;
}

async function boundedJSON(request) {
  if (!/^application\/json(?:\s*;[^\r\n]*)?$/i.test(request.headers.get('Content-Type') || '')) throw new Error(FAILURE);
  const declared = request.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_JSON)) throw new Error(FAILURE);
  const reader = request.body?.getReader();
  if (!reader) throw new Error(FAILURE);
  const bytes = new Uint8Array(MAX_JSON);
  let length = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      if (length + value.byteLength > MAX_JSON) throw new Error(FAILURE);
      bytes.set(value, length); length += value.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, length)));
  } finally {
    try {await reader.cancel();} catch {}
    reader.releaseLock();
  }
}

function destination(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['url', 'range'].includes(key)) ||
    typeof input.url !== 'string' || input.url.length > 8192 || /[\x00-\x20\x7f]/.test(input.url)) throw new Error(FAILURE);
  const url = new URL(input.url);
  const authority = /^http:\/\/([0-9.]+)(?::80)?\//.exec(input.url);
  const octets = url.hostname.split('.').map(Number);
  const providerIP = /^136\.148\.65\.[1-9]\d{0,2}$/.test(url.hostname) && octets[3] < 255;
  if (!authority || authority[1] !== url.hostname || (!providerIP && url.hostname !== '38.190.178.54') ||
    url.protocol !== 'http:' || url.port || url.username || url.password || url.hash || url.pathname.length < 2) throw new Error(FAILURE);
  if ('range' in input) {
    if (typeof input.range !== 'string') throw new Error(FAILURE);
    const suffix = /^bytes=-([1-9]\d{0,15})$/.exec(input.range);
    const match = /^bytes=(0|[1-9]\d{0,15})-(0|[1-9]\d{0,15})?$/.exec(input.range);
    if (suffix ? !Number.isSafeInteger(Number(suffix[1])) : !match || !Number.isSafeInteger(Number(match[1])) || (match[2] !== undefined && (!Number.isSafeInteger(Number(match[2])) || Number(match[2]) < Number(match[1])))) throw new Error(FAILURE);
  }
  return {url, range: input.range};
}

function parseHeaders(bytes) {
  const raw = new TextDecoder('latin1').decode(bytes);
  const lines = raw.slice(0, -4).split('\r\n');
  const status = /^HTTP\/1\.[01] (\d{3})(?: [\x20-\x7e]*)?$/.exec(lines.shift() || '');
  if (!status || !['200', '206'].includes(status[1])) throw new Error(FAILURE);
  const fields = new Map();
  for (const line of lines) {
    const match = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+):[ \t]*([\x20-\x7e\t]*)$/.exec(line);
    if (!match) throw new Error(FAILURE);
    const name = match[1].toLowerCase(), value = match[2].trim();
    if (fields.has(name) && ['content-length', 'transfer-encoding', 'content-type', 'content-range', 'content-encoding'].includes(name)) throw new Error(FAILURE);
    fields.set(name, value);
  }
  const type = fields.get('content-type') || '';
  const mediaType = type.split(';')[0].trim().toLowerCase();
  if (type.length > 256 || !(/^(?:video|audio)\/[a-z0-9.+-]+$/.test(mediaType) || ['application/octet-stream', 'application/vnd.apple.mpegurl', 'application/x-mpegurl'].includes(mediaType))) throw new Error(FAILURE);
  if (fields.has('content-encoding') && fields.get('content-encoding').toLowerCase() !== 'identity') throw new Error(FAILURE);
  const transfer = fields.get('transfer-encoding')?.toLowerCase();
  const length = fields.get('content-length');
  if ((transfer && transfer !== 'chunked') || (transfer && length !== undefined) ||
    (length !== undefined && (!/^\d{1,16}$/.test(length) || !Number.isSafeInteger(Number(length))))) throw new Error(FAILURE);
  const headers = new Headers({'Content-Type': type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'});
  const ranges = fields.get('accept-ranges');
  if (ranges && ['bytes', 'none'].includes(ranges.toLowerCase())) headers.set('Accept-Ranges', ranges);
  const contentRange = fields.get('content-range');
  if (contentRange) {
    const match = /^bytes (\d{1,16})-(\d{1,16})\/(\d{1,16}|\*)$/.exec(contentRange);
    if (!match || !Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) < Number(match[1]) ||
      (match[3] !== '*' && (!Number.isSafeInteger(Number(match[3])) || Number(match[3]) <= Number(match[2])))) throw new Error(FAILURE);
    headers.set('Content-Range', contentRange);
  }
  return {status: Number(status[1]), headers, mode: transfer ? 'chunked' : length !== undefined ? 'length' : 'eof', length: length === undefined ? 0 : Number(length)};
}

export function createStreamRelay(connect) {
  return {
    async fetch(request, env) {
      const endpoint = new URL(request.url);
      if (endpoint.pathname !== '/relay' || endpoint.search) return reply(404, 'not_found');
      if (request.method !== 'POST') return reply(405, 'method_not_allowed');
      if (!await authenticated(request, env?.STREAM_RELAY_KEY)) return reply(401, 'relay_unauthorized');
      let target;
      try {target = destination(await boundedJSON(request));}
      catch {return reply(400, 'invalid_relay_request');}
      if (request.signal.aborted) return reply(502, 'stream_unavailable');

      let socket, reader, timer, closing;
      let ended = false;
      let rejectAbort;
      const interrupted = new Promise((_, reject) => {rejectAbort = reject;});
      void interrupted.catch(() => {});
      const race = promise => Promise.race([promise, interrupted]);
      function close() {
        if (closing) return closing;
        ended = true;
        clearTimeout(timer);
        request.signal.removeEventListener('abort', interrupt);
        try {void Promise.resolve(socket?.close()).catch(() => {});} catch {}
        closing = (async () => {
          try {await reader?.cancel();} catch {}
          try {reader?.releaseLock();} catch {}
        })();
        return closing;
      }
      function interrupt() {rejectAbort(new Error(FAILURE)); void close();}
      request.signal.addEventListener('abort', interrupt, {once: true});
      timer = setTimeout(interrupt, 20000);
      let streaming = false;
      try {
        request.signal.throwIfAborted();
        socket = connect({hostname: target.url.hostname, port: 80}, {secureTransport: 'off'});
        void socket.closed.catch(() => {});
        await race(socket.opened);
        const writer = socket.writable.getWriter();
        try {
          const output = 'GET ' + target.url.pathname + target.url.search + ' HTTP/1.0\r\nHost: ' + target.url.hostname + '\r\nAccept: */*\r\nAccept-Encoding: identity\r\nConnection: close\r\n' + (target.range ? 'Range: ' + target.range + '\r\n' : '') + '\r\n';
          await race(writer.write(new TextEncoder().encode(output)));
        } finally {writer.releaseLock();}
        reader = socket.readable.getReader();
        let pending = new Uint8Array(0), offset = 0;
        async function available() {
          while (offset >= pending.byteLength) {
            const {value, done} = await race(reader.read());
            if (done) return null;
            if (!(value instanceof Uint8Array)) throw new Error(FAILURE);
            pending = value; offset = 0;
          }
          return pending.subarray(offset);
        }
        async function byte() {
          if (!await available()) throw new Error(FAILURE);
          return pending[offset++];
        }
        const header = new Uint8Array(MAX_HEADERS);
        let size = 0;
        let headerComplete = false;
        while (!headerComplete) {
          if (!await available()) throw new Error(FAILURE);
          while (offset < pending.byteLength) {
            if (size >= MAX_HEADERS) throw new Error(FAILURE);
            header[size++] = pending[offset++];
            if (size >= 4 && header[size - 4] === 13 && header[size - 3] === 10 && header[size - 2] === 13 && header[size - 1] === 10) {headerComplete = true; break;}
          }
        }
        const response = parseHeaders(header.subarray(0, size));
        clearTimeout(timer);
        if (response.mode === 'eof' || (response.mode === 'length' && typeof globalThis.FixedLengthStream === 'function')) {
          const output = response.mode === 'length' ? new globalThis.FixedLengthStream(response.length) : new TransformStream();
          const prefix = pending.subarray(offset, response.mode === 'length' ? offset + response.length : undefined);
          reader.releaseLock(); reader = null;
          // Native stream pumping avoids executing JavaScript for every live-TV packet.
          void (async () => {
            if (prefix.byteLength) {
              const writer = output.writable.getWriter();
              try {await race(writer.write(prefix));} finally {writer.releaseLock();}
            }
            if (response.mode === 'length' && prefix.byteLength >= response.length) await output.writable.close();
            else await socket.readable.pipeTo(output.writable, {signal: request.signal});
          })().catch(async () => {
            try {await output.writable.abort(new Error(FAILURE));} catch {}
          }).finally(close);
          streaming = true;
          return new Response(output.readable, {status: response.status, headers: response.headers});
        }
        let remaining = response.length, chunkRemaining = 0, chunkCRLF = false, complete = false;
        async function line(max) {
          const result = [];
          while (result.length <= max) {
            const next = await byte();
            if (next === 13) {
              if (await byte() !== 10) throw new Error(FAILURE);
              return String.fromCharCode(...result);
            }
            if (next < 32 || next > 126) throw new Error(FAILURE);
            result.push(next);
          }
          throw new Error(FAILURE);
        }
        async function next() {
          if (complete) return null;
          if (response.mode === 'length' && remaining === 0) {complete = true; return null;}
          if (response.mode === 'chunked') {
            if (chunkCRLF) {
              if (await byte() !== 13 || await byte() !== 10) throw new Error(FAILURE);
              chunkCRLF = false;
            }
            if (chunkRemaining === 0) {
              const value = await line(MAX_CHUNK_LINE);
              const match = /^([0-9a-fA-F]{1,16})(?:;[\x20-\x7e]*)?$/.exec(value);
              if (!match || !Number.isSafeInteger(Number.parseInt(match[1], 16))) throw new Error(FAILURE);
              chunkRemaining = Number.parseInt(match[1], 16);
              if (chunkRemaining === 0) {
                let total = 0;
                while (true) {
                  const trailer = await line(MAX_HEADERS - total);
                  total += trailer.length + 2;
                  if (total > MAX_HEADERS) throw new Error(FAILURE);
                  if (!trailer) break;
                  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+:[\x20-\x7e]*$/.test(trailer)) throw new Error(FAILURE);
                }
                complete = true; return null;
              }
            }
          }
          const bytes = await available();
          if (!bytes) {
            if (response.mode !== 'eof') throw new Error(FAILURE);
            complete = true; return null;
          }
          const count = response.mode === 'length' ? Math.min(bytes.byteLength, remaining) : response.mode === 'chunked' ? Math.min(bytes.byteLength, chunkRemaining) : bytes.byteLength;
          const output = bytes.subarray(0, count);
          offset += count;
          if (response.mode === 'length') {remaining -= count; if (remaining === 0) complete = true;}
          if (response.mode === 'chunked') {chunkRemaining -= count; if (chunkRemaining === 0) chunkCRLF = true;}
          return output;
        }
        const body = new ReadableStream({
          async pull(controller) {
            if (ended) {controller.error(new Error(FAILURE)); return;}
            try {
              const value = await next();
              if (value) controller.enqueue(value);
              if (complete || !value) {await close(); controller.close();}
            } catch {
              await close();
              try {controller.error(new Error(FAILURE));} catch {}
            }
          },
          cancel() {interrupt(); return close();},
        }, {highWaterMark: 0});
        streaming = true;
        return new Response(body, {status: response.status, headers: response.headers});
      } catch {return reply(502, 'stream_unavailable');}
      finally {if (!streaming) await close();}
    },
  };
}
