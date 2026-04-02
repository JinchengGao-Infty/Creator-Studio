/**
 * 快速配置状态管理
 *
 * 简化 AI 配置流程，用户只需输入 API Key
 */

import { create } from "zustand";
import { message } from "antd";
import {
  detectProvider,
  getPresetById,
  type ProviderPreset,
} from "../providerPresets";
import {
  type Provider,
  type ModelParameters,
  getConfig,
  addProvider,
  setActiveProvider,
  setDefaultParameters,
} from "../../../platform/tauri/client";

function emitConfigChanged(): void {
  window.dispatchEvent(new CustomEvent("creatorai:globalConfigChanged"));
}

interface QuickConfigState {
  // 输入状态
  apiKey: string;
  selectedPresetId: string;
  selectedModel: string;
  customBaseUrl: string;
  isRememberMe: boolean;

  // 检测状态
  detectedPreset: ProviderPreset | null;
  isDetecting: boolean;

  // 加载状态
  isLoading: boolean;
  error: string | null;

  // Actions
  setApiKey: (key: string) => void;
  setSelectedPreset: (id: string) => void;
  setSelectedModel: (model: string) => void;
  setCustomBaseUrl: (url: string) => void;
  setIsRememberMe: (remember: boolean) => void;

  // 业务 Actions
  quickSetup: () => Promise<boolean>;
  reset: () => void;
}

export const useQuickConfigStore = create<QuickConfigState>((set, get) => ({
  // 初始状态
  apiKey: "",
  selectedPresetId: "deepseek",
  selectedModel: "deepseek-chat",
  customBaseUrl: "",
  isRememberMe: true,
  detectedPreset: null,
  isDetecting: false,
  isLoading: false,
  error: null,

  setApiKey: (key) => {
    set({ apiKey: key, isDetecting: true });

    // 防抖检测
    setTimeout(() => {
      const preset = detectProvider(key);
      if (preset) {
        set({
          detectedPreset: preset,
          isDetecting: false,
          selectedPresetId: preset.id,
          selectedModel: preset.recommendedModels[0] || "",
        });
      } else {
        set({
          detectedPreset: null,
          isDetecting: false,
        });
      }
    }, 300);
  },

  setSelectedPreset: (id) => {
    const preset = getPresetById(id);
    set({
      selectedPresetId: id,
      selectedModel: preset?.recommendedModels[0] || "",
      customBaseUrl: preset?.baseUrl || "",
    });
  },

  setSelectedModel: (model) => set({ selectedModel: model }),
  setCustomBaseUrl: (url) => set({ customBaseUrl: url }),
  setIsRememberMe: (remember) => set({ isRememberMe: remember }),

  quickSetup: async () => {
    const { selectedPresetId, apiKey, selectedModel, customBaseUrl, isRememberMe } =
      get();

    // 验证输入
    const preset = getPresetById(selectedPresetId);
    if (!preset) {
      set({ error: "请选择服务商" });
      return false;
    }

    // 检查是否需要 API Key
    const needsApiKey = preset.id !== "ollama";
    if (needsApiKey && !apiKey) {
      set({ error: "请输入 API Key" });
      return false;
    }

    if (!selectedModel) {
      set({ error: "请选择模型" });
      return false;
    }

    if (preset.id === "custom" && !customBaseUrl) {
      set({ error: "请输入 API 地址" });
      return false;
    }

    set({ isLoading: true, error: null });

    try {
      const baseUrl = preset.id === "custom" ? customBaseUrl : preset.baseUrl;

      // 构建 Provider 配置
      // All API key types stored via OS keyring, not in headers
      const provider: Provider = {
        id: `provider_${Date.now()}`,
        name: preset.name,
        base_url: baseUrl,
        provider_type: preset.providerType,
        headers: undefined,
        models: [],
        models_updated_at: null,
      };

      // 调用后端添加 Provider
      await addProvider(provider, needsApiKey ? apiKey : "");

      // 如果是记住我，设为默认
      if (isRememberMe) {
        await setActiveProvider(provider.id);
        await setDefaultParameters({
          model: selectedModel,
          temperature: 0.7,
          top_p: 0.9,
          top_k: null,
          max_tokens: 2000,
        } as ModelParameters);
      }

      // 发送配置变更事件
      emitConfigChanged();

      set({ isLoading: false });
      message.success(`${preset.name} 配置成功！`);

      // 重置表单
      get().reset();

      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({
        isLoading: false,
        error: errorMsg,
      });
      message.error(`配置失败: ${errorMsg}`);
      return false;
    }
  },

  reset: () =>
    set({
      apiKey: "",
      selectedPresetId: "deepseek",
      selectedModel: "deepseek-chat",
      customBaseUrl: "",
      detectedPreset: null,
      error: null,
    }),
}));

/**
 * 检查当前是否有有效的 AI 配置
 */
export async function checkHasValidConfig(): Promise<{
  hasConfig: boolean;
  providerName?: string;
  model?: string;
}> {
  try {
    const config = await getConfig();
    if (config.active_provider_id && config.default_parameters.model) {
      const provider = config.providers.find(
        (p) => p.id === config.active_provider_id
      );
      return {
        hasConfig: true,
        providerName: provider?.name,
        model: config.default_parameters.model,
      };
    }
    return { hasConfig: false };
  } catch {
    return { hasConfig: false };
  }
}
