// mapshaper 0.7 is a CommonJS module; its programmatic entry is applyCommands. Input files are
// keyed by name and given as text, bytes or (for GeoJSON) an object; the promise resolves with
// the output files keyed by name.
declare module 'mapshaper' {
  type MapshaperInput = Readonly<Record<string, string | Uint8Array | object>>;
  type Mapshaper = {
    applyCommands(
      commands: string,
      input?: MapshaperInput,
    ): Promise<Record<string, Uint8Array | string>>;
  };
  const mapshaper: Mapshaper;
  export = mapshaper;
}
