export class CliError extends Error {
  exitCode: number;
  status?: number;
  details?: unknown;

  constructor(
    message: string,
    options: { exitCode?: number; status?: number; details?: unknown } = {},
  ) {
    super(message);
    this.name = "CliError";
    this.exitCode = options.exitCode ?? 1;
    this.status = options.status;
    this.details = options.details;
  }
}
