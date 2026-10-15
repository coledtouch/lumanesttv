export type PlayerStreamFormat = 'file' | 'hls';
export const PLAYER_STREAM_FORMAT_PREFIX_LIMIT = 512;

// Inspect only a short prefix. Provider MIME types and .ts extensions can disagree
// with the actual response; recognizing box/tag bytes keeps that mismatch bounded.
export function detectPlayerStreamFormat(input: Uint8Array): PlayerStreamFormat | null {
  const bytes = input.subarray(0, PLAYER_STREAM_FORMAT_PREFIX_LIMIT);
  let textStart = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while ([9, 10, 13, 32].includes(bytes[textStart])) textStart++;
  const hls = [35, 69, 88, 84, 77, 51, 85]; // #EXTM3U
  if (textStart + 8 <= bytes.length && hls.every((byte, index) => bytes[textStart + index] === byte) &&
    [10, 13].includes(bytes[textStart + hls.length])) return 'hls';

  const numberAt = (offset: number) => bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3];
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    let size = numberAt(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let header = 8;
    if (size === 1) {
      if (offset + 16 > bytes.length) return null;
      size = numberAt(offset + 8) * 0x100000000 + numberAt(offset + 12);
      header = 16;
    }
    if (!Number.isSafeInteger(size) || (size !== 0 && size < header)) return null;
    if (['ftyp', 'styp'].includes(type)) return size === 0 || size >= header + 8 ? 'file' : null;
    if (type === 'moov' || type === 'moof') return 'file';
    if (!['free', 'skip', 'wide'].includes(type) || size === 0 || offset + size > bytes.length) return null;
    offset += size;
  }
  return null;
}
