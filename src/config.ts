const DEFAULT_PORT = 3000;

export function resolvePort(value: string | undefined = process.env.PORT): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_PORT;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT must be an integer between 1 and 65535, received: ${value}`);
  }

  return port;
}
