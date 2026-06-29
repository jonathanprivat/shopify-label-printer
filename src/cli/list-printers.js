// Lists CUPS queues so you can set PRINTER_QUEUE correctly.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const pexec = promisify(execFile);

const run = async (cmd, args) => {
  try {
    const { stdout } = await pexec(cmd, args);
    return stdout.trim();
  } catch (e) {
    return `(error running ${cmd}: ${e.message})`;
  }
};

console.log('Queues (lpstat -e):\n' + (await run('lpstat', ['-e'])) + '\n');
console.log('Devices (lpstat -v):\n' + (await run('lpstat', ['-v'])) + '\n');
console.log(
  'Tip: see supported media for a queue with:\n' +
    '  lpoptions -p <QUEUE_NAME> -l'
);
