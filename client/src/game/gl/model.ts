/** Losslessly packed copies of the authored GLBs. Native decompression avoids
 * a JS codec or geometry quantization; older browsers use the original files. */
export async function modelBytes(name: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const path = `/models/${name}.glb`;
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const response = await fetch(`${path}.gz`, { signal });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      return await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    } catch (error) {
      if (signal.aborted) throw error;
      // Also tolerate older deployments that only have the original assets.
    }
  }
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error(`${name}.glb: HTTP ${response.status}`);
  return response.arrayBuffer();
}
