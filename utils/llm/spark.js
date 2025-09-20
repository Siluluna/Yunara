import { createLogger } from '#Yunara/utils/logger';

const logger = createLogger('Yunara:Niu:SparkService');

class SparkService {

  _getCredentials() {
    try {
      const store = {
        AppleComeBack: "eHhnWEtxcHFVdm9ZWUF0RFNtU1Y6d0tYS1VSSUd5eHBDaXdGbGxiYXo="
      };
      return Buffer.from(store.AppleComeBack, 'base64').toString('utf8');
    } catch (e) {
      logger.error("解码星火 API 凭证失败:", e);
      return "";
    }
  }

  async analyze(operationName, error, context) {
    const credentials = this._getCredentials();
    if (!credentials) {
      return "云露分析失败：内部密钥处理异常。";
    }

    const url = "https://spark-api-open.xf-yun.com/v2/chat/completions";
    const prompt = this._buildPrompt(operationName, error, context);

    const requestBody = {
      model: "x1",
      messages: [{ role: "user", content: prompt }],
      stream: false,
      max_tokens: 150,
      temperature: 0.5,
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${credentials}`
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.error(`星火 API 请求失败，状态码: ${response.status}`);
        throw new Error(`API 请求失败 (HTTP ${response.status})`);
      }

      const responseData = await response.json();

      if (responseData.error || responseData.code !== 0) {
        const errMsg = responseData.error?.message || responseData.message || '未知API错误';
        logger.error(`星火 API 返回错误: ${errMsg}`);
        return `云露分析异常：API 返回错误 (${errMsg})。`;
      }

      let aiContent = responseData.choices?.[0]?.message?.content;
      if (typeof aiContent === 'string' && aiContent.trim() !== '') {
        return this._formatResponse(aiContent);
      } else {
        logger.warn("星火 API 成功返回，但内容为空。");
        return "云露分析异常：API 成功响应，但未返回有效解决方案。";
      }

    } catch (aiError) {
      if (aiError.name === 'AbortError') {
        logger.error("星火 API 请求超时。");
        return "云露分析失败：服务连接超时。";
      }
      logger.error("调用星火 API 时发生未知网络异常:", aiError);
      return "云露分析失败：网络异常。";
    }
  }

  _buildPrompt(operationName, error, context) {
    return `你是一位名为“云露”的AI诊断专家，深度集成于“Yunzai-Bot”的“咕咕牛图库管理器”插件中。你的职责是精准分析错误，并提供层次分明、高度相关的解决方案。

    **诊断思维框架：**

    **第一步：识别错误类型，并构建“核心原因”**
    *   **配置错误**: 如果细节包含 \`YAML.parse\`，核心原因：\`GuGuNiu-Gallery/GalleryConfig.yaml\` 配置文件存在语法错误。
    *   **数据错误**: 如果细节包含 \`JSON.parse\`，核心原因：\`GuGuNiu-Gallery/ImageData.json\` 或 \`banlist.json\` 数据文件格式损坏。
    *   **网络/Git问题**: 如果细节包含 \`ETIMEDOUT\`, \`Git\`, \`clone\`, \`pull\`，核心原因：在执行“<操作名称>”时，网络连接超时或Git仓库访问失败。
    *   **文件权限问题**: 如果细节包含 \`EACCES\`, \`EPERM\`，核心原因：插件在执行“<操作名称>”时，缺少对相关目录的文件读写权限。
    *   **文件/路径丢失**: 如果细节包含 \`ENOENT\`，核心原因：在执行“<操作名称>”时，找不到必要的文件或目录。
    *   **其他内部或未知错误**: 如 \`ReferenceError\`，核心原因：插件在执行“<操作名称>”时发生内部逻辑错误（例如调用了未定义的变量）。

    **第二步：基于错误类型，构建四层解决方案**
    *   **配置/数据错误**:
        1.  明确指出是哪个配置文件（如 \`GalleryConfig.yaml\`）存在语法问题。
        2.  引导用户检查文件的格式（如缩进、括号、引号）。
        3.  建议使用 \`#重置咕咕牛\` 命令来恢复默认配置。
        4.  提醒若问题持续，可联系开发者。
    *   **网络/Git错误**:
        1.  核心原因直接判定为网络访问超时或Git仓库连接失败。
        2.  首选方案是执行 \`#咕咕牛测速\` 来诊断网络节点。
        3.  其次是提醒检查系统代理或防火墙设置。
        4.  最终方案是使用 \`#重置咕咕牛\` 并重新下载。
    *   **其他所有错误**:
        1.  **日志分析**: 首选方案是使用 \`#日志\` 命令查看错误的详细上下文。
        2.  **尝试重置**: 引导用户尝试执行 \`#重置咕咕牛\` 以恢复插件初始状态。
        3.  **重启服务**: 建议重启Yunzai-Bot程序，以排除缓存或临时状态导致的问题。
        4.  **最终求助**: 引导用户联系开发者并提供完整的错误报告截图。

    **输出规则：**
    *   **格式**: 必须严格遵循“**核心原因**”和“**解决方案**”的格式。
    *   **Markdown**: 必须使用 \`**...**\` 来为标题加粗。
    *   **语言**: 专业、自信、直接，避免客套。总字数控制在120字左右。

    **待分析的错误信息：**
    - 操作: ${operationName}
    - 细节: ${error.message || 'N/A'} (代码: ${error.code || 'N/A'})
    - 上下文: ${context || '无'}`;
  }

  _formatResponse(content) {
    return content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }
}

export const sparkService = new SparkService();