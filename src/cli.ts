import { parseArgv, parseFlags } from "./args.js";
import {
  runAuthCommand,
  runContextCommand,
  runDoctor,
  runInit,
  runProfileCommand,
} from "./admin.js";
import { runApply, formatApplySummary } from "./apply.js";
import { loadResolvedConfig, requireConnectionConfig } from "./config.js";
import { runExport } from "./export.js";
import { CliError } from "./errors.js";
import {
  countManifestResources,
  createExampleManifest,
  loadManifest,
  normalizeManifest,
  validateManifest,
} from "./manifest.js";
import { createNocoClient } from "./nocodb-client.js";
import { keyValueListToObject, printOutput, readJsonInput } from "./utils.js";

function renderHelp(): string {
  return `noco-meta

Usage:
  noco-meta init
  noco-meta profile <ls|show|add|use|rm|default>
  noco-meta auth <set|rm|status>
  noco-meta context <show|set|clear>
  noco-meta doctor
  noco-meta request <METHOD> <PATH> [--body @file.json] [--query key=value] [--header key=value]
  noco-meta export [-o file.json] [--compact] [--table "T1,T2"] [--include-system]
  noco-meta apply <manifest.json>
  noco-meta plan <manifest.json>
  noco-meta validate <manifest.json>
  noco-meta template manifest

Global options:
  --profile <name>        profile override
  --base-url <url>       NocoDB base URL
  --token <token>        xc-token
  --api-version <v2|v3>  default: v3
  --workspace-id <id>    default workspace override
  --base-id <id>         default base override
  --json                 print machine-readable output where relevant

Connection notes:
  - local interactive use requires "noco-meta init"
  - CI or other non-interactive runs can use NOCODB_BASE_URL and NOCODB_TOKEN
  - flags override resolved config but do not replace init for local use

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

async function runExportCommand(
  globalConfig: Awaited<ReturnType<typeof loadResolvedConfig>>,
  args: string[],
): Promise<void> {
  const { flags } = parseFlags(args, {
    booleanFlags: ["compact", "include-system"],
  });

  if (!globalConfig.baseId) {
    throw new CliError(
      "export requires --base-id or a configured base context (via init / context set).",
    );
  }

  const client = createNocoClient(globalConfig);
  const tableFilter = flags.table
    ? String(flags.table)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  const manifest = await runExport(client, {
    baseId: globalConfig.baseId,
    workspaceId: globalConfig.workspaceId,
    tables: tableFilter,
    includeSystem: flags["include-system"] === true,
  });

  const json = flags.compact ? JSON.stringify(manifest) : JSON.stringify(manifest, null, 2);

  const outputPath = flags.o ?? flags.output;

  if (outputPath) {
    const fs = await import("node:fs");
    fs.writeFileSync(String(outputPath), `${json}\n`, "utf8");
    printOutput(`Exported to ${outputPath}`);
  } else {
    process.stdout.write(`${json}\n`);
  }
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

async function runValidate(
  args: string[],
  globalConfig: Awaited<ReturnType<typeof loadResolvedConfig>>,
): Promise<void> {
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
  globalConfig: Awaited<ReturnType<typeof loadResolvedConfig>>,
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
    baseId: globalConfig.baseId,
  });

  if (globalConfig.json) {
    printOutput(summary);
    return;
  }

  printOutput(formatApplySummary(summary));
}

export async function runCli(argv: string[]): Promise<void> {
  const parsed = parseArgv(argv);

  if (parsed.command === "help" || parsed.globals.help === true) {
    printOutput(renderHelp());
    return;
  }

  switch (parsed.command) {
    case "init":
      await runInit(parsed.globals, parsed.commandArgs);
      return;

    case "profile":
      await runProfileCommand(parsed.globals, parsed.commandArgs);
      return;

    case "auth":
      await runAuthCommand(parsed.globals, parsed.commandArgs);
      return;

    case "context":
      await runContextCommand(parsed.globals, parsed.commandArgs);
      return;

    case "doctor":
      await runDoctor(parsed.globals);
      return;

    case "export": {
      const globalConfig = await loadResolvedConfig(parsed.globals);
      requireConnectionConfig(globalConfig);
      await runExportCommand(globalConfig, parsed.commandArgs);
      return;
    }

    case "request": {
      const globalConfig = await loadResolvedConfig(parsed.globals);
      requireConnectionConfig(globalConfig);
      const client = createNocoClient(globalConfig);
      await runRequest(client, parsed.commandArgs);
      return;
    }

    case "apply":
    case "plan": {
      const globalConfig = await loadResolvedConfig(parsed.globals);
      await runApplyLike(parsed.command, parsed.commandArgs, globalConfig);
      return;
    }

    case "validate": {
      const globalConfig = await loadResolvedConfig(parsed.globals);
      await runValidate(parsed.commandArgs, globalConfig);
      return;
    }

    case "template":
      await runTemplate(parsed.commandArgs);
      return;

    default:
      throw new CliError(`Unknown command "${parsed.command}".\n\n${renderHelp()}`);
  }
}
