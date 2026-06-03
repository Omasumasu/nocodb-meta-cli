import { runCli } from "./cli.js";
import { CliError } from "./errors.js";

runCli(process.argv.slice(2)).catch((error) => {
  if (error instanceof CliError) {
    console.error(error.message);
    if (error.details !== undefined) {
      console.error(error.details);
    }
    process.exit(error.exitCode);
  }
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
