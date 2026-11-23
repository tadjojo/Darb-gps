/**
 * Incremental decoder for classic GT06 0x7878 frames over a byte stream.
 * Handles partial frames and multiple frames per chunk. It does not parse or
 * acknowledge packets; callers must validate each emitted frame with parseGt06Frame.
 */
export class Gt06StreamDecoder {
  private buffer = Buffer.alloc(0);
  private readonly maxFrameLength: number;

  constructor(maxFrameLength = 260) {
    if (!Number.isInteger(maxFrameLength) || maxFrameLength < 10 || maxFrameLength > 260) {
      throw new Error('GT06 maxFrameLength must be between 10 and 260 bytes');
    }
    this.maxFrameLength = maxFrameLength;
  }

  push(chunk: Buffer): Buffer[] {
    if (!Buffer.isBuffer(chunk)) throw new Error('GT06 stream chunk must be a Buffer');
    if (chunk.length === 0) return [];
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: Buffer[] = [];

    while (this.buffer.length >= 2) {
      const start = this.buffer.indexOf(Buffer.from([0x78, 0x78]));
      if (start < 0) {
        // Preserve a trailing 0x78 because it may be the first byte of next chunk.
        const keep = this.buffer[this.buffer.length - 1] === 0x78 ? 1 : 0;
        this.buffer = keep ? this.buffer.subarray(this.buffer.length - 1) : Buffer.alloc(0);
        break;
      }
      if (start > 0) this.buffer = this.buffer.subarray(start);
      if (this.buffer.length < 3) break;
      const frameLength = this.buffer[2] + 5;
      if (frameLength < 10 || frameLength > this.maxFrameLength) {
        // Drop one byte and search again rather than trusting a corrupt length.
        this.buffer = this.buffer.subarray(1);
        continue;
      }
      if (this.buffer.length < frameLength) break;
      const candidate = Buffer.from(this.buffer.subarray(0, frameLength));
      this.buffer = this.buffer.subarray(frameLength);
      if (candidate[frameLength - 2] !== 0x0d || candidate[frameLength - 1] !== 0x0a) {
        // Invalid terminator: resynchronize on the next possible frame.
        this.buffer = Buffer.concat([candidate.subarray(1), this.buffer]);
        continue;
      }
      frames.push(candidate);
    }
    if (this.buffer.length > this.maxFrameLength) this.buffer = this.buffer.subarray(-this.maxFrameLength);
    return frames;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }

  get bufferedBytes(): number {
    return this.buffer.length;
  }
}
