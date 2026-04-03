import readline from "node:readline/promises";

import { CliError } from "./errors.js";

type PromptOptions = {
  defaultValue?: string | null;
  allowEmpty?: boolean;
};

function renderPrompt(label: string, defaultValue?: string | null): string {
  return defaultValue ? `${label} [${defaultValue}]: ` : `${label}: `;
}

function ensureInteractive(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError("Interactive input is required for this command.");
  }
}

export async function promptLine(
  label: string,
  options: PromptOptions = {},
): Promise<string | null> {
  ensureInteractive();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = (await rl.question(renderPrompt(label, options.defaultValue))).trim();

    if (!answer) {
      if (options.defaultValue !== undefined) {
        return options.defaultValue;
      }

      return options.allowEmpty ? null : "";
    }

    return answer;
  } finally {
    rl.close();
  }
}

export async function promptHidden(
  label: string,
  options: PromptOptions = {},
): Promise<string | null> {
  ensureInteractive();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const mutableRl = rl as readline.Interface & {
    stdoutMuted?: boolean;
    _writeToOutput?: (text: string) => void;
  };
  mutableRl.stdoutMuted = false;
  mutableRl._writeToOutput = (text: string) => {
    if (mutableRl.stdoutMuted) {
      process.stdout.write("*");
      return;
    }

    process.stdout.write(text);
  };

  try {
    process.stdout.write(renderPrompt(label, undefined));
    mutableRl.stdoutMuted = true;
    const answer = (await rl.question("")).trim();
    process.stdout.write("\n");

    if (!answer) {
      if (options.defaultValue !== undefined) {
        return options.defaultValue;
      }

      return options.allowEmpty ? null : "";
    }

    return answer;
  } finally {
    rl.close();
  }
}

export async function confirm(label: string, defaultValue = true): Promise<boolean> {
  const suffix = defaultValue ? "[Y/n]" : "[y/N]";
  const answer = (
    await promptLine(`${label} ${suffix}`, {
      defaultValue: defaultValue ? "y" : "n",
    })
  )?.toLowerCase();

  return ["y", "yes"].includes(answer ?? "");
}
