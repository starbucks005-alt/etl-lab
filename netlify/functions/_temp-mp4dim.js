// Reads the real delivered mp4 and extracts width/height from its tkhd
// box, to confirm the crop fix actually produced a 16:9 video, not just
// that the pipeline completed without error. One-off, secret-gated,
// deleted after use.
const { getStore, connectLambda } = require('@netlify/blobs');
const SECRET = 'mp4dim-t7Wq3Kp';

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.key !== SECRET) return { statusCode: 403, body: 'no' };
  try { connectLambda(event); } catch (_) {}

  const store = getStore('gc_scene_jobs');
  const jobId = q.job_id;
  if (!jobId) return { statusCode: 400, body: 'job_id required' };

  const got = await store.get(jobId + '.mp4', { type: 'arrayBuffer' });
  if (!got) return { statusCode: 200, body: 'NO_MP4_STORED' };
  const buf = Buffer.from(got);

  // Find every 'tkhd' box (video track's is usually the one with non-zero
  // width/height; an audio track's tkhd has 0x0).
  const marker = Buffer.from('tkhd');
  const found = [];
  let idx = 0;
  while ((idx = buf.indexOf(marker, idx)) !== -1) {
    // tkhd full-box header starts right after the 4-byte type: version(1)+flags(3)
    const version = buf[idx + 4];
    const base = version === 1 ? idx + 4 + 4 + 8 + 8 + 4 + 4 : idx + 4 + 4 + 4 + 4 + 4 + 4;
    // base is now at reserved(8)+layer(2)+alt_group(2)+volume(2)+reserved(2)+matrix(36) = 52 bytes before width
    const widthOffset = base + 8 + 2 + 2 + 2 + 2 + 36;
    if (widthOffset + 8 <= buf.length) {
      const width = buf.readUInt32BE(widthOffset) / 65536;
      const height = buf.readUInt32BE(widthOffset + 4) / 65536;
      found.push({ width, height });
    }
    idx += 4;
  }

  return {
    statusCode: 200, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: jobId, bytes: buf.length, tracks: found }, null, 2),
  };
};
