"use strict";

// The member names of an archive on disk, read without running anything (story
// 13-13): a tar (plain or gzip) or a zip. null when the archive cannot be read
// this way — another compression, zip64, a damaged header, too large — or when a
// member could land somewhere its plain name does not say (an absolute or `..`
// path, a link, a device): the guard then logs the extraction unchecked.

const fs = require("node:fs");
const zlib = require("node:zlib");

const MAX_ARCHIVE = 32 * 1024 * 1024;
const MAX_EXPANDED = 256 * 1024 * 1024;
const MAX_MEMBERS = 10000;

const cstring = (buf, start, length) => buf.toString("utf8", start, start + length).replace(/\0[\s\S]*$/, "");

function octal(buf, start, length) {
  const text = buf.toString("latin1", start, start + length).replace(/\0[\s\S]*$/, "").trim();
  return text === "" ? 0 : /^[0-7]+$/.test(text) ? parseInt(text, 8) : NaN;
}

function checksumHolds(header) {
  let sum = 0;
  for (let i = 0; i < 512; i += 1) {
    sum += i >= 148 && i < 156 ? 32 : header[i];
  }
  return octal(header, 148, 8) === sum;
}

const paxPath = (text) => (text.match(/(?:^|\n)\d+ path=([^\n]*)/) || [])[1] ?? null;

// Regular files ("0", NUL, "7", GNU sparse "S") and directories ("5", GNU "D");
// any other entry type (links, devices, fifos, GNU long link names) is unsafe.
const FILE_TYPES = new Set(["0", "\0", "7", "S"]);
const DIRECTORY_TYPES = new Set(["5", "D"]);

function tarMembers(buf) {
  const members = [];
  let longName = null;
  let pax = null;
  for (let offset = 0; offset + 512 <= buf.length;) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const size = octal(header, 124, 12);
    const body = offset + 512;
    if (!checksumHolds(header) || !Number.isFinite(size) || body + size > buf.length) {
      return null;
    }
    const type = String.fromCharCode(header[156]);
    if (type === "L") {
      longName = cstring(buf, body, size);
    } else if (type === "x" || type === "g") {
      pax = paxPath(buf.toString("utf8", body, body + size)) ?? pax;
      if (type === "g" && pax !== null) {
        return null;
      }
    } else {
      const prefix = header.toString("latin1", 257, 262) === "ustar" ? cstring(header, 345, 155) : "";
      const name = pax ?? longName ?? (prefix ? `${prefix}/` : "") + cstring(header, 0, 100);
      members.push({ name, directory: DIRECTORY_TYPES.has(type) || name.endsWith("/"), unsafe: !FILE_TYPES.has(type) && !DIRECTORY_TYPES.has(type) });
      longName = null;
      pax = null;
    }
    offset = body + Math.ceil(size / 512) * 512;
  }
  return members;
}

function zipMembers(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return null;
  }
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  if (count === 0xffff || at === 0xffffffff) {
    return null;
  }
  const members = [];
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) {
      return null;
    }
    const nameLength = buf.readUInt16LE(at + 28);
    const unix = buf.readUInt16LE(at + 4) >> 8 === 3;
    const mode = (buf.readUInt32LE(at + 38) >>> 16) & 0o170000;
    // unzip reads a backslash as a separator in names written on Windows.
    const name = buf.toString("utf8", at + 46, at + 46 + nameLength).replace(/\\/g, "/");
    members.push({ name, directory: name.endsWith("/"), unsafe: unix && mode !== 0 && mode !== 0o100000 && mode !== 0o040000 });
    at += 46 + nameLength + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return members;
}

function landsWhereNamed({ name, unsafe }) {
  return !unsafe && name !== "" && !/^(?:\/|[A-Za-z]:)/.test(name) && !name.split(/[\\/]/).includes("..");
}

function archiveMembers(file) {
  let data;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_ARCHIVE) {
      return null;
    }
    data = fs.readFileSync(file);
  } catch {
    return null;
  }
  let members;
  try {
    if (data.length >= 4 && (data.readUInt32LE(0) === 0x04034b50 || data.readUInt32LE(0) === 0x06054b50)) {
      members = zipMembers(data);
    } else if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
      members = tarMembers(zlib.gunzipSync(data, { maxOutputLength: MAX_EXPANDED }));
    } else {
      members = tarMembers(data);
    }
  } catch {
    return null;
  }
  if (!members || members.length === 0 || members.length > MAX_MEMBERS || !members.every(landsWhereNamed)) {
    return null;
  }
  return members;
}

module.exports = { archiveMembers };
