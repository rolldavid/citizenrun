// Test helpers for the Form 990 reader: one-entry zips whose entry is packed with Deflate64, plain
// and laid out as the IRS batches are.
import { constants, crc32, deflateRawSync } from 'node:zlib';
import { singleEntryZip } from './irs990.ts';

/**
 * A zip of one entry stored with method 9 (Deflate64). Deflate64 reads a Deflate stream as written
 * except for length code 285 and distances past 32 KiB, so the entry is a Huffman-only Deflate
 * stream: literals and an end of block, no matches. yauzl refuses it; Info-ZIP unzip reads it.
 */
export function deflate64Zip(name: string, data: Uint8Array): Buffer {
  return singleEntryZip(name, {
    method: 9,
    packed: deflateRawSync(data, { strategy: constants.Z_HUFFMAN_ONLY }),
    crc32: crc32(data),
    size: data.length,
  });
}

const ZIP64_END = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;
const END_RECORD = 22;

/**
 * `deflate64Zip` with the end records of an IRS batch: a Zip64 end record and locator before the
 * end record, the end record's entry counts 0xFFFF, and the locator's disk count 0 where the format
 * asks for 1. yauzl reads that layout; UnZip 6.00 misreads it and exits non-zero.
 */
export function irsBatchZip(name: string, data: Uint8Array): Buffer {
  const zip = deflate64Zip(name, data);
  const endAt = zip.length - END_RECORD;
  const directorySize = zip.readUInt32LE(endAt + 12);
  const directoryAt = zip.readUInt32LE(endAt + 16);
  const record = Buffer.alloc(56);
  record.writeUInt32LE(ZIP64_END, 0);
  record.writeBigUInt64LE(44n, 4);
  record.writeUInt16LE(45, 12);
  record.writeUInt16LE(45, 14);
  record.writeBigUInt64LE(1n, 24);
  record.writeBigUInt64LE(1n, 32);
  record.writeBigUInt64LE(BigInt(directorySize), 40);
  record.writeBigUInt64LE(BigInt(directoryAt), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(ZIP64_LOCATOR, 0);
  locator.writeBigUInt64LE(BigInt(endAt), 8);
  // The disk count (offset 16) stays 0, as the IRS writes it.
  const end = Buffer.from(zip.subarray(endAt));
  end.writeUInt16LE(0xffff, 8);
  end.writeUInt16LE(0xffff, 10);
  return Buffer.concat([zip.subarray(0, endAt), record, locator, end]);
}
