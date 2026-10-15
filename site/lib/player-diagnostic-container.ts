type Container = 'mp4' | 'mpegts' | 'flv' | 'hls' | 'webm' | 'mpegps' | 'empty' | 'html' | 'json-like' | 'text-like' | 'unknown';

function classify(prefix: Uint8Array, finished = false): Container {
  if (!prefix.length) return finished ? 'empty' : 'unknown';
  if (!finished && prefix.length < 8) return 'unknown';
  if (prefix.length >= 8 && ['ftyp', 'styp', 'moov', 'moof', 'mdat', 'sidx'].includes(String.fromCharCode(...prefix.subarray(4, 8)))) return 'mp4';
  if (prefix.length >= 4 && prefix[0] === 0x46 && prefix[1] === 0x4c && prefix[2] === 0x56 && prefix[3] === 1) return 'flv';
  if (prefix.length >= 4 && prefix[0] === 0x1a && prefix[1] === 0x45 && prefix[2] === 0xdf && prefix[3] === 0xa3) return 'webm';
  if (prefix.length >= 4 && prefix[0] === 0 && prefix[1] === 0 && prefix[2] === 1 && prefix[3] === 0xba) return 'mpegps';
  const tsHeader = (offset: number) => prefix[offset] === 0x47 && (prefix[offset + 3] & 0x30) !== 0;
  for (const size of [188, 192, 204]) {
    const end = Math.min(188, prefix.length - 2 * size - 3);
    for (let offset = 0; offset < end; offset++) {
      if (tsHeader(offset) && tsHeader(offset + size) && tsHeader(offset + 2 * size)) return 'mpegts';
    }
  }
  // Retain the old short-response diagnostic heuristic only after EOF. Longer
  // streams need repeated sync packets so one coincidental 0x47 is insufficient.
  if (finished && prefix.length >= 4 && prefix.length < 188 && tsHeader(0)) return 'mpegts';
  let text: string;
  try {text = new TextDecoder('utf-8', {fatal: true}).decode(prefix).trimStart();}
  catch {return 'unknown';}
  if (text.startsWith('#EXTM3U') && (text.length === 7 || /^[\r\n]/.test(text.slice(7)))) return 'hls';
  if (/^(?:<!doctype\s+html(?:\s|>)|<(?:html|head|body)(?:\s|>))/i.test(text)) return 'html';
  if (finished && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text)) {
    if (/^[{[]/.test(text)) return 'json-like';
    if (text.trim().length) return 'text-like';
  }
  return 'unknown';
}

// Return only an enum from a bounded prefix; never return provider bytes or text.
export async function sampleDiagnosticContainer(body: ReadableStream<Uint8Array> | null, signal: AbortSignal): Promise<Container> {
  if (!body) return 'empty';
  const prefix = new Uint8Array(1024);
  let length = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | ReadableStreamBYOBReader;
  let read: () => Promise<ReadableStreamReadResult<Uint8Array>>;
  try {
    const bytes = body.getReader({mode: 'byob'});
    reader = bytes;
    read = () => bytes.read(new Uint8Array(prefix.length - length));
  } catch {
    const chunks = body.getReader();
    reader = chunks;
    read = () => chunks.read();
  }
  let canceling: Promise<void> | undefined;
  const cancel = () => canceling ||= reader.cancel().catch(() => {});
  const abort = () => {void cancel();};
  signal.addEventListener('abort', abort, {once: true});
  try {
    signal.throwIfAborted();
    while (length < prefix.length) {
      const {value, done} = await read();
      signal.throwIfAborted();
      if (done) break;
      const next = value.subarray(0, prefix.length - length);
      prefix.set(next, length);
      length += next.length;
      const container = classify(prefix.subarray(0, length));
      if (container !== 'unknown') return container;
    }
    return classify(prefix.subarray(0, length), true);
  } finally {
    signal.removeEventListener('abort', abort);
    await cancel();
    reader.releaseLock();
  }
}
