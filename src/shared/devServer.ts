export const DEV_SERVER_PORT = 5180;

export function devServerUrl(pathname = '/'): string {
  return `http://localhost:${DEV_SERVER_PORT}${pathname}`;
}
