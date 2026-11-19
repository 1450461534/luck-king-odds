/**
 * 算法自校验：node test.mjs
 */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const LK = require('./luck.js');

// T1 观测反解总额下界：10 人包，前 3 人抢到 2.33 / 1.05 / 4.20
// 第 3 人约束最强：他抢时场上已抢走 3.38 元、还剩 8 人，
// 4.20 ≤ 2(M − 3.38)/8 → M ≥ 338 + 420 × 8 / 2 = 2018 分 → 整数元至少 21 元
assert.equal(LK.lowerBoundFen([233, 105, 420], 10), 2018);
assert.equal(Math.ceil(LK.lowerBoundFen([233, 105, 420], 10) / 100), 21);

// T2 似然可行性：20 元总额下第 3 人的 4.20 超出可行上界 → 排除；20.18 元恰好压线可行
assert.equal(LK.likelihood(2000, [233, 105, 420], 10), 0);
assert.ok(LK.likelihood(2018, [233, 105, 420], 10) > 0);

// T3 二倍均值法性质：每次模拟总和恒等于总额；后抢者更容易运气王
{
  const n = 10, M = 10000; // 100 元
  for (let t = 0; t < 2000; t++) {
    const { amounts } = LK.simulateOnce(M, [], n, Math.random);
    assert.equal(amounts.reduce((a, b) => a + b, 0), M, '总和必须等于总额');
    assert.ok(amounts.every(v => v >= 1), '每人至少 1 分');
  }
  const counts = new Array(n).fill(0);
  const N = 20000;
  for (let t = 0; t < N; t++) counts[LK.simulateOnce(M, [], n, Math.random).lucky]++;
  console.log(`[T3] 各位置运气王概率: ${counts.map(c => ((c / N) * 100).toFixed(1) + '%').join(' ')}`);
  // 实测呈「U 型 + 尾部抬升」：首位 ~10%，中段低谷 ~8.6%，末位 ~12%
  assert.ok(counts[9] > counts[0], '末位运气王概率应高于首位');
  assert.ok(counts[9] > counts[4], '末位运气王概率应高于中段低谷');
}

// T4 极端小额保底：30 分 / 10 人 → 每人 1~6 分，总和恰为 30
{
  for (let t = 0; t < 2000; t++) {
    const { amounts } = LK.simulateOnce(30, [], 10, Math.random);
    assert.equal(amounts.reduce((a, b) => a + b, 0), 30);
    assert.ok(amounts.every(v => v >= 1));
  }
}

// T5 端到端：还没抢（场景 A）
{
  const r = LK.predict([2.33, 1.05, 4.20], 10, { mode: 'int', limitYuan: 200, samples: 20000 });
  assert.equal(r.ok, true);
  assert.ok(r.pLuckyMe > 0 && r.pLuckyMe < 1, '运气王概率应在 (0,1)');
  assert.ok(r.candidates.length > 0);
  const psum = r.candidates.reduce((a, c) => a + c.p, 0);
  assert.ok(Math.abs(psum - 1) < 1e-9, '候选总额后验应归一');
  assert.ok(r.total.q50 >= r.total.lowerBoundYuan);
  assert.ok(r.meAmount.q50 > 0);
}

// T6 已抢完场景：运气王确定
{
  const obs = [2.33, 1.05, 4.20, 8.88, 1.00, 3.33, 2.50, 0.99, 1.11, 3.61];
  const r = LK.predict(obs, 10, { mode: 'int' });
  assert.equal(r.ok, true);
  assert.equal(r.isFinished, true);
  assert.equal(r.finalLuckyIdx, 3, '8.88 唯一最大 → 位置 4（0-based 3）');
  assert.equal(r.posProb[3], 1);
}

// T7 我已抢（场景 B）：我是第 2 个抢的（1.05），看最终运气王概率
{
  const r = LK.predict([2.33, 1.05, 4.20], 10, { mode: 'int', samples: 20000, mePos: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.meIdx, 1);
  assert.ok(r.pLuckyMe >= 0 && r.pLuckyMe <= 1);
  assert.equal(r.meAmount.fixedYuan, 1.05);
}

// ---------------------------------------------------------------------------
// T8-T10 截图解析器（ocr.js）—— 样例取自真实微信红包截图（PC / 安卓）
// ---------------------------------------------------------------------------
const LKOCR = require('./ocr.js');

// T8 已抢完（PC，1 元 10 包：虚构昵称，第 1 个抢的人手气最佳 0.19）
const SAMPLE_FINISHED = `
麻辣爱上烫串串香 发出的红包
免单来喽
0.19 元
已存入零钱
10个红包， 30分钟被抢光
玫瑰A
11月19日 10:00
0.06元
11月19日 9:55
0.02元
友B
11月19日 9:49
0.13元
友C
11月19日 9:44
0.04元
11月19日 9:31
0.13元
11月19日 9:30
0.16元
友D
11月19日 9:29
0.01元
友E
11月19日 9:29
0.11元
11月19日 9:29
0.15元
小甲
11月19日 9:29
0.19元
手气最佳
`;
{
  const p = LKOCR.parseReceiptText(SAMPLE_FINISHED);
  assert.equal(p.finished, true, '应判定为已抢完');
  assert.equal(p.totalPeople, 10);
  assert.equal(p.records.length, 10, '顶部大金额应被剔除，只留 10 条记录');
  const sum = p.records.reduce((a, r) => a + r.amount, 0);
  assert.equal(sum, 100, '10 条记录总和应为 1 元 = 100 分');
  assert.equal(p.records[0].amount, 19, '反转后第一条应为小甲的 0.19（最早抢）');
  assert.equal(p.records[0].lucky, true, '手气最佳应归属小甲');
  assert.equal(p.luckyIdx, 0);
  assert.equal(p.myTopAmount, 19, '顶部金额应为 0.19');
  assert.equal(p.meIdxGuess, 0, '顶部金额唯一匹配 → 推断「小甲是我」');
  // 与算法层串联：已抢完 → 直接判定运气王
  const r = LK.predict(p.records.map(x => x.amount / 100), 10, { mePos: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.isFinished, true);
  assert.equal(r.finalLuckyIdx, 0);
}

// T9 进行中（安卓，已领取 3/10）——注意微信列表是「最新在最上」
const SAMPLE_ONGOING = `
麻辣爱上烫串串香 的红包
免单来喽
已领取 3/10个
0.06元
11月19日 10:00
0.02元
11月19日 9:55
0.13元
11月19日 9:49
`;
{
  const p = LKOCR.parseReceiptText(SAMPLE_ONGOING);
  assert.equal(p.finished, null);
  assert.equal(p.totalPeople, 10);
  assert.equal(p.claimed, 3);
  assert.equal(p.records.length, 3);
  assert.equal(p.records[0].amount, 13, '反转后第一条应为 0.13（9:49 最早抢）');
  assert.equal(p.records[2].amount, 6, '最后一条应为 0.06（10:00 最新抢）');
  assert.equal(p.myTopAmount, null);
  // 与算法层串联：进行中 → 预测下一个抢的人
  const r = LK.predict(p.records.map(x => x.amount / 100), 10, { samples: 5000 });
  assert.equal(r.ok, true);
  assert.equal(r.isFinished, false);
  assert.ok(r.pLuckyMe > 0 && r.pLuckyMe < 1);
}

// T10 顶部金额与「已存入」同行 + 手气最佳独立行 + 小额面额
{
  const p = LKOCR.parseReceiptText('0.19元 已存入零钱\n10个红包\n0.06元\n0.19元\n手气最佳\n0.75元');
  assert.equal(p.myTopAmount, 19, '同行格式的顶部金额应被识别');
  assert.equal(p.records.length, 3, '顶部金额不应混入列表');
  assert.equal(p.luckyIdx, 1, '列表中的 0.19 应被标记为手气最佳');
  assert.ok(LK.LUCKY_AMOUNTS.includes(1) && LK.LUCKY_AMOUNTS.includes(3), '小额面额 1/3 应存在');
}

console.log('✅ 全部测试通过');
