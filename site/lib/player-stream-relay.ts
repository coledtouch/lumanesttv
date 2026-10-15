export function relayPlayerStream(body: ReadableStream<Uint8Array> | null, upstreamController: AbortController): ReadableStream<Uint8Array> | null {
  if (!body) return null;
  const reader = body.getReader();
  let closed = false;
  let cleanup: Promise<void> | undefined;

  function finish(cancelUpstream: boolean, reason?: unknown) {
    if (cleanup) return cleanup;
    closed = true;
    // Stop the network request before waiting for a potentially stalled body read.
    if (cancelUpstream) upstreamController.abort();
    cleanup = (async () => {
      try {if (cancelUpstream) await reader.cancel(reason);}
      catch { /* An aborted or already failed upstream body may reject cancellation. */ }
      finally {reader.releaseLock();}
    })();
    return cleanup;
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (closed) return;
      try {
        const {value, done} = await reader.read();
        if (closed) return;
        if (done) {await finish(false); controller.close();}
        else controller.enqueue(value);
      } catch {
        if (closed) return;
        await finish(true);
        controller.error(new Error('Stream connection interrupted.'));
      }
    },
    cancel(reason) {return finish(true, reason);},
  }, {highWaterMark: 0});
}
