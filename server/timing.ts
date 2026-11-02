export function requestTiming(response: Response, began: number, authorized: number) {
  return [
    `auth;dur=${(authorized - began).toFixed(1)}`,
    response.headers.get("Server-Timing"),
    `proxy;dur=${(performance.now() - began).toFixed(1)}`,
  ]
    .filter(Boolean)
    .join(", ");
}
