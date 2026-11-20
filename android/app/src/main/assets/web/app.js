/**
 * app.js —— 「运气王预言家」网页 v2
 *
 * 交互流：上传/粘贴截图 → 本地 OCR → 补全式确认页 → 计算 → 结果
 * 历史：预测 VS 实际（localStorage，红包抢完后再次上传截图自动配对回填）
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const yuan = fen => (fen / 100).toFixed(2);

  // ---------------------------------------------------------------------------
  // 视图切换
  // ---------------------------------------------------------------------------
  const VIEWS = ['upload', 'confirm', 'result', 'history'];
  function showView(name) {
    VIEWS.forEach(v => { $('view-' + v).hidden = v !== name; });
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------------------
  // 历史（localStorage）：预测 VS 实际
  // ---------------------------------------------------------------------------
  const HKEY = 'lko_history_v1';
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HKEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveHistory(h) { localStorage.setItem(HKEY, JSON.stringify(h)); }

  /**
   * 红包抢完后：尝试把实际结果回填到预测记录上。
   * 匹配条件：总个数相同 + 预测时观测的金额集合（多重集）被实际记录包含
   * （两张截图缺的行往往不同，按顺序前缀匹配会误判，所以用多重集包含）
   */
  function tryPairActual(records, n, luckyIdx) {
    const hist = loadHistory();
    const amounts = records.map(r => r.amount);
    let best = null;
    for (const rec of hist) {
      if (rec.type !== 'prediction' || rec.actual) continue;
      if (rec.totalPeople !== n) continue;
      const need = new Map();
      rec.observed.forEach(a => need.set(a, (need.get(a) || 0) + 1));
      for (const a of amounts) {
        if (need.has(a)) {
          const c = need.get(a);
          if (c <= 1) need.delete(a); else need.set(a, c - 1);
        }
      }
      if (need.size === 0 && (!best || rec.ts > best.ts)) best = rec;
    }
    if (best) {
      best.type = 'paired';
      best.actual = { luckyIdx: luckyIdx, amounts: amounts };
      best.pairedTs = Date.now();
      saveHistory(hist);
      return best;
    }
    return null;
  }

  function fmtTs(ts) {
    const d = new Date(ts);
    const now = new Date();
    const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    if (d.toDateString() === now.toDateString()) return hm;
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
  }

  // ---------------------------------------------------------------------------
  // 状态
  // ---------------------------------------------------------------------------
  let state = { parsed: null, records: [], meIdxTmp: null, lastResult: null };

  // ---------------------------------------------------------------------------
  // 示例数据（虚构昵称，金额分布取自真实红包：1 元 / 10 个包）
  // ---------------------------------------------------------------------------
  const SAMPLES = {
    finished: {
      finished: true, totalPeople: 10, claimed: null,
      records: [
        { amount: 19, name: '小甲', lucky: true },
        { amount: 15, name: '小乙', lucky: false },
        { amount: 11, name: '小丙', lucky: false },
        { amount: 1,  name: '小丁', lucky: false },
        { amount: 16, name: '小戊', lucky: false },
        { amount: 13, name: '小己', lucky: false },
        { amount: 4,  name: '小庚', lucky: false },
        { amount: 13, name: '小辛', lucky: false },
        { amount: 2,  name: '小壬', lucky: false },
        { amount: 6,  name: '小癸', lucky: false }
      ],
      luckyIdx: 0, meIdxGuess: 0, myTopAmount: 19, warnings: []
    },
    ongoing: {
      finished: null, totalPeople: 10, claimed: 3,
      records: [
        { amount: 13, name: '', lucky: false },
        { amount: 2,  name: '', lucky: false },
        { amount: 6,  name: '', lucky: false }
      ],
      luckyIdx: null, meIdxGuess: null, myTopAmount: null, warnings: []
    }
  };

  // ---------------------------------------------------------------------------
  // 确认页：记录行渲染（DOM 构建，OCR 文本一律 textContent 防注入）
  // ---------------------------------------------------------------------------
  function renderRows() {
    const list = $('recList');
    list.innerHTML = '';
    state.records.forEach((rec, i) => {
      const row = document.createElement('div');
      row.className = 'rec-row' + (state.meIdxTmp === i ? ' me-row' : '');

      const idx = document.createElement('span');
      idx.className = 'idx'; idx.textContent = '#' + (i + 1);

      const amt = document.createElement('input');
      amt.className = 'amt'; amt.type = 'number'; amt.step = '0.01'; amt.min = '0.01';
      amt.placeholder = '金额';
      if (rec.amount !== null && rec.amount !== undefined) amt.value = yuan(rec.amount);

      const nm = document.createElement('span');
      nm.className = 'nm'; nm.textContent = rec.name || '';

      const lt = document.createElement('span');
      lt.className = 'luckytag'; lt.textContent = rec.lucky ? '👑' : '';

      const me = document.createElement('label');
      me.className = 'me';
      const radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'meRow';
      radio.checked = state.meIdxTmp === i;
      radio.addEventListener('change', () => {
        state.meIdxTmp = radio.checked ? i : null;
        renderRows();
      });
      me.appendChild(radio);
      me.appendChild(document.createTextNode('我'));

      const ins = document.createElement('button');
      ins.className = 'mini'; ins.textContent = '＋'; ins.title = '在这行下方插入一条';
      ins.addEventListener('click', () => {
        state.records.splice(i + 1, 0, { amount: null, name: '', lucky: false });
        renderRows();
      });

      const del = document.createElement('button');
      del.className = 'mini'; del.textContent = '✕'; del.title = '删除这条';
      del.addEventListener('click', () => {
        if (state.meIdxTmp === i) state.meIdxTmp = null;
        else if (state.meIdxTmp !== null && state.meIdxTmp > i) state.meIdxTmp--;
        state.records.splice(i, 1);
        renderRows();
      });

      row.appendChild(idx);
      row.appendChild(amt);
      row.appendChild(nm);
      row.appendChild(lt);
      row.appendChild(me);
      row.appendChild(ins);
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  function renderConfirm(parsed) {
    state.parsed = parsed;
    state.records = parsed.records.map(r => ({ amount: r.amount, name: r.name || '', lucky: !!r.lucky }));
    state.meIdxTmp = parsed.meIdxGuess !== null && parsed.meIdxGuess !== undefined ? parsed.meIdxGuess : null;

    const badge = $('statusBadge');
    badge.hidden = false;
    if (parsed.finished === true) { badge.className = 'badge done'; badge.textContent = '🧧 已抢完'; }
    else if (parsed.finished === false || parsed.claimed !== null) {
      badge.className = 'badge live';
      badge.textContent = '⏳ 进行中' + (parsed.claimed !== null ? ' · 已领取 ' + parsed.claimed + '/' + (parsed.totalPeople || '?') : '');
    } else { badge.className = 'badge live'; badge.textContent = '⏳ 进行中'; }

    const wb = $('warnBadge');
    if (parsed.warnings && parsed.warnings.length) {
      wb.hidden = false;
      wb.textContent = '⚠ ' + parsed.warnings[0];
      wb.title = parsed.warnings.join('\n');
    } else wb.hidden = true;

    $('totalN').value = parsed.totalPeople !== null && parsed.totalPeople !== undefined ? parsed.totalPeople : '';
    $('finChk').checked = parsed.finished === true;
    renderRows();
    $('confirmErr').textContent = '';
    showView('confirm');
  }

  // ---------------------------------------------------------------------------
  // OCR 入口
  // ---------------------------------------------------------------------------
  function setProgress(text, p) {
    $('progWrap').classList.remove('hidden');
    $('progText').textContent = text;
    $('progBar').style.width = Math.round((p || 0) * 100) + '%';
  }

  async function handleFile(file) {
    if (!file) return;
    $('uploadErr').textContent = '';
    $('skipOcr').classList.add('hidden');
    try {
      setProgress('准备识别…', 0.05);
      const { parsed } = await LKOCR.recognizeImageFile(file, setProgress);
      $('progWrap').classList.add('hidden');
      if (!parsed.records.length && parsed.totalPeople === null) {
        $('progWrap').classList.remove('hidden');
        $('progText').textContent = '识别完成，但没认出有效内容';
        $('uploadErr').textContent = '请确认截图包含红包详情页（金额列表）';
        $('skipOcr').classList.remove('hidden');
        return;
      }
      renderConfirm(parsed);
    } catch (e) {
      $('progText').textContent = '识别失败';
      $('uploadErr').textContent = (e && e.message ? e.message : '未知错误') + '（需要联网加载识别模型；失败可手动补全）';
      $('skipOcr').classList.remove('hidden');
    }
  }

  /** 多张截图：逐张识别后合并（行序需人工核对，确认页可增删改） */
  async function handleFiles(fileList) {
    const list = Array.from(fileList || []).filter(f => f && f.type && f.type.indexOf('image') === 0);
    if (!list.length) return;
    if (list.length === 1) return handleFile(list[0]);
    $('uploadErr').textContent = '';
    $('skipOcr').classList.add('hidden');
    const all = [];
    try {
      for (let i = 0; i < list.length; i++) {
        setProgress(`识别第 ${i + 1}/${list.length} 张…`, i / list.length);
        const { parsed } = await LKOCR.recognizeImageFile(list[i], (s, p) =>
          setProgress(`识别第 ${i + 1}/${list.length} 张 · ${s}`, (i + p) / list.length));
        all.push(parsed);
      }
      $('progWrap').classList.add('hidden');
      renderConfirm(mergeParsed(all));
    } catch (e) {
      $('progText').textContent = '识别失败';
      $('uploadErr').textContent = (e && e.message ? e.message : '未知错误') + '（失败可手动补全）';
      $('skipOcr').classList.remove('hidden');
    }
  }

  /** 合并多张截图的解析结果：记录拼接 + 总个数取最大 + 提示人工核对 */
  function mergeParsed(list) {
    const records = [];
    let finished = null, totalPeople = null, claimed = null;
    let luckyIdx = null, meIdxGuess = null, myTopAmount = null;
    for (const p of list) {
      records.push(...p.records);
      if (p.totalPeople !== null && (totalPeople === null || p.totalPeople > totalPeople)) totalPeople = p.totalPeople;
      if (p.claimed !== null && (claimed === null || p.claimed > claimed)) claimed = p.claimed;
      if (p.finished === true) finished = true;
      if (p.myTopAmount !== null && meIdxGuess === null) {
        myTopAmount = p.myTopAmount;
        meIdxGuess = p.meIdxGuess;
      }
      if (p.luckyIdx !== null && luckyIdx === null) luckyIdx = p.luckyIdx;
    }
    return {
      finished: finished,
      totalPeople: totalPeople,
      claimed: claimed,
      records: records,
      luckyIdx: luckyIdx,
      meIdxGuess: meIdxGuess,
      myTopAmount: myTopAmount,
      warnings: ['多张截图已合并：请核对每行金额与顺序，重复的行直接删除']
    };
  }

  // ---------------------------------------------------------------------------
  // 计算 + 结果渲染
  // ---------------------------------------------------------------------------
  function collectRecords() {
    const rows = $('recList').querySelectorAll('.rec-row');
    const out = [];
    rows.forEach(row => {
      const v = parseFloat(row.querySelector('.amt').value);
      out.push({
        amount: isFinite(v) ? Math.round(v * 100) : NaN,
        name: row.querySelector('.nm').textContent,
        lucky: !!row.querySelector('.luckytag').textContent
      });
    });
    return out;
  }

  function onCalc() {
    const errEl = $('confirmErr');
    errEl.textContent = '';
    const records = collectRecords();
    const n = parseInt($('totalN').value, 10);

    if (!records.length) { errEl.textContent = '请至少保留一条领取记录'; return; }
    const badIdx = records.findIndex(r => !isFinite(r.amount) || r.amount < 1);
    if (badIdx >= 0) { errEl.textContent = '第 ' + (badIdx + 1) + ' 行金额无效'; return; }
    if (!(n >= 2)) { errEl.textContent = '请填写红包总个数（≥2）'; return; }
    if (records.length > n) { errEl.textContent = '领取记录数（' + records.length + '）不能超过红包总个数（' + n + '）'; return; }

    const meIdx = state.meIdxTmp !== null && state.meIdxTmp < records.length ? state.meIdxTmp : null;
    const finished = $('finChk').checked || records.length === n;
    let luckyIdx = records.findIndex(r => r.lucky);
    if (luckyIdx < 0 && finished) {
      // 无 OCR 标记时用金额最大（并列取先抢者）兜底
      let mx = -1; records.forEach((r, i) => { if (r.amount > mx) { mx = r.amount; luckyIdx = i; } });
    }

    const opts = {
      mode: document.querySelector('input[name=prior]:checked').value,
      limitYuan: parseInt($('limit').value, 10) || 200,
      samples: parseInt($('samples').value, 10),
      mePos: meIdx !== null ? meIdx + 1 : 0,
      customYuan: undefined
    };
    if (opts.mode === 'custom') {
      opts.customYuan = $('custom').value.split(/[\s,，、]+/).filter(Boolean).map(Number).filter(v => isFinite(v) && v > 0);
      if (!opts.customYuan.length) { errEl.textContent = '自定义模式请填写候选总额'; return; }
    }

    const btn = $('calc');
    btn.disabled = true; btn.textContent = '计算中…';
    setTimeout(() => {
      btn.disabled = false; btn.textContent = '🔮 计算';
      if (finished) {
        // 已抢完：直接判定（运气王 = 最大金额，同金额先抢者得），无需蒙特卡洛
        const sum = records.reduce((a, r) => a + r.amount, 0);
        const result = {
          ok: true,
          meIdx: meIdx !== null ? meIdx : records.length,
          isFinished: true,
          finalLuckyIdx: luckyIdx,
          pLuckyMe: meIdx !== null ? (meIdx === luckyIdx ? 1 : 0) : 0,
          meAmount: { fixedYuan: meIdx !== null ? records[meIdx].amount / 100 : null, q10: null, q50: null, q90: null },
          total: { q10: Math.ceil(sum / 100), q50: Math.ceil(sum / 100), q90: Math.ceil(sum / 100), lowerBoundYuan: Math.ceil(sum / 100) },
          candidates: [],
          posProb: records.map((r, i) => (i === luckyIdx ? 1 : 0))
        };
        finishAndRender(result, { records: records, n: n, meIdx: meIdx, finished: finished, luckyIdx: luckyIdx });
        return;
      }
      let result;
      try { result = LuckKing.predict(records.map(r => r.amount / 100), n, opts); }
      catch (e) { errEl.textContent = '计算失败：' + e.message; return; }
      if (!result.ok) {
        errEl.textContent = result.reason === 'no-candidate'
          ? '观测金额要求总额 ≥ 约 ' + result.lowerBoundYuan + ' 元：请调大「金额上限」或换先验'
          : '计算失败';
        return;
      }
      finishAndRender(result, { records: records, n: n, meIdx: meIdx, finished: finished, luckyIdx: luckyIdx });
    }, 30);
  }

  function finishAndRender(result, ctx) {
    state.lastResult = { result: result, ctx: ctx };
    let pairedRec = null;
    const newId = Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    if (ctx.finished) {
      // 实际结果：优先自动回填匹配的预测记录，否则存一条「仅实际」
      pairedRec = tryPairActual(ctx.records, ctx.n, ctx.luckyIdx);
      if (!pairedRec) {
        const hist = loadHistory();
        hist.push({
          id: newId, ts: Date.now(), type: 'actual',
          totalPeople: ctx.n,
          amounts: ctx.records.map(r => r.amount),
          luckyIdx: ctx.luckyIdx,
          meIdx: ctx.meIdx
        });
        saveHistory(hist);
      }
    } else {
      // 预测存档：等红包抢完后再传最终截图即可自动验证
      const hist = loadHistory();
      hist.push({
        id: newId, ts: Date.now(), type: 'prediction',
        totalPeople: ctx.n,
        observed: ctx.records.map(r => r.amount),
        meIdx: ctx.meIdx,
        prediction: { pLuckyMe: result.pLuckyMe, totalQ50: result.total.q50 }
      });
      saveHistory(hist);
    }
    renderResult(result, ctx, pairedRec);
    showView('result');
  }

  function renderResult(result, ctx, pairedRec) {
    const { records, n, meIdx, finished, luckyIdx } = ctx;
    const obsNames = records.map(r => r.name);

    // APK 桥接：结果回传悬浮窗（网页环境中 window.LuckBridge 不存在，自动跳过）
    if (window.LuckBridge) {
      try {
        window.LuckBridge.onResult(JSON.stringify({
          isFinished: finished,
          pLuckyMe: result.pLuckyMe
        }));
      } catch (e) { /* 桥接失败不影响页面 */ }
    }

    // ---- 主卡片 ----
    if (finished) {
      $('bigP').textContent = '🧧 已抢完';
      const nm = records[luckyIdx].name ? ' ' + records[luckyIdx].name : '';
      $('bigCap').textContent = '运气王：第 ' + (luckyIdx + 1) + ' 位（¥' + yuan(records[luckyIdx].amount) + nm + '）';
      if (meIdx !== null) {
        $('bigExtra').textContent = meIdx === luckyIdx ? '🎉 你就是运气王！' : '这次不是你（你是第 ' + (meIdx + 1) + ' 个抢），下次再战';
      } else {
        $('bigExtra').textContent = '点「我」标记自己后，就能累计预测 VS 实际战绩';
      }
    } else if (meIdx !== null) {
      $('bigP').textContent = (result.pLuckyMe * 100).toFixed(1) + '%';
      $('bigCap').textContent = '你（第 ' + (meIdx + 1) + ' 个抢，¥' + yuan(records[meIdx].amount) + '）最终成为运气王的概率';
      $('bigExtra').textContent = '红包还没抢完，后面还有 ' + (n - records.length) + ' 个人。';
    } else {
      $('bigP').textContent = (result.pLuckyMe * 100).toFixed(1) + '%';
      $('bigCap').textContent = '你下一个抢（第 ' + (records.length + 1) + ' 个），最终成为运气王的概率';
      $('bigExtra').textContent = '红包还没抢完，你抢完后面还有 ' + (n - records.length - 1) + ' 个人。';
    }

    // ---- 预测 VS 实际卡片（仅已抢完） ----
    if (finished) {
      $('pairCard').hidden = false;
      const box = $('pairBox');
      box.innerHTML = '';
      if (pairedRec && pairedRec.meIdx !== null && pairedRec.meIdx !== undefined && pairedRec.prediction) {
        const hit = pairedRec.actual.luckyIdx === pairedRec.meIdx;
        const line = document.createElement('div');
        line.innerHTML = '';
        line.appendChild(document.createTextNode('📈 上次预测：运气王概率 ' +
          (pairedRec.prediction.pLuckyMe * 100).toFixed(1) + '% → 实际：'));
        const b = document.createElement('b');
        b.className = hit ? 'hit' : 'miss';
        b.textContent = hit ? '命中 ✓' : '未中 ✗';
        line.appendChild(b);
        box.appendChild(line);
        const sub = document.createElement('div');
        sub.style.cssText = 'color:var(--muted);font-size:12px;margin-top:4px;';
        sub.textContent = '已自动回填到历史记录（观测记录与本次截图匹配）';
        box.appendChild(sub);
      } else if (meIdx !== null) {
        box.textContent = '🏁 实际结果已记入历史，下次预测后自动对比';
      } else {
        box.textContent = '🏁 实际结果已记入历史（标记「我」的预测会被自动验证）';
      }
    } else {
      $('pairCard').hidden = true;
    }

    // ---- 总额 ----
    if (finished) {
      const sum = records.reduce((a, r) => a + r.amount, 0);
      $('totalCard').hidden = false;
      $('totalEst').textContent = '总额确定：¥' + yuan(sum) + '（' + records.length + ' 条领取记录之和）';
      $('candBody').innerHTML = '';
    } else {
      $('totalCard').hidden = false;
      $('totalEst').textContent = '总额下界 ' + result.total.lowerBoundYuan + ' 元 · 中位 ≈ ' + result.total.q50 +
        ' 元（80% 区间 ' + result.total.q10 + '–' + result.total.q90 + ' 元）· 已抢人数越多估计越准';
      $('candBody').innerHTML = '';
      result.candidates.slice(0, 8).forEach(c => {
        const tr = document.createElement('tr');
        const t1 = document.createElement('td'); t1.textContent = c.yuan + ' 元';
        const t2 = document.createElement('td'); t2.textContent = (c.p * 100).toFixed(1) + '%';
        const t3 = document.createElement('td'); t3.textContent = c.pLuckyMe === null ? '—' : (c.pLuckyMe * 100).toFixed(1) + '%';
        tr.appendChild(t1); tr.appendChild(t2); tr.appendChild(t3);
        $('candBody').appendChild(tr);
      });
    }

    // ---- 位置概率 ----
    const maxP = Math.max.apply(null, result.posProb.concat([1e-9]));
    const bars = $('posBars');
    bars.innerHTML = '';
    result.posProb.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'prow' + (i === result.meIdx && !finished ? ' me-row' : '');
      const pl = document.createElement('span'); pl.className = 'pl'; pl.textContent = '#' + (i + 1);
      const bar = document.createElement('span'); bar.className = 'bar';
      const fill = document.createElement('span'); fill.style.width = Math.max(p / maxP * 100, 1.5) + '%';
      bar.appendChild(fill);
      const pv = document.createElement('span'); pv.className = 'pv'; pv.textContent = (p * 100).toFixed(1) + '%';
      const pt = document.createElement('span'); pt.className = 'pt';
      let tag = i < records.length ? '¥' + yuan(records[i].amount) + (obsNames[i] ? ' ' + obsNames[i] : '') : '';
      if (i === luckyIdx && finished) tag = (tag ? tag + ' ' : '') + '👑';
      if (i === result.meIdx && !finished) tag += (tag ? ' · ' : '') + '← 你';
      pt.textContent = tag;
      row.appendChild(pl); row.appendChild(bar); row.appendChild(pv); row.appendChild(pt);
      bars.appendChild(row);
    });

    // ---- 我的金额 ----
    if (finished) {
      $('meCard').hidden = true;
    } else if (meIdx !== null) {
      $('meCard').hidden = false;
      $('meAmount').textContent = '你的金额已固定为 ¥' + yuan(records[meIdx].amount) + '。';
    } else {
      $('meCard').hidden = false;
      $('meAmount').textContent = '预计 ≈ ¥' + yuan(result.meAmount.q50) +
        '（80% 区间 ¥' + yuan(result.meAmount.q10) + ' – ¥' + yuan(result.meAmount.q90) + '）';
    }
  }

  // ---------------------------------------------------------------------------
  // 历史页
  // ---------------------------------------------------------------------------
  function renderHistory() {
    const hist = loadHistory();
    const paired = hist.filter(h => h.type === 'paired');
    const verified = paired.filter(h => h.meIdx !== null && h.meIdx !== undefined && h.prediction);
    const hit = verified.filter(h => h.actual.luckyIdx === h.meIdx).length;
    const avgP = verified.length
      ? verified.reduce((a, h) => a + h.prediction.pLuckyMe, 0) / verified.length : null;
    const pending = hist.filter(h => h.type === 'prediction' && !h.actual).length;

    const stats = $('histStats');
    stats.innerHTML = '';
    [['预测', hist.filter(h => h.type !== 'actual').length],
     ['已验证', verified.length],
     ['实际命中', hit]].forEach(kv => {
      const box = document.createElement('div');
      const v = document.createElement('div'); v.className = 'v'; v.textContent = kv[1];
      const k = document.createElement('div'); k.className = 'k'; k.textContent = kv[0];
      box.appendChild(v); box.appendChild(k); stats.appendChild(box);
    });

    const calib = $('histCalib');
    if (verified.length >= 3) {
      calib.textContent = '平均预测概率 ' + (avgP * 100).toFixed(1) + '%，实际命中率 ' +
        (hit / verified.length * 100).toFixed(1) + '% —— 两者越接近说明模型越准';
    } else {
      calib.textContent = '多玩几轮（抢完后把最终截图再传一次）就能看到模型准不准';
    }

    const list = $('histList');
    list.innerHTML = '';
    hist.slice().reverse().forEach(h => {
      const row = document.createElement('div');
      row.className = 'hrow';
      const t = document.createElement('span'); t.className = 'ht'; t.textContent = fmtTs(h.ts);
      const d = document.createElement('span'); d.className = 'hd';
      d.textContent = h.totalPeople + '人包 · 已观测 ' + (h.observed ? h.observed.length : (h.amounts ? h.amounts.length : 0)) + ' 人';
      const p = document.createElement('span'); p.className = 'hp';
      p.textContent = h.prediction ? (h.prediction.pLuckyMe * 100).toFixed(1) + '%' : '—';
      const r = document.createElement('span'); r.className = 'hr';
      if (h.type === 'prediction') { r.className = 'pending'; r.textContent = '待回填'; }
      else if (h.type === 'paired') {
        if (h.meIdx !== null && h.meIdx !== undefined && h.prediction) {
          const ok = h.actual.luckyIdx === h.meIdx;
          r.className = ok ? 'hit' : 'miss';
          r.textContent = ok ? '命中 ✓' : '未中 ✗';
        } else { r.className = 'pending'; r.textContent = '🏁'; }
      } else { r.className = 'pending'; r.textContent = '🏁 仅实际'; }
      row.appendChild(t); row.appendChild(d); row.appendChild(p); row.appendChild(r);
      list.appendChild(row);
    });
    if (!hist.length) list.innerHTML = '<div class="hint">还没有记录：做一次预测，红包抢完后再传一次最终截图试试</div>';
  }

  // ---------------------------------------------------------------------------
  // 事件绑定
  // ---------------------------------------------------------------------------
  const dz = $('dropzone');
  const fileInput = $('file');
  dz.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { handleFiles(fileInput.files); fileInput.value = ''; });
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('drag');
    if (e.dataTransfer.files && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
  document.addEventListener('paste', e => {
    if ($('view-upload').hidden && $('view-confirm').hidden) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.indexOf('image') === 0) {
        const f = it.getAsFile();
        if (f) { handleFile(f); e.preventDefault(); }
        break;
      }
    }
  });

  document.querySelectorAll('.samples button').forEach(b => {
    b.addEventListener('click', () => renderConfirm(JSON.parse(JSON.stringify(SAMPLES[b.dataset.sample]))));
  });

  $('skipOcr').addEventListener('click', () => {
    $('progWrap').classList.add('hidden');
    renderConfirm({ finished: null, totalPeople: null, claimed: null, records: [], luckyIdx: null, meIdxGuess: null, myTopAmount: null, warnings: [] });
  });

  $('backToUpload').addEventListener('click', () => showView('upload'));
  $('backToConfirm').addEventListener('click', () => showView('confirm'));
  $('backFromHist').addEventListener('click', () => showView('upload'));
  $('btnHist').addEventListener('click', () => { renderHistory(); showView('history'); });

  $('calc').addEventListener('click', onCalc);

  // 自定义先验联动
  document.querySelectorAll('input[name=prior]').forEach(r => {
    r.addEventListener('change', () => { $('custom').disabled = r.value !== 'custom' || !r.checked; });
  });

  $('clearHist').addEventListener('click', () => {
    if (confirm('确定清空全部历史记录？')) { saveHistory([]); renderHistory(); }
  });

  showView('upload');

  // ---------------------------------------------------------------------------
  // Android APK 桥接：无障碍服务把微信红包详情页的行文本推进来（纯只读）
  // ---------------------------------------------------------------------------
  window.__fromAndroid = function (rowsText) {
    try {
      const parsed = window.LKOCR.parseReceiptText(String(rowsText || ''));
      if (!parsed.records.length && parsed.totalPeople === null) return false;
      renderConfirm(parsed);
      return true;
    } catch (e) { return false; }
  };
  window.__appReady = true;

  // ---------------------------------------------------------------------------
  // APK 读屏模式：上传区替换为「权限状态卡」（网页环境中无 LuckBridge，自动跳过）
  // ---------------------------------------------------------------------------
  if (window.LuckBridge) {
    const dz = $('dropzone');

    function renderAndroidStatus(enabled) {
      dz.innerHTML = '';
      dz.style.border = 'none';
      dz.style.cursor = 'default';

      const icon = document.createElement('div');
      icon.className = 'dz-icon';
      icon.textContent = '🤖';

      const main = document.createElement('div');
      main.className = 'dz-main';

      const sub = document.createElement('div');
      sub.className = 'dz-sub';

      const btn = document.createElement('button');
      btn.style.cssText = 'margin-top:16px;padding:12px 26px;background:#d0453e;color:#fff;font-size:15px;font-weight:600;border:none;border-radius:10px;cursor:pointer;';

      if (enabled) {
        main.textContent = '✅ 读屏服务已开启';
        sub.textContent = '现在去微信打开一个红包详情页，悬浮窗会自动出现。点击「查看预测」回到本页看结果。';
        btn.textContent = '重新打开设置';
        btn.onclick = () => window.LuckBridge.openAccessibilitySettings();
      } else {
        main.textContent = '第一步：开启读屏权限';
        sub.innerHTML = '点击下方按钮跳转到系统无障碍设置，找到「运气王预言家」并开启。<br>开启后回到本应用，然后去微信打开红包详情页。';
        btn.textContent = '开启读屏（跳转系统设置）';
        btn.onclick = () => window.LuckBridge.openAccessibilitySettings();

        const tip = document.createElement('div');
        tip.className = 'dz-tip';
        tip.innerHTML = '⚠ 荣耀 / Android 13+：如果开关是灰色的，先去<br>设置 → 应用 → 运气王预言家 → 右上 ⋮ →「允许受限设置」（需指纹确认），<br>然后回来重新开启';
        dz.appendChild(tip);
      }

      dz.appendChild(icon);
      dz.appendChild(main);
      dz.appendChild(sub);
      dz.appendChild(btn);
    }

    window.__androidStatus = function (st) {
      try {
        renderAndroidStatus(!!st.serviceEnabled);
        return true;
      } catch (e) { return false; }
    };

    // 首次渲染（LuckBridge 由原生注入，isServiceEnabled 直接可用）
    try { renderAndroidStatus(window.LuckBridge.isServiceEnabled()); } catch (e) {}
  }
})();
