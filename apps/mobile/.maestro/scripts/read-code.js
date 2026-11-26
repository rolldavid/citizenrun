// The newest sign-in code sent to EMAIL, read from the local stack's dev mailbox. Maestro runs
// scripts on the host, so localhost reaches the stack from the emulator and the simulator runs.
// Maestro puts `http`, `json`, `output` and the `env` values on the global object. The address and
// the code are never printed.
const scope = globalThis;
const origin = scope.API_ORIGIN === undefined ? 'http://localhost:8080' : scope.API_ORIGIN;
const MAX_TRIES = 20;
const CODE = /^[0-9]{6}$/;
let code = null;
for (let attempt = 0; attempt < MAX_TRIES && code === null; attempt += 1) {
  const response = scope.http.post(origin + '/v1/dev/mailbox', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: scope.EMAIL }),
  });
  if (response.status === 200) {
    const answer = scope.json(response.body);
    if (answer && CODE.test(answer.code)) {
      code = answer.code;
    }
  }
}
if (code === null) {
  throw new Error('No sign-in code reached the dev mailbox');
}
scope.output.code = code;
