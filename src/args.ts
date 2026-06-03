import type { FlagMap } from "./types.js";

const GLOBAL_BOOLEAN_FLAGS = new Set(["json", "verbose", "help"]);
const GLOBAL_FLAGS = new Set([
  "api-version",
  "base-id",
  "base-url",
  "config",
  "help",
  "json",
  "profile",
  "token",
  "verbose",
  "workspace-id",
]);

function appendFlag(target: FlagMap, key: string, value: string | boolean): void {
  if (target[key] === undefined) {
    target[key] = value;
    return;
  }

  if (!Array.isArray(target[key])) {
    target[key] = [target[key] as string | boolean];
  }

  (target[key] as Array<string | boolean>).push(value);
}

function consumeFlag(
  argv: string[],
  index: number,
  booleanFlags: Set<string>,
  target: FlagMap,
): number {
  const token = argv[index];
  const withoutPrefix = token.slice(2);
  const equalsIndex = withoutPrefix.indexOf("=");

  if (equalsIndex !== -1) {
    const key = withoutPrefix.slice(0, equalsIndex);
    const value = withoutPrefix.slice(equalsIndex + 1);
    appendFlag(target, key, value);
    return index;
  }

  const key = withoutPrefix;
  const nextToken = argv[index + 1];
  const shouldUseBoolean =
    booleanFlags.has(key) || nextToken === undefined || nextToken.startsWith("--");

  appendFlag(target, key, shouldUseBoolean ? true : nextToken);
  return shouldUseBoolean ? index : index + 1;
}

export function parseArgv(argv: string[]): {
  command: string;
  globals: FlagMap;
  commandArgs: string[];
} {
  const globals: FlagMap = {};
  const commandArgs: string[] = [];
  let command: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token.startsWith("--")) {
      const currentCommand = command;
      const previewKey = token.slice(2).split("=")[0];

      if (currentCommand === null || GLOBAL_FLAGS.has(previewKey)) {
        index = consumeFlag(argv, index, GLOBAL_BOOLEAN_FLAGS, globals);
        continue;
      }
    }

    if (command === null) {
      command = token;
      continue;
    }

    commandArgs.push(token);
  }

  return {
    command: command ?? "help",
    globals,
    commandArgs,
  };
}

export function parseFlags(
  argv: string[],
  options: { booleanFlags?: string[] } = {},
): { flags: FlagMap; positionals: string[] } {
  const booleanFlags = new Set(options.booleanFlags ?? []);
  const flags: FlagMap = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token.startsWith("--")) {
      index = consumeFlag(argv, index, booleanFlags, flags);
      continue;
    }

    positionals.push(token);
  }

  return { flags, positionals };
}
