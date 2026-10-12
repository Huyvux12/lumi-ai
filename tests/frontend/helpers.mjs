import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const directory = path.dirname(fileURLToPath(import.meta.url));

export function load(file) {
  const source = fs.readFileSync(path.join(directory, "../..", file), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const exports = {};
  vm.runInNewContext(compiled.outputText, { exports, URL, process, Date });
  return exports;
}
