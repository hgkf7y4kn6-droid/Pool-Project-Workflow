/** Query parameters that carry credentials and must never reach logs. */
const SENSITIVE_QUERY = /([?&](?:token|access_token|refresh_token|sig|signature)=)[^&#]*/gi;

export function redactUrl(url: string): string {
  return url.replace(SENSITIVE_QUERY, "$1[redacted]");
}

/** Request serializer for pino: standard fields, with credential-bearing query values removed from the URL. */
export function requestSerializer(req: { method?: string; url?: string; host?: string; hostname?: string; ip?: string }) {
  return {
    method: req.method,
    url: req.url ? redactUrl(req.url) : req.url,
    host: req.host ?? req.hostname,
    remoteAddress: req.ip,
  };
}
