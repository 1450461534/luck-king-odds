/**
 * luck-king-odds 核心算法 —— 「运气王预言家」
 *
 * 根据拼手气红包已抢到的金额，反推红包总额，并估算每个位置（包括你）
 * 最终成为运气王的概率。
 *
 * 约定：所有金额在内部一律使用「分」为单位做整数运算，避免浮点误差。
 *
 * 模型：微信拼手气红包的社区共识模型（二倍均值法，拆红包时实时随机生成）：
 *   - 剩余 r 人、剩余 R 分时，下一份金额近似均匀分布在 [0.01, 2R/r] 元内，取整到分；
 *   - 最后一人在现实中拿走全部剩余（take all）；
 *   - 保证每人至少 0.01 元（本实现以「上限 = min(2R/r, R-(r-1))」的整数均匀抽取近似）；
 *   - 金额并列时，先抢到的人获得「运气王」。
 */
(function (root) {
  'use strict';

  /** 常见「吉利」红包面额（元），用于可选的总额先验 */
  const LUCKY_AMOUNTS = [
    1, 2, 3, 5, 6, 8, 10, 18, 20, 28, 38, 50, 58, 66, 68, 88, 98, 100,
    128, 138, 158, 166, 168, 188, 200, 218, 268, 288, 300, 368, 388,
    400, 500, 518, 520, 588, 666, 688, 800, 888, 999, 1000, 1314,
    1688, 1888, 2000, 5200, 6666, 8888, 10000
  ];

  /**
   * 二倍均值法单次抽取（分，整数均匀）
   * @param {Function} rng  返回 [0,1) 随机数
   * @param {number} remain 剩余金额（分）
   * @param {number} size   剩余人数
   */
  function drawAmount(rng, remain, size) {
    if (size <= 1) return remain; // 最后一人拿走全部剩余
    let upper = Math.floor((2 * remain) / size);
    const safe = remain - (size - 1); // 保证后面每人至少 1 分
    if (upper > safe) upper = safe;
    if (upper < 1) upper = 1;
    return 1 + Math.floor(rng() * upper); // 均匀整数 [1, upper]
  }

  /**
   * 完整模拟一个红包。
   * @param {number} totalFen    总额（分）
   * @param {number[]} observedFen 已观测金额（分，按抢的先后顺序）
   * @param {number} totalPeople 红包总个数
   * @returns {{amounts: number[], lucky: number}} 全部金额与运气王位置（0-based）
   */
  function simulateOnce(totalFen, observedFen, totalPeople, rng) {
    const amounts = observedFen.slice();
    let remain = totalFen;
    for (let i = 0; i < observedFen.length; i++) remain -= observedFen[i];
    let size = totalPeople - observedFen.length;
    for (let pos = observedFen.length; pos < totalPeople; pos++) {
      const x = drawAmount(rng, remain, size);
      amounts.push(x);
      remain -= x;
      size--;
    }
    let max = -1, lucky = -1;
    for (let i = 0; i < totalPeople; i++) {
      if (amounts[i] > max) { max = amounts[i]; lucky = i; }
    }
    return { amounts, lucky };
  }

  /**
   * 观测的似然 L(M) = Π 1/upper_i（每个观测在第 i 轮的抽取区间宽度的倒数）。
   * 观测金额超出该轮可行上界 → 返回 0（总额 M 不可能）。
   */
  function likelihood(totalFen, observedFen, totalPeople) {
    let sum = 0, L = 1;
    for (let i = 0; i < observedFen.length; i++) {
      const remain = totalFen - sum;
      const size = totalPeople - i;
      if (remain < size) return 0; // 剩余不够每人 1 分
      let upper = Math.floor((2 * remain) / size);
      const safe = remain - (size - 1);
      if (upper > safe) upper = safe;
      if (observedFen[i] < 1 || observedFen[i] > upper) return 0;
      L /= upper;
      sum += observedFen[i];
    }
    return L;
  }

  /**
   * 由观测反解的总额下界（分）：
   * 第 i 个（0-based）抢的人满足 x_i ≤ 2(M - S_{i-1}) / (n - i)
   * → M ≥ S_{i-1} + x_i (n - i) / 2；再加上「剩余每人至少 1 分」。
   */
  function lowerBoundFen(observedFen, totalPeople) {
    let sum = 0, lb = 0;
    for (let i = 0; i < observedFen.length; i++) {
      const v = sum + (observedFen[i] * (totalPeople - i)) / 2;
      if (v > lb) lb = v;
      sum += observedFen[i];
    }
    const need = sum + (totalPeople - observedFen.length);
    return Math.max(lb, need);
  }

  /**
   * 构建候选总额集合。
   * @param {string} mode 'int' 任意整数元 | 'lucky' 常见吉利面额 | 'custom' 自定义
   * @param {object} opts { limitYuan, customYuan }
   */
  function buildCandidates(observedFen, totalPeople, mode, opts) {
    opts = opts || {};
    const lbYuan = Math.ceil(lowerBoundFen(observedFen, totalPeople) / 100);
    const limitYuan = opts.limitYuan || 200;
    let pool = [];
    if (mode === 'lucky') {
      pool = LUCKY_AMOUNTS.filter(y => y >= lbYuan && y <= limitYuan);
    } else if (mode === 'custom') {
      pool = (opts.customYuan || []).filter(y => y >= lbYuan && y <= limitYuan);
    } else {
      for (let y = lbYuan; y <= limitYuan; y++) pool.push(y);
    }
    const out = [];
    for (const y of pool) {
      const L = likelihood(y * 100, observedFen, totalPeople);
      if (L > 0) out.push({ yuan: y, totalFen: y * 100, L: L });
    }
    return { candidates: out, lowerBoundYuan: lbYuan };
  }

  /** 已排序数组的分位数 */
  function quantile(sorted, q) {
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  /**
   * 主入口。
   * @param {number[]} observedYuan 已抢金额（元，按抢的先后顺序）
   * @param {number} totalPeople    红包总个数
   * @param {object} opts
   *   mode:      'int' | 'lucky' | 'custom'（默认 'int'）
   *   limitYuan: 整数元模式下的总额上限（默认 200）
   *   customYuan: 自定义候选总额列表（元）
   *   samples:   每候选基准模拟次数（默认 30000）
   *   mePos:     我是第几个抢的（1-based）；0 / 省略 = 还没抢，将作为下一个抢的人被模拟
   *   rng:       随机数发生器（默认 Math.random）
   */
  function predict(observedYuan, totalPeople, opts) {
    opts = opts || {};
    const mode = opts.mode || 'int';
    const samples = opts.samples || 30000;
    const rng = opts.rng || Math.random;
    const observedFen = observedYuan.map(v => Math.round(v * 100));
    const k = observedFen.length;
    const restPeople = totalPeople - k;
    const mePos = opts.mePos >= 1 ? opts.mePos : 0;   // 1-based；0 = 还没抢
    const meIdx = mePos >= 1 ? mePos - 1 : k;          // 我的 0-based 位置

    if (k < 1) return { ok: false, reason: 'need-observation' };
    if (totalPeople < k || totalPeople < 2) return { ok: false, reason: 'bad-n' };

    const built = buildCandidates(observedFen, totalPeople, mode, opts);
    const lowerBoundYuan = built.lowerBoundYuan;
    if (!built.candidates.length) {
      return { ok: false, reason: 'no-candidate', lowerBoundYuan: lowerBoundYuan };
    }

    // 似然排序，截断长尾（Top 120 已覆盖绝大部分后验质量）
    built.candidates.sort((a, b) => b.L - a.L);
    const capped = built.candidates.slice(0, 120);

    let Z = 0;
    for (const c of capped) Z += c.L;
    for (const c of capped) c.p = c.L / Z;

    const posProb = new Array(totalPeople).fill(0);
    const meAmountFen = [];
    let finalLucky = null;

    if (restPeople === 0) {
      // 红包已被抢完：运气王确定，无需模拟
      const res = simulateOnce(capped[0].totalFen, observedFen, totalPeople, rng);
      posProb[res.lucky] = 1;
      finalLucky = res.lucky;
    } else {
      for (const c of capped) {
        const times = Math.max(200, Math.round(samples * c.p));
        const luckyCount = new Array(totalPeople).fill(0);
        for (let t = 0; t < times; t++) {
          const res = simulateOnce(c.totalFen, observedFen, totalPeople, rng);
          luckyCount[res.lucky]++;
          if (mePos < 1) meAmountFen.push(res.amounts[meIdx]); // 我下一个抢的金额样本
        }
        for (let p = 0; p < totalPeople; p++) {
          posProb[p] += (luckyCount[p] / times) * c.p;
        }
        c.pLuckyMe = luckyCount[meIdx] / times;
      }
      meAmountFen.sort((a, b) => a - b);
    }

    // 总额后验分位（元）
    let acc = 0, q10 = null, q50 = null, q90 = null;
    for (const c of capped) {
      acc += c.p;
      if (q10 === null && acc >= 0.10) q10 = c.yuan;
      if (q50 === null && acc >= 0.50) q50 = c.yuan;
      if (q90 === null && acc >= 0.90) q90 = c.yuan;
    }

    return {
      ok: true,
      meIdx: meIdx,
      isFinished: restPeople === 0,
      finalLuckyIdx: finalLucky,
      pLuckyMe: posProb[meIdx] || 0,
      meAmount: {
        fixedYuan: opts.mePos >= 1 ? observedYuan[opts.mePos - 1] : null,
        q10: quantile(meAmountFen, 0.10),
        q50: quantile(meAmountFen, 0.50),
        q90: quantile(meAmountFen, 0.90)
      },
      total: { q10: q10, q50: q50, q90: q90, lowerBoundYuan: lowerBoundYuan },
      candidates: capped
        .map(c => ({ yuan: c.yuan, p: c.p, pLuckyMe: c.pLuckyMe === undefined ? null : c.pLuckyMe }))
        .sort((a, b) => b.p - a.p),
      posProb: posProb
    };
  }

  const api = {
    LUCKY_AMOUNTS: LUCKY_AMOUNTS,
    drawAmount: drawAmount,
    simulateOnce: simulateOnce,
    likelihood: likelihood,
    lowerBoundFen: lowerBoundFen,
    buildCandidates: buildCandidates,
    quantile: quantile,
    predict: predict
  };

  root.LuckKing = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
