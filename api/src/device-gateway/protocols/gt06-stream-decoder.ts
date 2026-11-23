/**
 * Incremental decoder for GT06 0x7878 and 0x7979 frames over a byte stream.
 * Handles partial frames, multiple frames per chunk, and basic resynchronization.
 * CRC and protocol validation are delegated to parseGt06Frame.
 */
export class Gt06StreamDecoder {
  private buffer = Buffer.alloc(0);
  private readonly maxFrameLength: number;

  constructor(maxFrameLength = 4096) {
    if (!Number.isInteger(maxFrameLength) || maxFrameLength < 10 || maxFrameLength > 65541) {
      throw new Error('GT06 maxFrameLength must be between 10 and 65541 bytes');
    }
    this.maxFrameLength = maxFrameLength;
  }

  push(chunk: Buffer): Buffer[] {
    if (!Buffer.isBuffer(chunk)) throw new Error('GT06 stream chunk must be a Buffer');
    if (chunk.length === 0) return [];
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: Buffer[] = [];

    while (this.buffer.length >= 2) {
      const shortStart = this.buffer.indexOf(Buffer.from([0x78, 0x78]));
      const extendedStart = this.buffer.indexOf(Buffer.from([0x79, 0x79]));
      const start = shortStart < 0 ? extendedStart
        : extendedStart < 0 ? shortStart : Math.min(shortStart, extendedStart);
      if (start < 0) {
        const last = this.buffer[this.buffer.length - 1];
        const keep = last === 0x78 || last === 0x79;
        this.buffer = keep ? this.buffer.subarray(this.buffer.length - 1) : Buffer.alloc(0);
        break;
      }
      if (start > 0) this.buffer = this.buffer.subarray(start);
      const extended = this.buffer[0] === 0x79;
      const headerLength = extended ? 4 : 3;
      if (this.buffer.length < headerLength) break;
      const payloadLength = extended ? this.buffer.readUInt16BE(2) : this.buffer[2];
      const frameLength = payloadLength + (extended ? 6 : 5);
      if (payloadLength < 5 || frameLength > this.maxFrameLength) {
        this.buffer = this.buffer.subarray(1);
        continue;
      }
      if (this.buffer.length < frameLength) break;
      const candidate = Buffer.from(this.buffer.subarray(0, frameLength));
      this.buffer = this.buffer.subarray(frameLength);
      if (candidate[frameLength - 2] !== 0x0d || candidate[frameLength - 1] !== 0x0a) {
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
