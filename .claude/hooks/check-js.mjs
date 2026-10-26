// PostToolUse hook: after Claude edits a .js/.mjs file, syntax-check it with
// `node --check`. On a syntax error, exit 2 so the error is fed back to Claude.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const { tool_input = {}, tool_response = {} } = JSON.parse(input || '{}');
  const file = tool_response.filePath ?? tool_input.file_path;
  if (!file || !/\.(m?js)$/.test(file) || !existsSync(file)) return;
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(`Syntax error in ${file}:\n${result.stderr}`);
    process.exit(2);
  }
});
