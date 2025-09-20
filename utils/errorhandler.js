import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createLogger } from '#Yunara/utils/logger';
import { config } from '#Yunara/utils/config';
import { renderer } from '#Yunara/utils/renderer';
import { processService } from '#Yunara/utils/process';
import { version } from '#Yunara/utils/version';
import { Yunara_Res_Path, Yunzai_Path } from '#Yunara/utils/path';
import { NiuRepository } from '#Yunara/models/niu/repository';
import { sparkService } from '#Yunara/utils/niu/spark'; 
import common from '../../../lib/common/common.js';

const logger = createLogger('Yunara:Utils:ErrorHandler');

class ErrorHandler {

  async report(e, operationName, error, context = "") {
    try {
      const reportData = this.format(operationName, error, context);
      logger.error(`[${operationName}] 操作失败:`, error.message, `\nContext: ${context}`);

      await e.reply(`[咕咕牛] 执行 ${operationName} 操作时遇到问题！正在生成诊断报告...`, true);

      const snapshot = await this._getSnapshot();
      const aiSolution = await sparkService.analyze(operationName, error, reportData.contextInfo);

      const renderData = {
        ...reportData,
        snapshot,
        aiSolution,
        pluginVersion: await version.get(),
        scaleStyleValue: `transform:scale(${(await config.get('niu.settings.RenderScale', 100)) / 100});`,
        yunara_res_path: `file://${Yunara_Res_Path.replace(/\\/g, '/')}/`
      };

      const templatePath = path.join(Yunara_Res_Path, 'common', 'html', 'error_report.html');
      const imageBuffer = await renderer.render({
        templatePath,
        data: renderData
      });

      if (imageBuffer) {
        await e.reply(imageBuffer);
      } else {
        throw new Error("渲染错误报告图片返回空 Buffer。");
      }
    } catch (reportError) {
      logger.error("生成主错误报告失败，将使用纯文本回退:", reportError);
      const fallbackReport = this.format(operationName, error, context);
      const fallbackMsg = [
        `**${fallbackReport.summary}**`,
        `**可能原因与建议**\n${fallbackReport.suggestions}`
      ].join('\n\n');
      await e.reply(fallbackMsg, true);
    }
  }

  format(operationName, error, context = "") {
    const report = {
      operationName,
      errorMessage: error?.message || "未知错误信息",
      errorCode: error?.code || "N/A",
      contextInfo: context || "（无额外上下文信息）",
      suggestions: "",
      stack: error?.stack || "（无调用栈信息）",
    };

    const errorString = `${error?.message} ${error?.stderr} ${error?.code} ${context}`.toLowerCase();
    const errorTypes = {
      NETWORK: /timeout|econnreset|403|404|ssl|resolve host|fetch/i,
      GIT: /git|clone|pull|authentication|permission|lock file|unrelated histories/i,
      FILESYSTEM: /eacces|eperm|ebusy|enoent/i,
      CONFIG: /json.parse|yaml.parse/i,
      CODE: /referenceerror|typeerror/i,
    };

    let detectedType = Object.keys(errorTypes).find(type => errorTypes[type].test(errorString)) || 'CODE';
    
    const suggestionsMap = {
        NETWORK: ["- **首要建议**：执行 `#咕咕牛测速` 命令，诊断所有网络节点的实时状况。", "- 请检查服务器网络连接、DNS设置以及防火墙规则。"],
        GIT: ["- 如果提示冲突，请尝试执行 `#更新咕咕牛`，新版逻辑会自动尝试强制同步。", "- 严重损坏时，可能需要执行 `#重置咕咕牛`。"],
        FILESYSTEM: ["- **权限问题**：请检查 Yunzai-Bot 目录及所有插件相关目录的文件/文件夹权限。", "- **文件占用**：如果提示文件繁忙 (EBUSY)，请稍后再试。"],
        CONFIG: ["- **配置文件损坏**：请检查 `/config` 目录下的 `.yaml` 文件是否存在语法错误。", "- 可以尝试删除损坏的配置文件，然后重启机器人让插件生成默认配置。"],
        CODE: ["- **插件内部错误**：这通常是插件代码本身的Bug。请将此错误报告完整截图，并反馈给开发者。"]
    };
    report.suggestions = suggestionsMap[detectedType].join('\n');

    if (error?.stdout || error?.stderr) {
      report.contextInfo += `\n\n--- 命令输出 ---\n[stdout]:\n${error.stdout}\n[stderr]:\n${error.stderr}`;
    }
    return report;
  }

  /**
   * @private
   * @description 获取系统快照信息
   */
  async _getSnapshot() {
    const snapshot = { git: {}, system: {} };
    const coreRepo = await NiuRepository.getCoreRepository();

    if (coreRepo && await coreRepo.isDownloaded()) {
      try {
        const [sha, branch] = await Promise.all([
          processService.execute({ command: "git", args: ["rev-parse", "--short=10", "HEAD"], options: { cwd: coreRepo.localPath } }).then(r => r.stdout.trim()),
          processService.execute({ command: "git", args: ["rev-parse", "--abbrev-ref", "HEAD"], options: { cwd: coreRepo.localPath } }).then(r => r.stdout.trim())
        ]);
        snapshot.git = { sha, branch };
      } catch (err) { snapshot.git = { error: '获取Git信息失败' }; }
    }

    try {
      const yunzaiPkg = JSON.parse(await fs.readFile(path.join(Yunzai_Path, 'package.json'), 'utf-8'));
      snapshot.system = {
        node: process.version,
        platform: os.platform(),
        yunzai: `${yunzaiPkg.name} ${yunzaiPkg.version || ''}`.trim()
      };
    } catch (err) { snapshot.system = { error: '获取系统信息失败' }; }

    return snapshot;
  }
}

export const errorHandler = new ErrorHandler();