import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { createVitest, parseCLI } from "vitest/node";

// CLI file filters are substring matches. Select discovered specifications by
// identity instead, retaining each project's include/exclude and runner settings.
const { filter, options } = parseCLI(["vitest", ...process.argv.slice(2)]);
const vitest = await createVitest({ ...options, watch: false });
try {
  await vitest.standalone();
  const discovered = new Map();
  for (const specification of await vitest.globTestSpecifications()) {
    const path = resolve(specification.moduleId);
    const specifications = discovered.get(path) ?? [];
    specifications.push(specification);
    discovered.set(path, specifications);
  }
  const selected = new Set();
  const missing = [];
  for (const path of filter) {
    const absolute = resolve(path);
    let matches = discovered.get(absolute) ?? [];
    if (matches.length === 0 && process.platform === "win32") {
      const canonical = await realpath(absolute);
      for (const [candidate, specifications] of discovered) {
        // Confirm filesystem identity: Windows directories may opt into case
        // sensitivity, and different symlink spellings must remain distinct.
        if (
          candidate.toLowerCase() === absolute.toLowerCase() &&
          (await realpath(candidate)) === canonical
        )
          matches = [...matches, ...specifications];
      }
    }
    if (matches.length === 0) missing.push(path);
    for (const specification of matches) selected.add(specification);
  }
  if (missing.length > 0 || selected.size === 0)
    throw new Error(
      `Selected test files were not discovered: ${missing.join(", ")}`,
    );
  await vitest.runTestSpecifications([...selected]);
} finally {
  await vitest.close();
}
