export function playerStreamError(detail: unknown, httpCode?: number) {
  if (httpCode && [403, 502, 504].includes(httpCode)) return 'This stream could not be played (HTTP ' + httpCode + '). Choose another channel or try again.';
  if (detail === 'CodecUnsupported') return 'This channel uses a video or audio codec your browser cannot play. Try another channel or open it in the Tuner app.';
  if (detail === 'MediaMSEError') return 'Your browser could not decode this channel. Try another channel or open it in the Tuner app.';
  if (detail === 'FormatUnsupported') return 'This channel is not arriving in a supported video format. Choose another channel or try the Tuner app.';
  if (detail === 'FormatError') return 'This channel’s feed contains invalid video data. Choose another channel or try again later.';
  return 'This stream could not be played. Choose another channel or try again.';
}
