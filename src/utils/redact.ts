const SECRET_PATTERNS = [
  /\bghp_[A-Za-z0-9]{36}\b/g,
  /\bgho_[A-Za-z0-9]{36}\b/g,
  /\bghs_[A-Za-z0-9]{36}\b/g,
  /\bghr_[A-Za-z0-9]{36}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{11,221}\b/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /NEOSANTARA_API_KEY\s*=\s*[^\s]+/gi,
  /Authorization:\s*Bearer\s+[^\s]+/gi,
  /x-api-key:\s*[^\s]+/gi,
];

export function redact(value: string): string {
  let result = value;
  for (const pattern of SECRET_PATTERNS)
    result = result.replace(pattern, "[REDACTED]");
  for (const [key, envValue] of Object.entries(process.env)) {
    if (!envValue || envValue.length < 8) continue;
    if (/TOKEN|KEY|SECRET|PASSWORD|AUTH|CREDENTIAL/i.test(key)) {
      result = result.split(envValue).join("[REDACTED]");
    }
  }
  return result;
}
