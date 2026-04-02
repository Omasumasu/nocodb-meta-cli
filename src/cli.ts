import { parseArgv, parseFlags } from "./args.js";
import { runApply, formatApplySummary } from "./apply.js";
import { loadResolvedConfig, requireConnectionConfig } from "./config.js";
import { CliError } from "./errors.js";
import {
  countManifestResources,
  createExampleManifest,
  loadManifest,
  normalizeManifest,
  validateManifest,
} from "./manifest.js";
import { createNocoClient } from "./nocodb-client.js";
import type { CliConfig } from "./types.js";
import { keyValueListToObject, printOutput, readJsonInput } from "./utils.js";

function renderHelp(): string {
  return `noco-meta

Usage:
  noco-meta request <METHOD> <PATH> [--body @file.json] [--query key=value] [--header key=value]
  noco-meta apply <manifest.json>
  noco-meta plan <manifest.json>
  noco-meta validate <manifest.json>
  noco-meta template manifest

Global options:
  --base-url <url>       NocoDB base URL
  --token <token>        xc-token
  --api-version <v2|v3>  default: v3
  --workspace-id <id>    default workspace override
  --base-id <id>         default base override
  --json                 print machine-readable output where relevant

Manifest notes:
  - JSON only for now
  - high-level apply is idempotent for workspace/base/table/field/view creation
  - use the request command for unsupported edge cases
`;
}

function validatePathArg(positionals: string[], commandName: string): string {
  if (!positionals[0]) {
    throw new CliError(`${commandName} requires a manifest path.`);
  }

  return positionals[0];
}

async function runRequest(
  client: ReturnType<typeof createNocoClient>,
  args: string[],
): Promise<void> {
  const { flags, positionals } = parseFlags(args);
  const [method, requestPath] = positionals;

  if (!method || !requestPath) {
    throw new CliError("request requires METHOD and PATH.");
  }

  const body = flags.body ? await readJsonInput(flags.body as string) : undefined;
  const query = keyValueListToObject(flags.query);
  const headers = keyValueListToObject(flags.header) as Record<string, string>;
  const response = await client.request(method.toUpperCase(), requestPath, {
    body,
    query,
    headers,
  });

  printOutput(response ?? {});
}

async function runValidate(args: string[], globalConfig: CliConfig): Promise<void> {
  const { positionals } = parseFlags(args);
  const manifest = loadManifest(validatePathArg(positionals, "validate"));
  validateManifest(manifest);
  const counts = countManifestResources(manifest);

  if (globalConfig.json) {
    printOutput({
      valid: true,
      counts,
      manifest,
    });
    return;
  }

  printOutput(
    `Manifest valid: ${counts.tables} table(s), ${counts.fields} field(s), ${counts.views} view(s).`,
  );
}

async function runTemplate(args: string[]): Promise<void> {
  const { positionals } = parseFlags(args);

  if (positionals[0] !== "manifest") {
    throw new CliError('template currently supports only "manifest".');
  }

  printOutput(createExampleManifest());
}

async function runApplyLike(
  command: "apply" | "plan",
  args: string[],
  globalConfig: CliConfig,
): Promise<void> {
  requireConnectionConfig(globalConfig);

  const { flags, positionals } = parseFlags(args, {
    booleanFlags: ["dry-run"],
  });
  const manifest = loadManifest(validatePathArg(positionals, command));
  const client = createNocoClient(globalConfig);
  const summary = await runApply(client, normalizeManifest(manifest as any), {
    dryRun: command === "plan" || flags["dry-run"] === true,
    workspaceId: globalConfig.workspaceId,
  });

  if (globalConfig.json) {
    printOutput(summary);
    return;
  }

  printOutput(formatApplySummary(summary));
}

export async function runCli(argv: string[]): Promise<void> {
  const parsed = parseArgv(argv);
  const globalConfig = loadResolvedConfig(parsed.globals);

  if (parsed.command === "help" || parsed.globals.help === true) {
    printOutput(renderHelp());
    return;
  }

  switch (parsed.command) {
    case "request": {
      requireConnectionConfig(globalConfig);
      const client = createNocoClient(globalConfig);
      await runRequest(client, parsed.commandArgs);
      return;
    }

    case "apply":
    case "plan":
      await runApplyLike(parsed.command, parsed.commandArgs, globalConfig);
      return;

    case "validate":
      await runValidate(parsed.commandArgs, globalConfig);
      return;

    case "template":
      await runTemplate(parsed.commandArgs);
      return;

    default:
      throw new CliError(`Unknown command "${parsed.command}".\n\n${renderHelp()}`);
  }
}
