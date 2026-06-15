// ساخت امضای نسخه در زمان build.
// هر build یک مقدار یکتا در public/version.json می‌نویسد. کلاینت موقع باز شدن اپ
// این فایل را (بدون کش) می‌خواند و اگر با نسخه‌ای که الان لود شده فرق داشت،
// یعنی نسخهٔ جدید deploy شده → اپ خودش رفرش می‌شود.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const version = Date.now().toString();

mkdirSync(publicDir, { recursive: true });
writeFileSync(join(publicDir, 'version.json'), JSON.stringify({ v: version }) + '\n');

console.log(`[gen-version] version.json => ${version}`);
