// kuromoji の辞書をブラウザから読めるよう public/kuromoji-dict/ にコピーする（ビルド前・dev 前に実行）
import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const src = path.join(path.dirname(require.resolve("kuromoji/package.json")), "dict");
const dest = path.join(process.cwd(), "public", "kuromoji-dict");
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`kuromoji dict copied to ${path.relative(process.cwd(), dest)}`);
