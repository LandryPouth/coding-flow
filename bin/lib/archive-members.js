"use strict";

// The member names of an archive on disk, read without running anything (story
// 13-13). Only a strict subset of each format is trusted — the review of 13-13
// forged pax records, old GNU headers, data past the end marker and tar/zip
// polyglots that a lenient reader lists as benign while tar or unzip writes
// elsewhere. Anything outside the subset is null, and the guard logs the
// extraction unchecked:
//
// - tar (plain or gzip): POSIX ustar headers only (`ustar\0` + `00`), entry
//   types regular file or directory only — no pax, no GNU extension — and only
//   zero bytes after the first zero block;
// - zip: a local header at offset 0, the central directory right before the end
//   record, each local name equal to its central name, no duplicate names, only
//   the timestamp and owner extra fields, regular files and directories only,
//   no zip64.
//
// `format`: "tar" (tar, gtar), "zip" (unzip), "any" (bsdtar, which detects the
// format itself: trusted only when the bytes are exactly one of the subsets).

const fs = require("node:fs");
const zlib = require("node:zlib");

const MAX_ARCHIVE = 32 * 1024 * 1024;
const MAX_EXPANDED = 64 * 1024 * 1024;
const MAX_MEMBERS = 10000;

const cstring = (buf, start, length) => buf.toString("utf8", start, start + length).replace(/\0[\s\S]*$/, "");

function octal(buf, start, length) {
  const text = buf.toString("latin1", start, start + length).replace(/\0[\s\S]*$/, "").trim();
  return /^[0-7]+$/.test(text) ? parseInt(text, 8) : NaN;
}

function checksumHolds(header) {
  let sum = 0;
  for (let i = 0; i < 512; i += 1) {
    sum += i >= 148 && i < 156 ? 32 : header[i];
  }
  return octal(header, 148, 8) === sum;
}

const isZero = (buf) => buf.every((byte) => byte === 0);

function strictTar(buf) {
  const members = [];
  for (let offset = 0; offset + 512 <= buf.length;) {
    const header = buf.subarray(offset, offset + 512);
    if (isZero(header)) {
      return isZero(buf.subarray(offset)) ? members : null;
    }
    const size = octal(header, 124, 12);
    const body = offset + 512;
    const type = header[156] === 0 ? "0" : String.fromCharCode(header[156]);
    if (header.toString("latin1", 257, 265) !== "ustar\u000000" || !checksumHolds(header) || !Number.isFinite(size) || body + size > buf.length || !["0", "5"].includes(type)) {
      return null;
    }
    const prefix = cstring(header, 345, 155);
    const name = (prefix ? `${prefix}/` : "") + cstring(header, 0, 100);
    members.push({ name, directory: type === "5" || name.endsWith("/") });
    if (members.length > MAX_MEMBERS) {
      return null;
    }
    offset = body + Math.ceil(size / 512) * 512;
  }
  return null; // no end marker
}

// Timestamps (UT 0x5455), Unix owner (ux 0x7875) and NTFS times (0x000a): none
// of them renames a member. Anything else (Unicode path 0x7075, zip64, unknown)
// may.
const PLAIN_EXTRA = new Set([0x5455, 0x7875, 0x000a]);

function plainExtra(buf, start, length) {
  for (let at = start; at < start + length;) {
    if (at + 4 > start + length || !PLAIN_EXTRA.has(buf.readUInt16LE(at))) {
      return false;
    }
    at += 4 + buf.readUInt16LE(at + 2);
  }
  return true;
}

function endRecord(buf) {
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50 && i + 22 + buf.readUInt16LE(i + 20) === buf.length) {
      return i;
    }
  }
  return -1;
}

function localMatches(buf, at, name) {
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== 0x04034b50) {
    return false;
  }
  const nameLength = buf.readUInt16LE(at + 26);
  const extraLength = buf.readUInt16LE(at + 28);
  return nameLength === name.length && buf.subarray(at + 30, at + 30 + nameLength).equals(name) && plainExtra(buf, at + 30 + nameLength, extraLength);
}

function strictZip(buf) {
  const end = buf.length >= 22 && buf.readUInt32LE(0) === 0x04034b50 ? endRecord(buf) : -1;
  if (end === -1 || buf.readUInt16LE(end + 4) !== 0 || buf.readUInt16LE(end + 6) !== 0) {
    return null;
  }
  const count = buf.readUInt16LE(end + 10);
  const size = buf.readUInt32LE(end + 12);
  let at = buf.readUInt32LE(end + 16);
  if (count !== buf.readUInt16LE(end + 8) || count === 0xffff || at + size !== end || count > MAX_MEMBERS) {
    return null;
  }
  const members = [];
  const seen = new Set();
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > end || buf.readUInt32LE(at) !== 0x02014b50) {
      return null;
    }
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const mode = (buf.readUInt32LE(at + 38) >>> 16) & 0o170000;
    const raw = buf.subarray(at + 46, at + 46 + nameLength);
    if (![0, 0o100000, 0o040000].includes(mode) || !plainExtra(buf, at + 46 + nameLength, extraLength) || !localMatches(buf, buf.readUInt32LE(at + 42), raw)) {
      return null;
    }
    // unzip reads a backslash as a separator in names written on Windows.
    const name = raw.toString("utf8").replace(/\\/g, "/");
    if (seen.has(name.toLowerCase())) {
      return null;
    }
    seen.add(name.toLowerCase());
    members.push({ name, directory: name.endsWith("/") });
    at += 46 + nameLength + extraLength + buf.readUInt16LE(at + 32);
  }
  return at === end ? members : null;
}

function landsWhereNamed({ name }) {
  return name !== "" && !/^(?:\/|[A-Za-z]:)/.test(name) && !name.split(/[\\/]/).includes("..");
}

function tarOf(data) {
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    return strictTar(zlib.gunzipSync(data, { maxOutputLength: MAX_EXPANDED }));
  }
  return strictTar(data);
}

function readMembers(data, format) {
  if (format === "zip") {
    return strictZip(data);
  }
  if (format === "tar") {
    return tarOf(data);
  }
  return format === "any" ? tarOf(data) || strictZip(data) : null;
}

function archiveMembers(file, format) {
  let members;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_ARCHIVE) {
      return null;
    }
    members = readMembers(fs.readFileSync(file), format);
  } catch {
    return null;
  }
  return members && members.length > 0 && members.every(landsWhereNamed) ? members : null;
}

module.exports = { archiveMembers };
