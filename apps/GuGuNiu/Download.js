import path from "node:path";
import plugin from '../../../../lib/plugins/plugin.js';
import { version } from '#Yunara/utils/Version';
import { GuGuNiuRepository } from '#Yunara/models/GuGuNiu/Repository';
import { config } from '#Yunara/utils/Config';
import { createLogger } from '#Yunara/utils/Logger';
import { renderer } from '#Yunara/utils/Renderer';
import { Yunara_Res_Path } from '#Yunara/utils/Path';
import { setupManager } from './RunSetup.js';

const logger = createLogger('Yunara:GuGuNiu:Download');

export class GuGuNiuDownload extends plugin {
  constructor() {
    super({
      name: '咕咕牛图库下载',
      dsc: '下载咕咕牛图库',
      event: 'message',
      priority: 50,
      rule: [
        {
          reg: /^#?下载咕咕牛$/i,
          fnc: 'DownloadTuKu',
          permission: 'master'
        }
      ]
    });
  }

  DownloadTuKu = async (e) => {
    const startTime = Date.now();
    const commandName = "DownloadTuKu";
    const cooldownKey = `Yunara:GuGuNiu:${commandName}:${e.user_id}`;51
    const cooldownSeconds = 120;

    try {
      const ttl = await redis.ttl(cooldownKey);
      if (ttl > 0) {
        return e.reply(`该指令冷却中，剩余 ${ttl} 秒`, true);
      }
      await redis.set(cooldownKey, '1', { EX: cooldownSeconds });

      await e.reply("收到！正在获取最新配置并检查本地仓库状态...", true);

      const allRepos = await GuGuNiuRepository.getAll();
      if (allRepos.length === 0) {
        throw new Error("图库仓库配置 (GuGuNiu/Gallery.yaml) 缺失或为空");
      }

      const downloadedChecks = await Promise.all(allRepos.map(repo => repo.isDownloaded()));
      const reposToDownload = allRepos.filter((_, index) => !downloadedChecks[index]);

      if (reposToDownload.length === 0) {
        await redis.del(cooldownKey);
        return e.reply("所有已配置的图库均已存在于本地，无需下载", true);
      }

      await e.reply(`检测到 ${reposToDownload.length} 个新仓库需要下载，任务已在后台开始...`, true);

      const progressTracker = {};
      reposToDownload.forEach(repo => {
        progressTracker[repo.description] = { percent: 0, status: '等待中...', lastLoggedPercent: -1 };
      });

      const downloadPromises = reposToDownload.map(repo => {
        progressTracker[repo.description].status = '下载中...';
        const callbacks = {
          onProgress: (percent, resetTimeoutFn) => {
            progressTracker[repo.description].percent = percent;
            if (percent >= progressTracker[repo.description].lastLoggedPercent + 5) {
              logger.info(`下载进度: ${repo.description}: ${percent}%`);
              progressTracker[repo.description].lastLoggedPercent = percent;
            }
            if (resetTimeoutFn) resetTimeoutFn();
          }
        };
        return repo.download(callbacks)
         .catch(error => ({ ...repo, success: false, error }));
      });

      const results = await Promise.all(downloadPromises);
      
      const successfulDownloads = results.filter(r => r.success);
      if (successfulDownloads.length > 0) {
        await e.reply("仓库下载完成，开始执行安装设置与文件同步...", true);
        await setupManager.runPostDownloadSetup(e);
      }

      await this._renderFinalReport(e, results, allRepos, startTime);

    } catch (error) {
      logger.fatal("执行 #下载咕咕牛 指令时发生顶层异常:", error);
      await e.reply(`下载过程中发生严重错误：${error.message}\n请检查日志！`, true);
    } finally {
      await redis.del(cooldownKey);
    }
    return true;
  }

  async _renderFinalReport(e, downloadResults, allRepos, startTime) {
    const totalConfigured = allRepos.length;
    const successfulNewDownloadsCount = downloadResults.filter(r => r.success).length;
    const newDownloadsCount = downloadResults.length;
    const preExistingCount = totalConfigured - newDownloadsCount;
    const totalSuccessCount = successfulNewDownloadsCount + preExistingCount;
    
    const overallSuccess = successfulNewDownloadsCount === newDownloadsCount;
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const settings = await config.get('guguniu.settings') || {};

    const reportResults = allRepos.map(repo => {
        const downloadInfo = downloadResults.find(r => r.id === repo.id);
        if (downloadInfo) {
            return {
                text: downloadInfo.success ? '下载成功' : '下载失败',
                statusClass: downloadInfo.success ? 'status-ok' : 'status-fail',
                nodeName: downloadInfo.nodeName || 'N/A',
                description: repo.description,
            };
        } else {
            return {
                text: '已存在',
                statusClass: 'status-local',
                nodeName: '本地',
                description: repo.description,
            };
        }
    });

    const renderData = {
      results: reportResults,
      successCount: totalSuccessCount,
      totalConfigured: totalConfigured,
      successRate: totalConfigured > 0 ? Math.round((totalSuccessCount / totalConfigured) * 100) : 0,
      successRateRounded: totalConfigured > 0 ? Math.round((totalSuccessCount / totalConfigured) * 100) : 0,
      overallSuccess: overallSuccess,
      duration: duration,
      pluginVersion: await version.get(),
      scaleStyleValue: `transform:scale(${ (settings.RenderScale || 100) / 100 }); transform-origin: top left;`,
      yunara_res_path: `file://${Yunara_Res_Path.replace(/\\/g, '/')}/`
    };

    const templatePath = path.join(Yunara_Res_Path, 'Gallery', 'GuGuNiu', 'html', 'download', 'download.html');
    
    try {
        const imageBuffer = await renderer.render({
            templatePath: templatePath,
            data: renderData,
        });

        if (imageBuffer) {
            await e.reply(imageBuffer);
        } else {
            throw new Error("渲染器返回了空的 Buffer");
        }
    } catch (renderError) {
        logger.error("下载报告渲染失败:", renderError);
        await e.reply("下载报告图片生成失败，请查看控制台日志");
    }
  }
}