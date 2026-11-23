/** Incremental CRLF line decoder for NMEA 0183 streams. Checksum validation
 * is intentionally delegated to parseNmeaSentence. */
export class NmeaStreamDecoder {
  private buffer = '';
  constructor(private readonly maxLineLength = 256) {
    if (!Number.isInteger(maxLineLength) || maxLineLength < 16 || maxLineLength > 4096) {
      throw new Error('NMEA maxLineLength must be between 16 and 4096 characters');
    }
  }

  push(chunk: string | Buffer): string[] {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('ascii');
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) {
      throw new Error('NMEA stream contains non-printable control characters');
    }
    this.buffer += text;
    const lines: string[] = [];
    let boundary: number;
    while ((boundary = this.buffer.indexOf('\n')) >= 0) {
      let line = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.length === 0) continue;
      if (line.length > this.maxLineLength) throw new Error('NMEA sentence exceeds maximum length');
      lines.push(line);
    }
    if (this.buffer.length > this.maxLineLength) {
      this.buffer = '';
      throw new Error('NMEA partial sentence exceeds maximum length');
    }
    return lines;
  }

  reset(): void {
    this.buffer = '';
  }

  get bufferedCharacters(): number {
    return this.buffer.length;
  }
}
