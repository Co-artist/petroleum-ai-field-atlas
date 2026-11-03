/* Offline PDF storage for imported case packs. Existing small case packs still
   use the original localStorage path; only PDF bytes live in IndexedDB. */
(function (global) {
  'use strict';
  var DB = 'atlas.case.papers.v1', STORE = 'papers', cache = [];

  function database() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error('浏览器不支持 IndexedDB')); return; }
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('论文存储无法打开')); };
    });
  }
  function key(id, name) { return id + '/' + name; }
  function transact(mode, action) {
    return database().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode), request;
        try { request = action(tx.objectStore(STORE)); }
        catch (e) { db.close(); reject(e); return; }
        tx.oncomplete = function () { db.close(); resolve(request && request.result); };
        tx.onerror = function () { db.close(); reject(tx.error || new Error('论文存储失败')); };
        tx.onabort = function () { db.close(); reject(tx.error || new Error('论文存储中断')); };
      });
    });
  }
  function blobFromDataURL(url) {
    var parts = String(url).split(','), head = parts[0], raw = atob(parts[1] || '');
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type: /data:([^;]+)/.exec(head)?.[1] || 'application/pdf' });
  }
  function put(id, name, dataURL) {
    var blob = blobFromDataURL(dataURL);
    return transact('readwrite', function (s) { return s.put(blob, key(id, name)); });
  }
  function get(id, name) { return transact('readonly', function (s) { return s.get(key(id, name)); }); }
  function remove(id, name) { return transact('readwrite', function (s) { return s.delete(key(id, name)); }); }
  function openImported(id, name) {
    /* Open synchronously to preserve the browser's user gesture. */
    var tab = global.open('', '_blank');
    if (!tab) { global.alert('浏览器阻止了新标签页，请允许弹出窗口后重试。'); return; }
    tab.opener = null;
    tab.document.title = '正在打开论文';
    tab.document.body.textContent = '正在读取原始论文 PDF…';
    get(id, name).then(function (blob) {
      if (!blob) throw new Error('未找到随案例包保存的论文，请重新导入完整案例包。');
      var url = URL.createObjectURL(blob);
      cache.push(url);
      tab.location.replace(url);
    }).catch(function (e) {
      tab.document.body.textContent = '论文打开失败：' + e.message;
    });
  }
  global.addEventListener('pagehide', function () {
    cache.forEach(function (u) { URL.revokeObjectURL(u); });
    cache = [];
  });
  global.PaperStore = { put: put, get: get, remove: remove, openImported: openImported };
})(window);
