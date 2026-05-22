// 服务商预设配置
const PROVIDERS = {
  claude: {
    name: 'Claude',
    baseUrl: 'https://api.anthropic.com',
    models: [
      { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { value: 'claude-haiku-4-20250414', label: 'Claude Haiku 4 (更快)' }
    ],
    keyPlaceholder: 'sk-ant-api03-...'
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    models: [
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini (更快更便宜)' },
      { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' }
    ],
    keyPlaceholder: 'sk-...'
  },
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: [
      { value: 'deepseek-chat', label: 'DeepSeek Chat (推荐)' },
      { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner (更强)' }
    ],
    keyPlaceholder: 'sk-...'
  },
  qwen: {
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode',
    models: [
      { value: 'qwen-turbo', label: 'Qwen Turbo (免费额度)' },
      { value: 'qwen-plus', label: 'Qwen Plus' },
      { value: 'qwen-max', label: 'Qwen Max (最强)' }
    ],
    keyPlaceholder: 'sk-...'
  },
  glm: {
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas',
    models: [
      { value: 'glm-4-flash', label: 'GLM-4 Flash (免费)' },
      { value: 'glm-4', label: 'GLM-4' },
      { value: 'glm-4-plus', label: 'GLM-4 Plus (最强)' }
    ],
    keyPlaceholder: '输入智谱 API Key'
  },
  siliconflow: {
    name: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn',
    models: [
      { value: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3 (免费)' },
      { value: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen 2.5 72B (免费)' },
      { value: 'meta-llama/Meta-Llama-3.1-70B-Instruct', label: 'Llama 3.1 70B (免费)' }
    ],
    keyPlaceholder: 'sk-...'
  },
  custom: {
    name: '自定义',
    baseUrl: '',
    models: [],
    keyPlaceholder: '输入你的 API Key'
  }
};

const providerSelect = document.getElementById('provider');
const baseUrlInput = document.getElementById('baseUrl');
const apiKeyInput = document.getElementById('apiKey');
const modelSelect = document.getElementById('model');
const modelCustomInput = document.getElementById('modelCustom');
const apiFormatSelect = document.getElementById('apiFormat');
const apiFormatGroup = document.getElementById('apiFormatGroup');
const saveBtn = document.getElementById('save');
const statusDiv = document.getElementById('status');

// 服务商切换 → 更新表单
providerSelect.addEventListener('change', () => {
  const p = PROVIDERS[providerSelect.value];
  baseUrlInput.value = p.baseUrl;
  baseUrlInput.readOnly = providerSelect.value !== 'custom';
  apiKeyInput.placeholder = p.keyPlaceholder;

  // 只有自定义时显示 API 格式选择
  if (providerSelect.value === 'custom') {
    apiFormatGroup.classList.remove('hidden');
  } else {
    apiFormatGroup.classList.add('hidden');
  }

  if (p.models.length > 0) {
    modelSelect.classList.remove('hidden');
    modelCustomInput.classList.add('hidden');
    modelSelect.innerHTML = p.models.map(m =>
      `<option value="${m.value}">${m.label}</option>`
    ).join('');
  } else {
    modelSelect.classList.add('hidden');
    modelCustomInput.classList.remove('hidden');
  }
});

// 加载已保存的设置
chrome.storage.local.get(['provider', 'baseUrl', 'apiKey', 'model', 'apiFormat'], (result) => {
  if (result.provider) {
    providerSelect.value = result.provider;
    providerSelect.dispatchEvent(new Event('change'));
  }
  if (result.baseUrl) baseUrlInput.value = result.baseUrl;
  if (result.apiKey) apiKeyInput.value = result.apiKey;
  if (result.model) {
    const p = PROVIDERS[providerSelect.value];
    if (p.models.length > 0) {
      modelSelect.value = result.model;
    } else {
      modelCustomInput.value = result.model;
    }
  }
  if (result.apiFormat) apiFormatSelect.value = result.apiFormat;
});

// 保存
saveBtn.addEventListener('click', () => {
  const provider = providerSelect.value;
  const baseUrl = baseUrlInput.value.trim();
  const apiKey = apiKeyInput.value.trim();
  const model = PROVIDERS[provider].models.length > 0
    ? modelSelect.value
    : modelCustomInput.value.trim();
  const apiFormat = provider === 'custom' ? apiFormatSelect.value : 'openai';

  if (!apiKey) {
    showStatus('请输入 API Key', 'error');
    return;
  }
  if (!baseUrl) {
    showStatus('请输入 API 地址', 'error');
    return;
  }
  if (!model) {
    showStatus('请选择或输入模型名称', 'error');
    return;
  }

  chrome.storage.local.set({ provider, baseUrl, apiKey, model, apiFormat }, () => {
    showStatus('设置已保存', 'success');
  });
});

function showStatus(msg, type) {
  statusDiv.textContent = msg;
  statusDiv.className = `status ${type}`;
  setTimeout(() => {
    statusDiv.className = 'status hidden';
  }, 2000);
}
