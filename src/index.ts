#!/usr/bin/env node
import { runCli } from "./cli.js";

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function main(): Promise<void> {
  const exitCode = await runCli(process.argv);
  process.exit(exitCode);
}
