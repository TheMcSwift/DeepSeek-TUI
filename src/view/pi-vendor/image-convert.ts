/**
 * Stub for pi's wasm-backed image conversion: the DSH surface starts with
 * text-only rendering, so conversion never produces output. Kept as a module
 * so the vendored tool-execution component imports unchanged.
 */
export async function convertToPng(_data: string, _mimeType: string): Promise<{ data: string; mimeType: string } | undefined> {
  return undefined
}
