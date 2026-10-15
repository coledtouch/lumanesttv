import type mpegts from 'mpegts.js';
import {detectPlayerStreamFormat, PLAYER_STREAM_FORMAT_PREFIX_LIMIT, type PlayerStreamFormat} from './player-stream-format.ts';

const IDLE = 0, CONNECTING = 1, BUFFERING = 2, ERROR = 3, COMPLETE = 4;
type StreamError = 'Exception' | 'HttpStatusCodeInvalid' | 'EarlyEof';

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array> | null) {
  try {void reader?.cancel().catch(() => {});} catch {}
}
function cancelResponse(response: Response) {
  try {void response.body?.cancel().catch(() => {});} catch {}
}

// Own the network connection so changing channels closes even a stalled read.
// The library's default Chrome loader waits for another chunk before canceling.
export function createPlayerStreamLoader(origin: string, playbackSignal?: AbortSignal, fetchStream: typeof fetch = fetch, onFormat?: (format: PlayerStreamFormat) => void): mpegts.CustomLoaderConstructor {
  const base = new URL(origin);
  function streamURL(value: string) {
    const url = new URL(value, base.origin);
    if (base.protocol !== 'https:' || base.username || base.password || url.protocol !== 'https:' ||
      url.origin !== base.origin || url.username || url.password || url.pathname !== '/api/player/stream' ||
      url.hash || [...url.searchParams].length !== 1 || !url.searchParams.has('token') ||
      !url.searchParams.get('token') || url.searchParams.get('token')!.length > 8192) {
      throw new Error('Choose a supported player stream.');
    }
    return url;
  }

  return class PlayerStreamLoader implements mpegts.BaseLoader {
    _status = IDLE;
    _needStash = true;
    readonly type = 'lumanest-fetch-stream';
    get status() {return this._status;}
    get needStashBuffer() {return this._needStash;}
    onContentLengthKnown: mpegts.BaseLoader['onContentLengthKnown'] = () => {};
    onURLRedirect: mpegts.BaseLoader['onURLRedirect'] = () => {};
    onDataArrival: mpegts.BaseLoader['onDataArrival'] = () => {};
    onError: mpegts.BaseLoader['onError'] = () => {};
    onComplete: mpegts.BaseLoader['onComplete'] = () => {};
    private generation = 0;
    private destroyed = false;
    private controller: AbortController | null = null;
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private seekHandler: mpegts.SeekHandler;
    private playbackAbort = () => this.abort();

    constructor(seekHandler: mpegts.SeekHandler) {
      this.seekHandler = seekHandler;
      playbackSignal?.addEventListener('abort', this.playbackAbort, {once: true});
    }

    isWorking() {return this._status === CONNECTING || this._status === BUFFERING;}

    private stopNetwork() {
      this.controller?.abort();
      this.controller = null;
      cancelReader(this.reader);
      this.reader = null;
    }

    abort() {
      this.generation++;
      this.stopNetwork();
      this._status = IDLE;
    }

    destroy() {
      this.abort();
      this.destroyed = true;
      playbackSignal?.removeEventListener('abort', this.playbackAbort);
      this.onContentLengthKnown = () => {};
      this.onURLRedirect = () => {};
      this.onDataArrival = () => {};
      this.onError = () => {};
      this.onComplete = () => {};
    }

    open(dataSource: mpegts.MediaSegment, range: mpegts.Range) {
      if (this.destroyed || playbackSignal?.aborted) return;
      this.abort();
      const generation = this.generation;
      this._status = CONNECTING;
      const current = () => !this.destroyed && generation === this.generation;
      const fail = (kind: StreamError, code: number, message: string) => {
        if (!current() || this._status === ERROR) return;
        this._status = ERROR;
        this.stopNetwork();
        // Upstream's declaration types the error string as its enum object.
        this.onError(kind as unknown as mpegts.LoaderErrors, {code, msg: message});
      };
      void (async () => {
        let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
        try {
          if (!Number.isSafeInteger(range.from) || range.from < 0 || !Number.isSafeInteger(range.to) ||
            (range.to !== -1 && range.to < range.from)) throw new Error('Invalid byte range.');
          const seek = this.seekHandler.getConfig(streamURL(dataSource.url).href, range);
          const source = streamURL(seek.url);
          const headers = new Headers({Accept: '*/*'});
          const requestedRange = new Headers(seek.headers as HeadersInit).get('Range');
          if (requestedRange) {
            if (!/^bytes=\d+-\d*$/.test(requestedRange)) throw new Error('Invalid byte range.');
            headers.set('Range', requestedRange);
          }
          const controller = new AbortController();
          this.controller = controller;
          const response = await fetchStream(source.href, {
            method: 'GET', headers, signal: controller.signal, credentials: 'same-origin',
            mode: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error'
          });
          if (!current()) {cancelResponse(response); return;}
          let redirected = response.redirected;
          try {if (response.url && streamURL(response.url).href !== source.href) redirected = true;}
          catch {redirected = true;}
          if (redirected) {
            cancelResponse(response);
            fail('Exception', -1, 'The player stream returned an unexpected redirect.');
            return;
          }
          if (!response.ok) {
            cancelResponse(response);
            fail('HttpStatusCodeInvalid', response.status, 'The stream returned HTTP ' + response.status + '.');
            return;
          }
          if (!response.body) {fail('Exception', -1, 'The stream response was empty.'); return;}
          reader = response.body.getReader();
          this.reader = reader;
          const lengthHeader = response.headers.get('Content-Length');
          const contentLength = lengthHeader !== null && /^\d+$/.test(lengthHeader) && Number.isSafeInteger(Number(lengthHeader)) ? Number(lengthHeader) : null;
          if (contentLength !== null && contentLength > 0) this.onContentLengthKnown(contentLength);
          let received = 0;
          let sniffing = Boolean(onFormat);
          const prefix = new Uint8Array(PLAYER_STREAM_FORMAT_PREFIX_LIMIT);
          let prefixLength = 0;
          let pending: Uint8Array[] = [];
          const deliver = (value: Uint8Array) => {
            if (!current()) return;
            this._status = BUFFERING;
            const byteStart = range.from + received;
            received += value.byteLength;
            const chunk = new ArrayBuffer(value.byteLength);
            new Uint8Array(chunk).set(value);
            this.onDataArrival(chunk, byteStart, received);
          };
          while (current()) {
            const {value, done} = await reader.read();
            if (!current()) return;
            if (done) {
              for (const value of pending) deliver(value);
              if (!current()) return;
              if (contentLength !== null && received < contentLength) fail('EarlyEof', -1, 'The stream ended before its response was complete.');
              else {this._status = COMPLETE; this.onComplete(range.from, range.from + received - 1);}
              return;
            }
            if (!value.byteLength) continue;
            if (sniffing) {
              const part = value.subarray(0, prefix.length - prefixLength);
              prefix.set(part, prefixLength); prefixLength += part.length;
              const format = detectPlayerStreamFormat(prefix.subarray(0, prefixLength));
              if (format) {
                this.abort();
                onFormat!(format);
                return;
              }
              if (prefixLength < prefix.length) {pending.push(value.slice()); continue;}
              sniffing = false;
              for (const buffered of pending) deliver(buffered);
              pending = [];
              deliver(value);
            } else deliver(value);
          }
        } catch {
          fail('Exception', -1, 'The stream connection was interrupted. Try this channel again.');
        } finally {
          try {reader?.releaseLock();} catch {}
          if (current()) {this.reader = null; this.controller = null;}
        }
      })();
    }
  };
}
