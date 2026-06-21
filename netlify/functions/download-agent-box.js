/* download-agent-box — serve the delivery ZIP.
   GET ?ref=<agent_packages blob key>  (the box_ref returned by check-agent-box)
*/

const { getStore } = require('@netlify/blobs');

exports.handler = async function(event) {
  const boxRef = ((event.queryStringParameters || {}).ref || '').trim();
  if (!boxRef) {
    return { statusCode: 400, body: 'ref required' };
  }

  let zipData;
  try {
    const pkgStore = getStore('agent_packages');
    zipData = await pkgStore.get(boxRef, { type: 'arrayBuffer' });
  } catch (_) {
    zipData = null;
  }

  if (!zipData) {
    return { statusCode: 404, body: 'Package not found.' };
  }

  // Derive agent name for filename from the spec blob (boxRef = ref + '--box')
  let agentSlug = 'agent';
  try {
    const specRef = boxRef.replace(/--box$/, '');
    const blobStore = getStore('build_requests');
    const record = await blobStore.get(specRef, { type: 'json' });
    if (record) {
      const spec = record.spec || record;
      if (spec.name) {
        agentSlug = spec.name
          .toLowerCase()
          .replace(/["''.]/g, '')
          .replace(/\([^)]*\)/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'agent';
      }
    }
  } catch (_) {}

  return {
    statusCode: 200,
    headers: {
      'Content-Type':        'application/zip',
      'Content-Disposition': `attachment; filename="${agentSlug}-agent-box.zip"`,
    },
    body:            Buffer.from(zipData).toString('base64'),
    isBase64Encoded: true,
  };
};
