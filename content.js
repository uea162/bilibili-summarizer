(function () {
  'use strict';

  console.log('[B站总结] Content script 已加载');

  const SIDEBAR_ID = 'bili-summary-sidebar';
  const BTN_ID = 'bili-summary-btn';
  let currentBvid = null;

  function init() {
    const bvid = extractBvid();
    if (!bvid || bvid === currentBvid) return;
    currentBvid = bvid;

    removeSidebar();
    removeButton();
    waitForActionBar(bvid);
  }

  function extractBvid() {
    const match = location.pathname.match(/\/video\/(BV\w+)/);
    return match ? match[1] : null;
  }

  // 等待操作栏加载完成
  function waitForActionBar(bvid) {
    console.log('[B站总结] 开始查找操作栏, bvid:', bvid);
    let attempts = 0;
    const timer = setInterval(() => {
      // 优先找右侧操作栏（稿件举报所在区域）
      const rightBar = document.querySelector('.video-toolbar-right, .toolbar-right, .video-toolbar-right-main');
      if (rightBar) {
        clearInterval(timer);
        console.log('[B站总结] 找到右侧操作栏，注入按钮');
        injectButtonRight(rightBar, bvid);
        return;
      }
      // 回退：找左侧操作栏
      const leftBar = document.querySelector('.video-toolbar-left-main');
      if (leftBar && leftBar.querySelector('.toolbar-left-item-wrap')) {
        clearInterval(timer);
        console.log('[B站总结] 找到左侧操作栏，注入按钮');
        injectButton(leftBar, bvid);
        return;
      }
      if (++attempts > 40) {
        clearInterval(timer);
        console.warn('[B站总结] 未找到操作栏，已超时。页面结构可能已变化。');
        injectFallbackButton(bvid);
      }
    }, 500);
  }

  // 回退方案：注入到视频播放器下方
  function injectFallbackButton(bvid) {
    if (document.getElementById(BTN_ID)) return;
    const target = document.querySelector('#arc_toolbar_report')
      || document.querySelector('.video-toolbar-container')
      || document.querySelector('.left-container');
    if (!target) {
      console.error('[B站总结] 无法找到任何注入位置');
      return;
    }
    const btn = document.createElement('div');
    btn.id = BTN_ID;
    btn.className = 'bs-toolbar-btn-fallback';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z"/>
      </svg>
      <span>AI总结</span>
    `;
    btn.addEventListener('click', () => handleSummarize(bvid));
    target.insertBefore(btn, target.firstChild);
    console.log('[B站总结] 使用回退方案注入按钮');
  }

  // 注入到右侧操作栏（稿件举报左边）
  function injectButtonRight(container, bvid) {
    if (document.getElementById(BTN_ID)) return;

    const wrap = document.createElement('div');
    wrap.id = BTN_ID;
    wrap.className = 'bs-toolbar-btn-wrap';

    const item = document.createElement('div');
    item.className = 'bs-toolbar-btn';
    item.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z"/>
      </svg>
      <span>AI总结</span>
    `;

    item.addEventListener('click', () => handleSummarize(bvid));
    wrap.appendChild(item);
    // 插入到容器最前面（稿件举报左边）
    container.insertBefore(wrap, container.firstChild);
  }

  // 注入总结按钮到左侧操作栏（回退方案）
  function injectButton(container, bvid) {
    if (document.getElementById(BTN_ID)) return;

    const wrap = document.createElement('div');
    wrap.id = BTN_ID;
    wrap.className = 'toolbar-left-item-wrap';

    const item = document.createElement('div');
    item.className = 'bs-toolbar-btn video-toolbar-left-item';
    item.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z"/>
      </svg>
      <span>AI总结</span>
    `;

    item.addEventListener('click', () => handleSummarize(bvid));
    wrap.appendChild(item);
    container.appendChild(wrap);
  }

  // 使用长连接发送消息，避免 service worker 休眠导致通道关闭
  function sendToBackground(message) {
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: 'summarize' });
      const timer = setTimeout(() => {
        port.disconnect();
        reject(new Error('请求超时，请检查网络或 API 配置'));
      }, 120000);

      port.onMessage.addListener((response) => {
        clearTimeout(timer);
        port.disconnect();
        resolve(response);
      });

      port.onDisconnect.addListener(() => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        }
      });

      port.postMessage(message);
    });
  }

  // 点击总结按钮
  async function handleSummarize(bvid) {
    // 如果侧边栏已存在，切换显示/隐藏
    const existing = document.getElementById(SIDEBAR_ID);
    if (existing) {
      existing.classList.toggle('bs-hidden');
      return;
    }

    // 创建侧边栏
    const sidebar = createSidebar();
    document.body.appendChild(sidebar);

    const loadingEl = sidebar.querySelector('.bs-loading');
    const contentEl = sidebar.querySelector('.bs-content');
    const errorEl = sidebar.querySelector('.bs-error');
    const btn = sidebar.querySelector('.bs-summarize-btn');

    loadingEl.classList.remove('hidden');

    try {
      const { cid, title } = await fetchVideoInfo(bvid);
      const subtitles = await fetchSubtitles(bvid, cid);

      console.log('[B站总结] 字幕条数:', subtitles.length, '标题:', title);

      const result = await sendToBackground({ action: 'summarize', subtitles, title });

      if (!result) throw new Error('后台服务无响应，请刷新页面后重试');
      if (result.error) throw new Error(result.error);

      contentEl.innerHTML = renderMarkdown(result.summary);
      contentEl.classList.remove('hidden');
      bindTimestampClicks(contentEl);
      bindCollapsibleSections(contentEl);

    } catch (err) {
      console.error('[B站总结] 错误:', err.message, err);
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    } finally {
      loadingEl.classList.add('hidden');
    }
  }

  // 创建侧边栏 DOM
  function createSidebar() {
    const sidebar = document.createElement('div');
    sidebar.id = SIDEBAR_ID;
    sidebar.innerHTML = `
      <div class="bs-header">
        <span class="bs-title">视频总结</span>
        <div class="bs-header-actions">
          <button class="bs-collapse-btn" title="折叠">─</button>
          <button class="bs-close" title="关闭">×</button>
        </div>
      </div>
      <div class="bs-body">
        <div class="bs-loading hidden">
          <div class="bs-spinner"></div>
          <p>正在分析视频内容，请稍候...</p>
        </div>
        <div class="bs-content hidden"></div>
        <div class="bs-error hidden"></div>
      </div>
    `;

    sidebar.querySelector('.bs-close').addEventListener('click', removeSidebar);
    sidebar.querySelector('.bs-collapse-btn').addEventListener('click', () => {
      sidebar.classList.toggle('bs-collapsed');
    });

    makeDraggable(sidebar);
    return sidebar;
  }

  // 获取视频信息（cid + title）
  async function fetchVideoInfo(bvid) {
    // 方法1：从页面已有的 __INITIAL_STATE__ 读取（最可靠，无需API调用）
    const state = window.__INITIAL_STATE__;
    if (state?.videoData?.bvid === bvid || state?.bvid === bvid) {
      const vd = state.videoData || state;
      if (vd.cid && vd.title) {
        console.log('[B站总结] 从页面数据获取视频信息');
        return { cid: vd.cid, title: vd.title };
      }
    }

    // 方法2：API 调用
    console.log('[B站总结] 通过API获取视频信息');
    const resp = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
      headers: { 'Referer': 'https://www.bilibili.com' }
    });
    const data = await resp.json();
    if (data.code !== 0) throw new Error('获取视频信息失败: ' + (data.message || data.code));
    return { cid: data.data.cid, title: data.data.title };
  }

  // 获取字幕（多策略：API → 页面数据）
  async function fetchSubtitles(bvid, cid) {
    let subs = null;

    // 策略1：尝试 /x/player/wbi/v2（带cookie，最可靠）
    console.log('[B站总结] === 策略1: player/wbi/v2 ===');
    try {
      const resp = await fetch(`https://api.bilibili.com/x/player/wbi/v2?bvid=${bvid}&cid=${cid}`, {
        credentials: 'include',
        headers: { 'Referer': 'https://www.bilibili.com' }
      });
      const data = await resp.json();
      const subObj = data.data?.subtitle;
      const subArr = subObj?.subtitles || subObj?.subtitles_list || [];
      console.log('[B站总结] wbi/v2 code:', data.code, '字幕数量:', subArr.length);
      if (data.code === 0 && subArr.length > 0) {
        subs = subArr;
      }
    } catch (e) {
      console.warn('[B站总结] wbi/v2 失败:', e);
    }

    // 策略2：尝试 /x/player/v2
    if (!subs) {
      console.log('[B站总结] === 策略2: player/v2 ===');
      try {
        const resp = await fetch(`https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`, {
          credentials: 'include',
          headers: { 'Referer': 'https://www.bilibili.com' }
        });
        const data = await resp.json();
        const subObj = data.data?.subtitle;
        const subArr = subObj?.subtitles || subObj?.subtitles_list || [];
        console.log('[B站总结] v2 code:', data.code, '字幕数量:', subArr.length);
        if (data.code === 0 && subArr.length > 0) {
          subs = subArr;
        }
      } catch (e) {
        console.warn('[B站总结] v2 失败:', e);
      }
    }

    // 策略3：从 __INITIAL_STATE__ 读取
    if (!subs) {
      console.log('[B站总结] === 策略3: 页面数据 ===');
      subs = getSubtitlesFromPageState();
      console.log('[B站总结] 页面数据字幕:', subs ? subs.length + '条' : '无');
    }

    // 策略4：从DOM script 标签提取
    if (!subs) {
      console.log('[B站总结] === 策略4: DOM ===');
      subs = getSubtitlesFromDOM();
      console.log('[B站总结] DOM字幕:', subs ? subs.length + '条' : '无');
    }

    if (!subs || subs.length === 0) {
      throw new Error('该视频没有可用字幕。请确认视频有AI字幕或CC字幕，部分视频可能需要登录B站账号');
    }

    // 找到字幕，下载内容
    console.log('[B站总结] 找到', subs.length, '条字幕，开始下载...');
    return await downloadBestSubtitle(subs);
  }

  // 从 __INITIAL_STATE__ 中提取字幕信息
  function getSubtitlesFromPageState() {
    try {
      const state = window.__INITIAL_STATE__;
      if (!state) {
        console.log('[B站总结] __INITIAL_STATE__ 不存在');
        return null;
      }

      // 打印 videoData 中与 subtitle 相关的 key
      const vd = state.videoData;
      if (vd) {
        const subKeys = Object.keys(vd).filter(k =>
          k.toLowerCase().includes('sub') || k.toLowerCase().includes('caption')
        );
        console.log('[B站总结] videoData 中相关 keys:', subKeys);
        if (vd.subtitle) {
          console.log('[B站总结] videoData.subtitle:', JSON.stringify(vd.subtitle).substring(0, 300));
        }
      }

      // 尝试多种路径
      const paths = [
        ['videoData.subtitle.subtitles', state.videoData?.subtitle?.subtitles],
        ['videoData.subtitle.subtitles_list', state.videoData?.subtitle?.subtitles_list],
        ['subtitle.subtitles', state.subtitle?.subtitles],
        ['subtitle.subtitles_list', state.subtitle?.subtitles_list],
      ];

      for (const [name, subs] of paths) {
        if (Array.isArray(subs) && subs.length > 0) {
          console.log('[B站总结] 在路径', name, '找到字幕');
          return subs;
        }
      }

      // 遍历查找包含 subtitle 的对象
      if (vd) {
        for (const key of Object.keys(vd)) {
          const val = vd[key];
          if (val && typeof val === 'object' && Array.isArray(val.subtitles)) {
            console.log('[B站总结] 在 videoData.' + key + '.subtitles 找到字幕');
            return val.subtitles;
          }
          if (val && typeof val === 'object' && val.subtitle_url) {
            console.log('[B站总结] 在 videoData.' + key + ' 找到 subtitle_url');
            return [val];
          }
        }
      }
    } catch (e) {
      console.warn('[B站总结] 解析页面状态失败:', e);
    }
    return null;
  }

  // 从全局变量查找字幕
  function getSubtitlesFromGlobal() {
    try {
      // 检查 window 上可能存在的播放器数据
      const playinfo = window.__playinfo__;
      if (playinfo) {
        console.log('[B站总结] __playinfo__ keys:', Object.keys(playinfo));
      }

      // 检查 B 站播放器实例
      const player = window.player || window.__bilibili__player__;
      if (player) {
        console.log('[B站总结] 找到播放器实例');
      }
    } catch (e) {
      console.warn('[B站总结] 全局变量检查失败:', e);
    }
    return null;
  }

  // 从页面 script 标签中查找字幕数据
  function getSubtitlesFromDOM() {
    try {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent;
        if (!text || !text.includes('subtitle_url')) continue;
        // 尝试提取 JSON 中的 subtitles 数组
        const match = text.match(/"subtitles"\s*:\s*(\[[\s\S]*?\])/);
        if (match) {
          return JSON.parse(match[1]);
        }
      }
    } catch (e) {
      console.warn('[B站总结] 从DOM提取字幕失败:', e);
    }
    return null;
  }

  // 选择最佳字幕并下载
  async function downloadBestSubtitle(subs) {
    // 打印所有可用字幕
    subs.forEach((s, i) => {
      console.log(`[B站总结] 字幕${i}: lan=${s.lan} lan_doc=${s.lan_doc} url=${s.subtitle_url?.substring(0, 60)}`);
    });

    // 优先级：中文字幕 > AI中文字幕 > 其他语言 > 第一个
    const zhCC = subs.find(s => s.lan === 'zh-CN' || s.lan === 'zh-Hans');
    const zhAI = subs.find(s => s.lan === 'ai-zh' || (s.lan_doc && s.lan_doc.includes('自动生成')));
    const anyZh = subs.find(s => s.lan && s.lan.includes('zh'));
    const sub = zhCC || zhAI || anyZh || subs[0];

    if (!sub) throw new Error('无法选择字幕');

    const subType = sub.lan?.startsWith('ai') || sub.ai_type === 1 ? 'AI字幕' : 'CC字幕';
    console.log(`[B站总结] 选择: ${subType} (${sub.lan_doc || sub.lan})`);

    let subUrl = sub.subtitle_url;
    if (!subUrl) throw new Error('字幕 URL 不存在');
    if (subUrl.startsWith('//')) subUrl = 'https:' + subUrl;
    console.log('[B站总结] 下载字幕:', subUrl.substring(0, 80) + '...');

    const subResp = await fetch(subUrl);
    if (!subResp.ok) throw new Error('字幕文件下载失败: HTTP ' + subResp.status);

    const subData = await subResp.json();
    console.log('[B站总结] 字幕内容条数:', subData.body?.length);

    if (!subData.body || subData.body.length === 0) {
      throw new Error('字幕内容为空');
    }

    return truncateSubtitles(subData.body);
  }

  // 截断字幕，避免 prompt 过长导致 API 响应慢
  function truncateSubtitles(subs, maxChars = 15000) {
    let total = subs.reduce((sum, s) => sum + (s.content?.length || 0), 0);
    if (total <= maxChars) return subs;

    const step = Math.ceil(subs.length / Math.floor(maxChars / 8));
    const sampled = subs.filter((_, i) => i === 0 || i === subs.length - 1 || i % step === 0);
    console.log(`[B站总结] 字幕截断: ${subs.length} → ${sampled.length} 条 (${total} → ~${sampled.length * 8} 字符)`);
    return sampled;
  }

  // Markdown 渲染
  function renderMarkdown(text) {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return escaped
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm, '<h3 class="bs-section-title"><span class="bs-section-arrow">▶</span> $1</h3>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g,
        '<span class="bs-timestamp" data-time="$1">[$1]</span>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
  }

  // 时间戳跳转
  function bindTimestampClicks(container) {
    container.querySelectorAll('.bs-timestamp').forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        const seconds = parseTime(el.dataset.time);
        const video = document.querySelector('video');
        if (video) {
          video.currentTime = seconds;
          video.play();
        }
      });
    });
  }

  // 可折叠段落
  function bindCollapsibleSections(container) {
    container.querySelectorAll('.bs-section-title').forEach(title => {
      title.style.cursor = 'pointer';
      title.addEventListener('click', () => {
        const arrow = title.querySelector('.bs-section-arrow');
        let el = title.nextElementSibling;
        const isCollapsed = arrow.textContent === '▶';
        arrow.textContent = isCollapsed ? '▼' : '▶';
        while (el && !el.classList.contains('bs-section-title')) {
          el.style.display = isCollapsed ? '' : 'none';
          el = el.nextElementSibling;
        }
      });
    });
  }

  function parseTime(str) {
    const parts = str.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return parts[0] * 60 + parts[1];
  }

  function removeSidebar() {
    const el = document.getElementById(SIDEBAR_ID);
    if (el) el.remove();
  }

  function removeButton() {
    const el = document.getElementById(BTN_ID);
    if (el) el.remove();
  }

  // 拖拽
  function makeDraggable(el) {
    const header = el.querySelector('.bs-header');
    let isDragging = false, offsetX, offsetY;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      isDragging = true;
      offsetX = e.clientX - el.getBoundingClientRect().left;
      offsetY = e.clientY - el.getBoundingClientRect().top;
      el.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      el.style.right = 'auto';
      el.style.left = (e.clientX - offsetX) + 'px';
      el.style.top = (e.clientY - offsetY) + 'px';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      el.style.transition = '';
    });
  }

  // SPA 跳转监听
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      currentBvid = null;
      setTimeout(init, 1500);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1500));
  } else {
    setTimeout(init, 1500);
  }
})();
