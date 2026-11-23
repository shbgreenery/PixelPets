import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// core 测试是断言脚本，加载即执行；任一文件抛错则以非零码退出。
const require = createRequire(import.meta.url);
const testsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'core', 'tests');
const testFiles = readdirSync(testsDir)
  .filter((name) => name.endsWith('.test.js'))
  .sort();

for (const name of testFiles) {
  require(join(testsDir, name));
}
