import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "excludes shadowed require calls from application imports through %s",
  { timeout: 60_000 },
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-static-require-scope-");
    const files: Readonly<Record<string, string>> = {
      "parameter.cjs":
        'function run(require) { return require("./ghost.cjs"); } console.log(run(() => "local"));',
      "optional.cjs":
        'function run(require) { return require?.("./ghost.cjs"); } console.log(run(() => "local"));',
      "hoisted.cjs":
        'function run() { return require("./ghost.cjs"); function require() { return "local"; } } console.log(run());',
      "catch.cjs":
        'try { throw () => "local"; } catch (require) { console.log(require("./ghost.cjs")); }',
      "block.cjs":
        '{ const require = () => "local"; console.log(require("./ghost.cjs")); }',
      "real.cjs": 'console.log(require("./real-dependency.cjs"));',
      "real-optional.cjs": 'console.log(require?.("./real-dependency.cjs"));',
      "var.cjs": 'var require; console.log(require("./real-dependency.cjs"));',
      "create-require.mjs":
        'import {createRequire} from "node:module"; const require = createRequire(import.meta.url); console.log(require("./real-dependency.cjs"));',
      "real-dependency.cjs": 'module.exports = "real";',
      "ghost.cjs":
        'throw new Error("A local function must not load this module");',
    };
    await Promise.all(
      Object.entries(files).map(([path, source]) =>
        writeFile(join(root, path), source),
      ),
    );
    for (const [path, value] of [
      ["parameter.cjs", "local"],
      ["optional.cjs", "local"],
      ["hoisted.cjs", "local"],
      ["catch.cjs", "local"],
      ["block.cjs", "local"],
      ["real.cjs", "real"],
      ["real-optional.cjs", "real"],
      ["var.cjs", "real"],
      ["create-require.mjs", "real"],
    ] as const)
      expect(
        (
          await promisify(execFile)(process.execPath, [join(root, path)], {
            timeout: 5000,
          })
        ).stdout,
      ).toBe(`${value}\n`);
    const result = await analyzeJavaScriptDirectory(surface, cli, root);
    const requires = result.graph.edges.filter(
      ({ relation, properties }) =>
        relation === "imports" && properties.kind === "require",
    );
    expect(
      requires.filter(
        ({ properties }) => properties.specifier === "./ghost.cjs",
      ),
    ).toEqual([]);
    const realSources = requires
      .filter(
        ({ properties }) => properties.specifier === "./real-dependency.cjs",
      )
      .map(({ evidence }) => {
        const location = evidence.location;
        return location.available && location.value.kind === "source-range"
          ? location.value.source
          : null;
      });
    expect(realSources.sort()).toEqual([
      "create-require.mjs",
      "real-optional.cjs",
      "real.cjs",
      "var.cjs",
    ]);
  },
);
