import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const directory = path.dirname(fileURLToPath(import.meta.url));

export function load(file, { modules = {}, globals = {} } = {}) {
  const source = fs.readFileSync(path.join(directory, "../..", file), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const exports = {};
  vm.runInNewContext(compiled.outputText, {
    exports, URL, process, Date, AbortController, Uint8Array, Float32Array, DataView,
    setTimeout, Error, Blob, ...globals,
    require(name) {
      if (!(name in modules)) throw new Error(`Missing test dependency: ${name}`);
      return modules[name];
    },
  });
  return exports;
}

export function loadFunction(file, name, globals) {
  const source = fs.readFileSync(path.join(directory, "../..", file), "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!found) throw new Error(`Missing function: ${name}`);
  const compiled = ts.transpileModule(`${found.getText(tree)}\nexports.run = ${name}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(compiled.outputText, { exports, AbortController, Error, ...globals });
  return exports.run;
}
