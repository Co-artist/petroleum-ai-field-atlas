/* Offline ZIP reader for case packages. Supports ordinary stored/deflated ZIPs. */
(function (global) {
  'use strict';
  var MAX_ARCHIVE = 64 * 1024 * 1024, MAX_UNPACKED = 128 * 1024 * 1024;
  var crcTable = new Uint32Array(256);
  for (var i = 0; i < 256; i++) {
    var n = i;
    for (var j = 0; j < 8; j++) n = n & 1 ? 0xEDB88320 ^ (n >>> 1) : n >>> 1;
    crcTable[i] = n >>> 0;
  }
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function fail(message) { throw new Error(message); }
  function u16(v, p) { return v.getUint16(p, true); }
  function u32(v, p) { return v.getUint32(p, true); }
  function decodeName(bytes, utf8) {
    return new TextDecoder(utf8 ? 'utf-8' : 'gbk', { fatal: false }).decode(bytes);
  }
  async function inflate(bytes, limit) {
    if (typeof DecompressionStream !== 'function') fail('浏览器不支持 ZIP 解压，请使用新版 Chrome 或 Edge');
    var reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    var chunks = [], size = 0;
    try {
      for (;;) {
        var next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > limit) { await reader.cancel(); fail('ZIP 解压大小超过限制'); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    var out = new Uint8Array(size), offset = 0;
    chunks.forEach(function (chunk) { out.set(chunk, offset); offset += chunk.length; });
    return out;
  }
  async function readZip(file) {
    if (file.size > MAX_ARCHIVE) fail('ZIP 超过 64 MiB，请分批导入');
    var bytes = new Uint8Array(await file.arrayBuffer()), v = new DataView(bytes.buffer);
    var start = Math.max(0, bytes.length - 65557), end = -1;
    for (var p = bytes.length - 22; p >= start; p--) {
      if (u32(v, p) === 0x06054b50 && p + 22 + u16(v, p + 20) === bytes.length) { end = p; break; }
    }
    if (end < 0) fail('不是有效 ZIP 文件，或使用了不支持的 ZIP64 格式');
    if (u16(v, end + 4) || u16(v, end + 6)) fail('不支持多卷 ZIP');
    var count = u16(v, end + 10), centralSize = u32(v, end + 12), pos = u32(v, end + 16);
    if (count > 400 || pos + centralSize > end) fail('ZIP 目录损坏或文件过多');
    var total = 0, result = [], names = Object.create(null);
    for (var k = 0; k < count; k++) {
      if (pos + 46 > end || u32(v, pos) !== 0x02014b50) fail('ZIP 目录项损坏');
      var flags = u16(v, pos + 8), method = u16(v, pos + 10);
      var crc = u32(v, pos + 16), packed = u32(v, pos + 20), size = u32(v, pos + 24);
      var nl = u16(v, pos + 28), extra = u16(v, pos + 30), comment = u16(v, pos + 32), local = u32(v, pos + 42);
      if (pos + 46 + nl + extra + comment > end) fail('ZIP 文件名损坏');
      var name = decodeName(bytes.subarray(pos + 46, pos + 46 + nl), !!(flags & 0x0800)).replace(/\\/g, '/');
      pos += 46 + nl + extra + comment;
      if (name.endsWith('/')) continue;
      if (!name || name[0] === '/' || /(^|\/)\.\.?($|\/)/.test(name) || /^[a-z]:/i.test(name)) fail('ZIP 中存在不安全路径：' + name);
      if (names[name]) fail('ZIP 中存在重复文件：' + name);
      names[name] = true;
      if ((flags & 1) || (method !== 0 && method !== 8)) fail('不支持加密或特殊压缩方式：' + name);
      total += size;
      if (total > MAX_UNPACKED) fail('ZIP 解压后超过 128 MiB');
      if (local + 30 > bytes.length || u32(v, local) !== 0x04034b50) fail('ZIP 文件数据损坏：' + name);
      var dataAt = local + 30 + u16(v, local + 26) + u16(v, local + 28);
      if (dataAt + packed > bytes.length) fail('ZIP 文件数据截断：' + name);
      var compressed = bytes.subarray(dataAt, dataAt + packed);
      var data = method === 0 ? compressed : await inflate(compressed, Math.min(size, MAX_UNPACKED));
      if (data.length !== size || crc32(data) !== crc) fail('ZIP 文件校验失败：' + name);
      result.push({ name: name, bytes: data });
    }
    if (!result.length) fail('ZIP 中没有案例文件');
    return result;
  }
  global.CaseZip = { read: readZip };
})(window);
