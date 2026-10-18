const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const m = html.match(/<script id="core">([\s\S]*?)<\/script>/);
if (!m) { console.error('未找到 core script'); process.exit(1); }

const ctx = { console, TextDecoder, TextEncoder, Date, Math, JSON, parseFloat, isNaN, String, Number, Object, Array };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(m[1], ctx);
const C = { classify: ctx.classify, parseBillText: ctx.parseBillText, decodeBytes: ctx.decodeBytes, countable: ctx.countable, money: ctx.money };

let pass = 0, fail = 0;
function eq(name, got, want) {
  if (got === want) { pass++; console.log('  ok   ' + name + ' = ' + got); }
  else { fail++; console.log('  FAIL ' + name + ' => got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}

// ---------- 支付宝（GBK） ----------
const aliCSV = [
  '支付宝交易明细',
  '账号:138****8888',
  '起始日期:2026-09-01 终止日期:2026-09-30',
  '---------------------------------',
  '交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注',
  '2026-09-01 12:30:15,餐饮美食,肯德基,kfc@x.com,汉堡套餐,支出,38.50,余额宝,交易成功,A001,B001,',
  '2026-09-02 08:15:00,交通出行,滴滴出行,,快车行程,支出,26.00,花呗,交易成功,A002,,',
  '2026-09-03 19:00:00,转账红包,张三,,转账,支出,200.00,余额,交易成功,A003,,',
  '2026-09-05 09:00:00,,余额宝,,转入,不计收支,1000.00,余额,交易成功,A005,,',
  '2026-09-10 10:00:00,,淘宝,,退款,收入,99.00,余额,退款成功,A010,,',
  '2026-09-11 10:00:00,,中国移动,,话费充值,支出,50.00,余额,交易成功,A011,,',
].join('\r\n');

const gbkBuf = new TextEncoder().encode(aliCSV); // 先 UTF-8 试 decodeBytes 是否正确识别
const aliText = C.decodeBytes(gbkBuf);
const ali = C.parseBillText(aliText, null, 'alipay.csv');

console.log('支付宝解析：');
eq('条数', ali.rows.length, 6);
eq('来源识别', ali.src, 'alipay');
eq('肯德基金额', ali.rows[0].amt, 38.5);
eq('肯德基方向', ali.rows[0].dir, 'expense');
eq('肯德基分类', C.classify(ali.rows[0]), '餐饮美食');
eq('滴滴分类', C.classify(ali.rows[1]), '交通出行');
eq('转账分类', C.classify(ali.rows[2]), '人情往来');
eq('余额宝转入方向', ali.rows[3].dir, 'neutral');
eq('退款分类', C.classify(ali.rows[4]), '退款返还');
eq('话费分类', C.classify(ali.rows[5]), '通讯充值');
eq('中性不计入统计', C.countable(ali.rows[3], { hideInvalid: true, hideRefund: true, hideTransfer: false, hideNeutral: true }), false);
eq('正常支出计入统计', C.countable(ali.rows[0], { hideInvalid: true, hideRefund: true, hideTransfer: false, hideNeutral: true }), true);

// ---------- 微信（UTF-8） ----------
const wxCSV = [
  '微信支付账单明细',
  '------------------------------------',
  '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注',
  '2026-09-01 08:00:00,商户消费,瑞幸咖啡,拿铁,支出,¥19.90,招商银行(1234),支付成功,W001,M1,',
  '2026-09-02 12:00:00,转账,李四,,支出,¥50.00,零钱,已存入零钱,W002,,',
  '2026-09-03 18:00:00,商户消费,美团外卖,晚餐,支出,¥45.00,零钱,已全额退款,W003,M3,',
  '2026-09-04 09:00:00,零钱提现,/,,/,¥500.00,零钱,提现成功,W004,,',
  '2026-09-05 10:00:00,商户消费,山姆会员店,日用品,支出,¥328.00,工商银行(5678),支付成功,W005,M5,',
  '2026-09-06 10:00:00,商户消费,顺丰速运,快递费,支出,¥18.00,零钱,支付成功,W006,M6,',
].join('\n');

const wx = C.parseBillText(wxCSV, null, 'wechat.csv');
console.log('微信解析：');
eq('条数', wx.rows.length, 6);
eq('来源识别', wx.src, 'wechat');
eq('带¥金额解析', wx.rows[0].amt, 19.9);
eq('瑞幸分类', C.classify(wx.rows[0]), '餐饮美食');
eq('提现判定为中性', wx.rows[3].dir, 'neutral');
eq('提现不计入统计', C.countable(wx.rows[3], { hideInvalid: true, hideRefund: true, hideTransfer: false, hideNeutral: true }), false);
eq('山姆分类', C.classify(wx.rows[4]), '购物消费');
eq('顺丰分类', C.classify(wx.rows[5]), '生活服务');
const opt = { hideInvalid: true, hideRefund: true, hideTransfer: false, hideNeutral: true };
eq('已退款支出被排除', C.countable(wx.rows[2], opt), false);
eq('转账在默认口径下保留', C.countable(wx.rows[1], opt), true);
eq('转账在排除转账口径下剔除', C.countable(wx.rows[1], Object.assign({}, opt, { hideTransfer: true })), false);

// ---------- 去重 ----------
const again = C.parseBillText(wxCSV, null, 'wechat.csv');
eq('重复导入 id 一致', again.rows[0].id, wx.rows[0].id);

// ---------- 其他分类断言 ----------
console.log('分类库抽样：');
function cl(cp, prod, dir) { return C.classify({ cp, prod, dir: dir || 'expense', src: 'wechat', type: '商户消费', status: '支付成功', remark: '', cat: '' }); }
eq('星巴克', cl('星巴克', ''), '餐饮美食');
eq('高德打车', cl('高德打车', ''), '交通出行');
eq('优衣库', cl('优衣库', ''), '购物消费');
eq('物业费', cl('小区物业', '物业费'), '居住物业');
eq('老百姓大药房', cl('老百姓大药房', ''), '医疗健康');
eq('万达影城', cl('万达影城', ''), '文娱休闲');
eq('中石化加油', cl('中石化加油站', ''), '交通出行');
eq('信用卡还款', cl('', '信用卡还款'), '金融保险');
eq('未知商户兜底', cl('某某奇怪商户X', ''), '其他支出');

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
