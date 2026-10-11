import { LogLevel, BuildStage } from '@deployforge/shared-types';

export class SecretRedactor {
  private secrets: Set<string> = new Set();

  constructor(initialSecrets?: string[]) {
    if (initialSecrets) {
      this.addSecrets(initialSecrets);
    }
  }

  public addSecret(secret: string): void {
    const trimmed = secret.trim();
    // Do not register trivially short secrets to avoid over-redaction (e.g. "a", "true")
    if (trimmed.length >= 4) {
      this.secrets.add(trimmed);
    }
  }

  public addSecrets(secrets: string[]): void {
    for (const secret of secrets) {
      this.addSecret(secret);
    }
  }

  public redact(message: string): string {
    if (!message || this.secrets.size === 0) {
      return message;
    }
    let sanitized = message;
    for (const secret of this.secrets) {
      // Escape special regex characters in the secret string
      const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      sanitized = sanitized.replace(new RegExp(escaped, 'g'), '[REDACTED_SECRET]');
    }
    return sanitized;
  }
}

/**
 * Strips dangerous terminal escape sequences, ANSI codes, and control characters (except newline and tab)
 */
export function sanitizeLogContent(input: string): string {
  if (!input) return '';
  // Remove ANSI escape codes
  // eslint-disable-next-line no-control-regex
  let cleaned = input.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
  // Remove ASCII control characters except \n (10), \r (13), \t (9)
  // eslint-disable-next-line no-control-regex
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return cleaned;
}

export interface StructuredLogEntry {
  deploymentId?: string;
  stage?: BuildStage;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export class AppLogger {
  private redactor: SecretRedactor;
  private prefix: string;

  constructor(prefix = 'DeployForge', redactor = new SecretRedactor()) {
    this.prefix = prefix;
    this.redactor = redactor;
  }

  public setRedactor(redactor: SecretRedactor): void {
    this.redactor = redactor;
  }

  public log(level: LogLevel, message: string, metadata?: Record<string, unknown>, stage?: BuildStage): StructuredLogEntry {
    const cleanMsg = sanitizeLogContent(this.redactor.redact(message));
    const entry: StructuredLogEntry = {
      level,
      message: cleanMsg,
      metadata,
      stage,
      timestamp: new Date().toISOString(),
    };

    const out = `[${entry.timestamp}] [${level}] [${this.prefix}${stage ? `:${stage}` : ''}] ${cleanMsg}`;
    if (level === LogLevel.ERROR) {
      console.error(out);
    } else if (level === LogLevel.WARN) {
      console.warn(out);
    } else {
      console.log(out);
    }

    return entry;
  }

  public info(message: string, metadata?: Record<string, unknown>, stage?: BuildStage): StructuredLogEntry {
    return this.log(LogLevel.INFO, message, metadata, stage);
  }

  public warn(message: string, metadata?: Record<string, unknown>, stage?: BuildStage): StructuredLogEntry {
    return this.log(LogLevel.WARN, message, metadata, stage);
  }

  public error(message: string, metadata?: Record<string, unknown>, stage?: BuildStage): StructuredLogEntry {
    return this.log(LogLevel.ERROR, message, metadata, stage);
  }

  public debug(message: string, metadata?: Record<string, unknown>, stage?: BuildStage): StructuredLogEntry {
    return this.log(LogLevel.DEBUG, message, metadata, stage);
  }
}
