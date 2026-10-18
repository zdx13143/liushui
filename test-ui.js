const fs = require('fs');
const vm = require('vm');
const path = require('path');

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

// 提取所有内联 script（有 src 的说明内联失败）
const blocks = [];
const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html))) {
  if (/\ssrc=/.test(m[1])) { console.log('  发现外部 script: ' + m[1].trim()); continue; }
  blocks.push({ attrs: m[1], code: m[2] });
}
console.log('内联 script 块数: ' + blocks.length);

// ---- 最小 DOM stub ----
const nodes = {};
function El(tag) {
  const e = {
    tagName: tag || 'div', innerHTML: '', textContent: '', className: '', value: '', href: '', download: '',
    style: { cssText: '' }, children: [],
    classList: { add() {}, remove() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; },
    remove() {}, focus() {}, click() {}, setAttribute() {}, addEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { width: 300, height: 200 }; },
    getContext() { return null; },
    parentNode: null
  };
  return e;
}
const document = {
  getElementById(id) { return nodes[id] || (nodes[id] = El('div')); },
  createElement(t) { return El(t); },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {},
  body: El('body'),
  documentElement: El('html')
};
document.body.appendChild = function (c) { this.children.push(c); return c; };

const storage = {};
const ctx = {
  console,
  document,
  navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', language: 'zh-CN' },
  localStorage: {
    getItem: k => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: k => { delete storage[k]; }
  },
  TextEncoder, TextDecoder, Date, Math, JSON, Promise, setTimeout, clearTimeout, setInterval,
  fetch: () => Promise.reject(new Error('no network in test')),
  URL: { createObjectURL: () => 'blob:x' },
  Blob: function () {},
  Intl, RegExp, Error, TypeError, ArrayBuffer, Uint8Array, Float64Array, String, Number, Object, Array, Boolean, Function, isNaN, parseFloat, parseInt, encodeURIComponent, decodeURIComponent
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
ctx.scrollTo = function () {};
vm.createContext(ctx);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}

console.log('\n执行内联脚本：');
blocks.forEach((b, i) => {
  const label = b.attrs.trim() ? b.attrs.trim().slice(0, 40) : ('block#' + i);
  try {
    vm.runInContext(b.code, ctx, { timeout: 20000 });
    console.log('  ran  ' + label);
  } catch (e) {
    console.log('  ERR  ' + label + ' :: ' + e.message);
    if (b.attrs.includes('id="core"') || i >= blocks.length - 1) { fail++; console.log('  FAIL 关键脚本执行失败'); }
  }
});

console.log('\n渲染结果：');
const app = nodes['app'] ? nodes['app'].innerHTML : '';
ok('app 容器有内容', app.length > 100, 'len=' + app.length);
ok('出现「选择账单文件」上传区', app.includes('选择账单文件'));
ok('出现 zip 解压说明', app.includes('解压密码'));
ok('出现微信导出教程', app.includes('下载账单'));
ok('出现支付宝导出教程', app.includes('开具交易流水证明'));
ok('accept 同时写了 MIME 类型', app.includes('text/csv') && app.includes('application/zip') && app.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
ok('accept 同时写了扩展名', app.includes('.xlsx') && app.includes('.zip') && app.includes('.csv'));
ok('有 iOS 找文件帮助区', app.includes('iPhone 上找不到文件'));
ok('包含 file input', app.includes('type="file"'));
ok('file input 阻止事件冒泡', app.includes('event.stopPropagation()'));
const tabs = nodes['tabs'] ? nodes['tabs'].innerHTML : '';
ok('渲染出 4 个 tab', (tabs.match(/<button/g) || []).length === 4, tabs.slice(0, 80));
const nav = nodes['nav'] ? nodes['nav'].innerHTML : '';
ok('渲染出 4 个底部导航', (nav.match(/<button/g) || []).length === 4);

console.log('\n切换视图不报错：');
['list', 'stats', 'set', 'import'].forEach(v => {
  try { ctx.go(v); ok('切到 ' + v, true); }
  catch (e) { ok('切到 ' + v, false, e.message); }
});

console.log('\n导入真实账单：');
const wx = ['微信支付账单明细', '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注',
  '2026-09-01 08:00:00,商户消费,瑞幸咖啡,拿铁,支出,¥19.90,零钱,支付成功,W001,M1,',
  '2026-09-03 18:00:00,商户消费,美团外卖,晚餐,支出,¥45.00,零钱,支付成功,W003,M3,'].join('\n');
try {
  const u8 = new TextEncoder().encode(wx);
  ctx.staging = { rows: [], files: 0, bad: [] };
  ctx.handleBill(u8, 'wechat.csv');
  ok('解析出 2 笔', ctx.staging.rows.length === 2, 'got ' + ctx.staging.rows.length);
  ctx.finishImport();
  ok('账目已入库', ctx.S.recs.length === 2, 'got ' + ctx.S.recs.length);
  ok('瑞幸归到餐饮美食', ctx.S.recs.some(r => r.cat === '餐饮美食'));
  ctx.go('list');
  const listHtml = nodes['app'].innerHTML;
  ok('明细页显示金额', listHtml.includes('19.90') || listHtml.includes('19.9'), listHtml.slice(0, 120));
  ctx.go('stats');
  ok('统计页渲染成功', nodes['app'].innerHTML.includes('概览'));
} catch (e) { ok('导入流程', false, e.message); }

console.log('\n文件类型过滤：');
ctx.staging = { rows: [], files: 0, bad: [] };
ctx.handleOne({ name: 'photo.jpg', arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
ok('拒绝 jpg 等非账单文件', ctx.staging.bad.length === 1 && ctx.staging.rows.length === 0, JSON.stringify(ctx.staging.bad));
ctx.staging = { rows: [], files: 0, bad: [] };
ctx.handleOne({ name: '账单.csv', arrayBuffer: () => Promise.resolve(new TextEncoder().encode('交易时间,x\n').buffer) });
ok('放行 csv', ctx.staging.bad.length === 0, JSON.stringify(ctx.staging.bad));

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
