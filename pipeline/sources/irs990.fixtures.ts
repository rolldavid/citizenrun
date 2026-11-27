// Test helper for the Form 990 reader: a one-entry zip whose entry is packed with Deflate64.
import { constants, crc32, deflateRawSync } from 'node:zlib';

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
/** Version 2.1, the first that names Deflate64. */
const VERSION = 21;
const UTF8_NAMES = 0x0800;
const DEFLATE64 = 9;
const DOS_DATE_1980_01_01 = 0x0021;

/**
 * A zip of one entry stored with method 9 (Deflate64). Deflate64 reads a Deflate stream as written
 * except for length code 285 and distances past 32 KiB, so the entry is a Huffman-only Deflate
 * stream: literals and an end of block, no matches. yauzl refuses it; Info-ZIP unzip reads it.
 */
export function deflate64Zip(name: string, data: Uint8Array): Buffer {
  const nameBytes = Buffer.from(name, 'utf8');
  const plain = Buffer.from(data);
  const packed = deflateRawSync(plain, { strategy: constants.Z_HUFFMAN_ONLY });
  const crc = crc32(plain);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(LOCAL_HEADER, 0);
  local.writeUInt16LE(VERSION, 4);
  local.writeUInt16LE(UTF8_NAMES, 6);
  local.writeUInt16LE(DEFLATE64, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(DOS_DATE_1980_01_01, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(plain.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(CENTRAL_HEADER, 0);
  central.writeUInt16LE(VERSION, 4);
  central.writeUInt16LE(VERSION, 6);
  central.writeUInt16LE(UTF8_NAMES, 8);
  central.writeUInt16LE(DEFLATE64, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(DOS_DATE_1980_01_01, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(plain.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  // Extra field, comment, disk, attributes and the local header's offset (0) stay zero.

  const directory = Buffer.concat([central, nameBytes]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(local.length + nameBytes.length + packed.length, 16);
  return Buffer.concat([local, nameBytes, packed, directory, end]);
}
