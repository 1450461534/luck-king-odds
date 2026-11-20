/**
 * ocr.js —— 截图识别模块
 *
 * 两部分：
 *  1. parseReceiptText(text)   纯函数：把 OCR 输出的文本解析成红包结构化数据
 *                              （Node 也可运行，test.mjs 直接覆盖测试）
 *  2. recognizeImageFile(file) 浏览器专用：Tesseract.js 懒加载识别（纯本地，无上传）
 *
 * 解析依赖的微信红包详情页特征（PC / 安卓一致）：
 *  - 列表按「最新在最上」排序 → 解析后反转为「抢的先后顺序」
 *  - 已抢完：「N个红包，xx分钟被抢光」
 *  - 进行中：「已领取 x/y 个」
 *  - 运气王行：金额附近带「手气最佳」徽标（常独立成行，归属上一条记录）
 *  - 自己领取后打开：顶部大金额 +「已存入零钱」→ 该金额不属于列表，用于推断「哪个是我」
 *  - 金额格式统一为「0.19元」（两位小数）
 */
(function (root) {
  'use strict';

  const AMOUNT_RE = /(\d+\.\d{2})/;

  /**
   * 解析 OCR 文本 → 结构化红包数据
   * @param {string} text OCR 全文（按行）
   * @returns {{
   *   finished: boolean|null,   // 红包是否已抢完（null=无法判断）
   *   totalPeople: number|null, // 红包总个数
   *   claimed: number|null,     // 进行中时的已领取个数
   *   records: {amount:number, name:string, lucky:boolean}[], // 按「抢的先后」排序，amount 单位=分
   *   luckyIdx: number|null,    // 手气最佳在 records 中的下标
   *   meIdxGuess: number|null,  // 由顶部金额唯一匹配推断的「我的行」下标
   *   myTopAmount: number|null, // 顶部大金额（分）
   *   warnings: string[]
   * }}
   */
  function parseReceiptText(text) {
    const warnings = [];
    const rawLines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);

    let finished = null;
    let totalPeople = null;
    let claimed = null;
    let myTopAmount = null;
    const visual = [];   // 视觉顺序（最新在最上）
    let lastPush = null; // 最近一次 push 的 {idx: 行号, vi: visual 下标}

    rawLines.forEach((line, idx) => {
      // ① 进行中：「已领取 x/y 个」（斜杠可能被 OCR 打歪，宽松匹配）
      let m = line.match(/已?领[取领]?\s*(\d{1,3})\s*[\/／\\|]\s*(\d{1,3})/) ||
              line.match(/(\d{1,3})\s*[\/／]\s*(\d{1,3})\s*个/);
      if (m) {
        claimed = parseInt(m[1], 10);
        totalPeople = parseInt(m[2], 10);
        return;
      }

      // ② 已抢完：「10个红包，30分钟被抢光」
      m = line.match(/(\d{1,4})\s*个红包/);
      if (m) totalPeople = parseInt(m[1], 10);
      if (/被抢光|已抢完|抢光/.test(line)) finished = true;

      // ③ 顶部「已存入零钱」区：同行金额直接取；否则回溯上方 ≤3 行内的金额行并从列表移除
      if (/已存入|存入零钱/.test(line)) {
        const same = line.match(AMOUNT_RE);
        if (same) {
          myTopAmount = Math.round(parseFloat(same[1]) * 100);
        } else if (lastPush && idx - lastPush.idx <= 3) {
          const top = visual[lastPush.vi];
          if (top) {
            myTopAmount = top.amount;
            visual.splice(lastPush.vi, 1);
          }
        }
        lastPush = null;
        return;
      }

      // ④ 「手气最佳」徽标独立行 → 归属到上一条视觉记录
      if (/手气最佳|运气王/.test(line) && !line.match(AMOUNT_RE)) {
        if (visual.length) visual[visual.length - 1].lucky = true;
        return;
      }

      // ⑤ 金额行 → 领取记录
      const a = line.match(AMOUNT_RE);
      if (a) {
        const amount = Math.round(parseFloat(a[1]) * 100);
        if (amount < 1) return; // 0.00 之类的噪声
        const name = line.replace(AMOUNT_RE, '').replace(/元/g, '')
                         .replace(/手气最佳|运气王|👑/g, '').trim();
        visual.push({ amount: amount, name: name, lucky: /手气最佳|运气王/.test(line) });
        lastPush = { idx: idx, vi: visual.length - 1 };
      }
    });

    // ⑥ 一致性修正
    if (finished === null && totalPeople !== null && visual.length >= totalPeople) {
      finished = true; // 记录数 == 总个数 → 视为抢完
    }
    if (totalPeople !== null && visual.length > totalPeople) {
      // 多出来的几乎一定是「已存入」区没识别成功的顶部大金额（在视觉最上方）
      warnings.push('识别到的记录数超过红包总个数，已移除最上方一条（请人工核对）');
      const removed = visual.shift();
      if (removed && myTopAmount === null) myTopAmount = removed.amount;
    }
    if (!visual.length) warnings.push('未识别到任何领取记录（截图需包含金额列表）');
    if (totalPeople === null) warnings.push('未识别到红包总个数（需包含「N个红包」或「已领取x/y」文案）');
    if (claimed !== null && totalPeople !== null && claimed > totalPeople) {
      warnings.push('「已领取」数大于总个数，可能是识别错误');
    }

    // ⑦ 反转为「抢的先后顺序」，并定位运气王
    const records = visual.slice().reverse();
    let luckyIdx = null;
    for (let i = 0; i < records.length; i++) {
      if (records[i].lucky) { luckyIdx = i; break; }
    }

    // ⑧ 「哪个是我」推断：顶部金额在列表中唯一匹配才自动填，否则交给用户点选
    let meIdxGuess = null;
    if (myTopAmount !== null) {
      const hits = [];
      records.forEach((r, i) => { if (r.amount === myTopAmount) hits.push(i); });
      if (hits.length === 1) meIdxGuess = hits[0];
    }

    return {
      finished: finished,
      totalPeople: totalPeople,
      claimed: claimed,
      records: records,
      luckyIdx: luckyIdx,
      meIdxGuess: meIdxGuess,
      myTopAmount: myTopAmount,
      warnings: warnings
    };
  }

  // ---------------------------------------------------------------------------
  // 浏览器部分：识别引擎加载（优先本地自托管，纯本地识别，图片不上传）
  // ---------------------------------------------------------------------------

  /**
   * 识别源按优先级依次尝试：
   *  1. 本地自托管（./tesseract/ —— 本地 server 或 GitHub Pages 同源，离线可用）
   *  2. unpkg（在线兜底）
   * 注：cdn.jsdelivr.net 在部分网络不可达，不再作为默认源
   */
  const SOURCES = [
    {
      name: '本地',
      script: 'tesseract/tesseract.min.js',
      worker: 'tesseract/worker.min.js',
      core: 'tesseract/core',
      lang: 'tesseract/tessdata'
    },
    {
      name: 'unpkg',
      script: 'https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js',
      worker: 'https://unpkg.com/tesseract.js@5.1.1/dist/worker.min.js',
      core: 'https://unpkg.com/tesseract.js-core@5.1.0',
      lang: 'https://tessdata.projectnaptha.com/4.0.0'
    }
  ];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('脚本加载失败: ' + src));
      document.head.appendChild(s);
    });
  }

  /** 图片预处理：放大 2x + 灰度化（实测对金额/小数点识别率影响巨大），最长边限制 3200 */
  function fileToScaledCanvas(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const SCALE = 2, MAX = 3200;
        let w = img.naturalWidth, h = img.naturalHeight;
        let scale = SCALE * Math.min(1, MAX / Math.max(w * SCALE, h * SCALE));
        w = Math.round(w * scale); h = Math.round(h * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.filter = 'grayscale(1)';
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
      img.src = url;
    });
  }

  let workerReady = null; // 缓存已初始化的 worker

  /** 依次尝试各识别源，返回可用的 worker */
  async function getWorker(onProgress) {
    if (workerReady) return workerReady;
    const report = (s, p) => { if (onProgress) onProgress(s, p); };
    let lastErr = null;
    for (let i = 0; i < SOURCES.length; i++) {
      const src = SOURCES[i];
      try {
        report('连接识别源（' + src.name + ' ' + (i + 1) + '/' + SOURCES.length + '）…', 0.02);
        delete root.Tesseract; // 清掉上一个源的残留
        await loadScript(src.script);
        const w = await root.Tesseract.createWorker('chi_sim', 1, {
          workerPath: src.worker,
          corePath: src.core,
          langPath: src.lang,
          logger: m => {
            if (!m) return;
            if (m.status === 'loading tesseract core') report('加载识别核心…', m.progress * 0.4);
            else if (m.status && m.status.indexOf('loading language') === 0) report('加载中文模型（首次约 20MB，仅一次）…', m.progress * 0.7 + 0.2);
            else if (m.status && m.status.indexOf('loading') === 0) report('初始化…', 0.2);
            else if (m.status === 'recognizing text') report('识别中…', 0.92 + m.progress * 0.08);
          }
        });
        // 列表式截图用 PSM 6（单一文本块）比自动分块稳得多
        await w.setParameters({ tessedit_pageseg_mode: '6' });
        workerReady = { worker: w };
        return workerReady;
      } catch (e) {
        lastErr = e;
        try { if (root.Tesseract && root.Tesseract.terminate) root.Tesseract.terminate(); } catch (e2) {}
      }
    }
    throw lastErr || new Error('所有识别源均不可用');
  }

  /**
   * 识别一张红包截图（首次使用本地源无需联网；本地源缺失时自动切在线源）
   * @param {File|Blob} file
   * @param {Function} onProgress (statusText, progress0to1)
   * @returns {Promise<{text: string, parsed: object}>}
   */
  async function recognizeImageFile(file, onProgress) {
    if (typeof document === 'undefined') throw new Error('仅浏览器可用');
    const report = (s, p) => { if (onProgress) onProgress(s, p); };
    const { worker } = await getWorker(onProgress);
    report('识别中…', 0.92);
    const canvas = await fileToScaledCanvas(file);
    const { data } = await worker.recognize(canvas);
    report('解析结构…', 0.98);
    const parsed = parseReceiptText(data.text);
    report('完成', 1);
    return { text: data.text, parsed: parsed };
  }

  const api = {
    parseReceiptText: parseReceiptText,
    recognizeImageFile: recognizeImageFile
  };

  root.LKOCR = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
