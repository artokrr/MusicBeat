/** Asynchronous GPU timer. Never gl.finish/readPixels in the production path. */
export class GPUTimer {
  private readonly ext: {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;
  private readonly queries: WebGLQuery[] = [];
  private readonly pending = new Uint8Array(8);
  private readonly values = new Float64Array(600);
  private count = 0;
  private active = -1;
  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (this.ext)
      for (let i = 0; i < 8; i++)
        this.queries.push(gl.createQuery()!);
  }
  begin() {
    if (!this.ext || this.gl.isContextLost())
      return;
    const disjoint = this.gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    for (let i = 0; i < this.queries.length; i++) {
      const q = this.queries[i];
      if (this.pending[i] && this.gl.getQueryParameter(q, this.gl.QUERY_RESULT_AVAILABLE)) {
        if (!disjoint)
          this.values[this.count++ % this.values.length] = this.gl.getQueryParameter(q, this.gl.QUERY_RESULT) / 1e6;
        this.pending[i] = 0;
      }
    }
    this.active = this.pending.indexOf(0);
    if (this.active >= 0)
      this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.queries[this.active]);
  }
  end() {
    if (this.ext && this.active >= 0) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.pending[this.active] = 1;
      this.active = -1;
    }
  }
  stats() {
    const sorted = Array.from(this.values.subarray(0, Math.min(this.count, this.values.length))).sort((a, b) => a - b);
    return { supported: !!this.ext, samples: sorted.length, medianMs: sorted[Math.floor(sorted.length * .5)] ?? null, p95Ms: sorted[Math.floor(sorted.length * .95)] ?? null };
  }
  dispose() { for (const query of this.queries)
    this.gl.deleteQuery(query); }
}
