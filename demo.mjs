/**
 * 命令行示例：node demo.mjs
 *
 * 场景：群里发了个 10 人的红包，已经有 3 个人抢了（2.33 / 1.05 / 4.20 元），我还没抢。
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const LK = require('./luck.js');

const r = LK.predict([2.33, 1.05, 4.20], 10, {
  mode: 'int', limitYuan: 200, samples: 50000
});

console.log('场景：10 人红包，已抢 3 人（2.33 / 1.05 / 4.20），我还没抢');
console.log('----------------------------------------------------------');
console.log(`总额：下界 ${r.total.lowerBoundYuan} 元，中位 ≈ ${r.total.q50} 元（80% 区间 ${r.total.q10}–${r.total.q90} 元）`);
console.log(`我下一个抢 → 运气王概率 ${(r.pLuckyMe * 100).toFixed(1)}%`);
console.log(`预计我能抢到 ≈ ${(r.meAmount.q50 / 100).toFixed(2)} 元（80% 区间 ${(r.meAmount.q10 / 100).toFixed(2)}–${(r.meAmount.q90 / 100).toFixed(2)}）`);
console.log('----------------------------------------------------------');
console.log('总额后验 Top 5：');
for (const c of r.candidates.slice(0, 5)) {
  console.log(`  ${String(c.yuan).padEnd(4)} 元  P=${(c.p * 100).toFixed(1).padStart(5)}%  此总额下我运气王概率=${(c.pLuckyMe * 100).toFixed(1)}%`);
}
console.log('----------------------------------------------------------');
console.log('各位置运气王概率：');
r.posProb.forEach((p, i) => {
  const tag = i === r.meIdx ? ' ← 你（下一个抢）' : '';
  console.log(`  第 ${String(i + 1).padStart(2)} 个抢: ${(p * 100).toFixed(1).padStart(5)}%${tag}`);
});
