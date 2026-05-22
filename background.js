console.log('[B站总结] Background service worker 已启动');

// 使用长连接监听，避免 service worker 休眠导致通道关闭
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'summarize') {
    port.onMessage.addListener((request) => {
      console.log('[B站总结] 收到请求');
      handleSummarize(request)
        .then(result => {
          console.log('[B站总结] 总结完成，长度:', result.summary?.length);
          port.postMessage(result);
        })
        .catch(err => {
          console.error('[B站总结] 处理失败:', err.message);
          port.postMessage({ error: err.message });
        });
    });
  }
});

async function handleSummarize({ subtitles, title }) {
  const { provider, baseUrl, apiKey, model, apiFormat } = await chrome.storage.local.get(
    ['provider', 'baseUrl', 'apiKey', 'model', 'apiFormat']
  );

  console.log('[B站总结] 配置:', { provider, baseUrl, model, apiFormat, hasKey: !!apiKey });

  if (!apiKey) throw new Error('请先在插件设置中配置 API Key');
  if (!baseUrl) throw new Error('请先在插件设置中配置 API 地址');

  const prompt = buildPrompt(subtitles, title);
  console.log('[B站总结] Prompt 长度:', prompt.length, '字符');

  // apiFormat 优先：自定义接口可选 Claude 或 OpenAI 格式
  const useClaudeFormat = apiFormat === 'claude' || provider === 'claude';

  if (useClaudeFormat) {
    return await callClaudeAPI(baseUrl, apiKey, model, prompt);
  } else {
    return await callOpenAICompatibleAPI(baseUrl, apiKey, model, prompt);
  }
}

// Claude API (Anthropic 格式)
async function callClaudeAPI(baseUrl, apiKey, model, prompt) {
  const url = `${baseUrl}/v1/messages`;
  console.log('[B站总结] 请求 Claude API:', url);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `API 请求失败: ${response.status}`);
    }

    const data = await response.json();
    return { summary: data.content[0].text };
  } catch (e) {
    console.error('[B站总结] Claude API 错误:', e.message);
    throw e;
  }
}

// OpenAI 兼容 API（覆盖 DeepSeek、通义千问、智谱、硅基流动等）
async function callOpenAICompatibleAPI(baseUrl, apiKey, model, prompt) {
  const url = baseUrl.replace(/\/+$/, '') + '/v1/chat/completions';
  console.log('[B站总结] 请求 API:', url, '模型:', model);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `API 请求失败: ${response.status}`);
    }

    const data = await response.json();
    return { summary: data.choices[0].message.content };
  } catch (e) {
    console.error('[B站总结] API 错误:', e.message);
    throw e;
  }
}

function buildPrompt(subtitles, title) {
  const formattedSubtitles = subtitles.map(s => {
    const time = formatTime(s.from);
    return `[${time}] ${s.content}`;
  }).join('\n');

  return `你是一个视频内容总结助手。请根据以下B站视频的字幕内容，生成一份结构化的视频总结。

视频标题：${title}

字幕内容（带时间戳）：
${formattedSubtitles}

请按以下格式输出总结：

## 📋 视频概要
用 2-3 句话概括视频的核心内容。

## 🕐 关键时间点
列出视频中的关键时间节点，格式如下：
- [MM:SS] 这个时间点讨论的内容简述
- [MM:SS] 另一个关键节点的内容

至少列出 5-8 个关键时间点，涵盖视频的主要部分。

## 📝 详细总结
分段落详细总结视频内容，每个段落用 [MM:SS] 标注对应的时间点。例如：
[02:15] 这里讨论了xxx...
[05:30] 接着分析了xxx...

重要：
- 所有时间戳必须用 [MM:SS] 格式（如 [05:30]），不要用其他格式
- 时间戳会被自动渲染为可点击的跳转链接
- 保持客观准确，不要编造内容`;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
