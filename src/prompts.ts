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

  process.stdout.write(`${label} (input hidden): `);

  const { stdin } = process;
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  try {
    const answer = await new Promise<string>((resolve) => {
      let buf = "";
      const onData = (ch: string) => {
        if (ch === "\r" || ch === "\n") {
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(buf);
        } else if (ch === "\u007F" || ch === "\b") {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
          }
        } else if (ch === "\u0003") {
          stdin.removeListener("data", onData);
          process.exit(130);
        } else {
          buf += ch;
        }
      };
      stdin.on("data", onData);
    });

    const trimmed = answer.trim();

    if (!trimmed) {
      if (options.defaultValue !== undefined) {
        return options.defaultValue;
      }

      return options.allowEmpty ? null : "";
    }

    return trimmed;
  } finally {
    stdin.setRawMode(wasRaw);
    stdin.pause();
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
