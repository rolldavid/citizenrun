// A new person for one run: an address on the reserved test domain and a handle nobody holds.
// Maestro puts `output` on the global object.
const runId = Date.now().toString(36);
globalThis.output.email = 'maestro_' + runId + '@example.test';
globalThis.output.handle = 'm' + runId;
