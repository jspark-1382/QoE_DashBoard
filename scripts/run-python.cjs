/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
const candidates =
  process.platform === 'win32'
    ? [['py', '-3'], ['python'], ['python3']]
    : [['python3'], ['python']];
function run(index) {
  if (index >= candidates.length) {
    console.error('Python 3 실행 파일을 찾지 못했습니다.');
    process.exitCode = 1;
    return;
  }
  const [command, ...prefix] = candidates[index];
  const child = spawn(command, [...prefix, ...args], {
    stdio: 'inherit',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  child.on('error', (error) => {
    if (error.code === 'ENOENT') run(index + 1);
    else {
      console.error(error.message);
      process.exitCode = 1;
    }
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else if (code != null) process.exitCode = code;
  });
}
run(0);
