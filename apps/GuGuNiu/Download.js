import path from "node:path";
import lodash from "lodash";
import plugin from '../../../../lib/plugins/plugin.js';
import common from '../../../../lib/common/common.js';
import { git } from '#Yunara/utils/Git';
import { config } from '#Yunara/utils/Config';
import { createLogger } from '#Yunara/utils/Logger';
import { Yunara_Repos_Path } from '#Yunara/utils/Path';
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
    const commandName = "DownloadTuKu";
    const cooldownKey = `Yunara:GuGuNiu:${commandName}:${e.user_id}`;
    const cooldownSeconds = 120;

    try {
      const ttl = await redis.ttl(cooldownKey);
      if (ttl > 0) {
        return e.reply(`该指令冷却中，剩余 ${ttl} 秒。`, true);
      }
      await redis.set(cooldownKey, '1', { EX: cooldownSeconds });

      await e.reply("收到！正在获取最新配置并检查本地仓库状态...", true);

      const galleryConfig = await config.get('guguniu.gallery');
      if (!galleryConfig || !Array.isArray(galleryConfig.repositories)) {
        throw new Error("图库仓库配置 (GuGuNiu/Gallery.yaml) 缺失或格式错误。");
      }

      const repoStatusPromises = galleryConfig.repositories.map(async (repo) => {
        const repoName = path.basename(new URL(repo.url).pathname, '.git');
        const localPath = path.join(Yunara_Repos_Path, repoName);
        const isDownloaded = await git.isRepoDownloaded(localPath);
        return { ...repo, localPath, isDownloaded };
      });
      const reposToProcess = await Promise.all(repoStatusPromises);
      const reposToDownload = reposToProcess.filter(repo => !repo.isDownloaded);

      if (reposToDownload.length === 0) {
        await redis.del(cooldownKey);
        return e.reply("所有已配置的图库均已存在于本地，无需下载。", true);
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
              const progressMsg = `${repo.description}: ${percent}%`;
              logger.info(`下载进度: ${progressMsg}`);
              progressTracker[repo.description].lastLoggedPercent = percent;
            }
            // TODO: 未来通过事件总线将实时进度发送给 WebUI
            // eventBus.emit('download:progress', { repo: repo.description, percent });

            if (resetTimeoutFn) resetTimeoutFn();
          }
        };

        return git.cloneRepo({
          repoUrl: repo.url,
          localPath: repo.localPath,
          branch: repo.branch,
          callbacks: callbacks,
        }).then(result => ({ ...repo, ...result }))
         .catch(error => ({ ...repo, success: false, error }));
      });

      const results = await Promise.all(downloadPromises);
      
      const successfulDownloads = results.filter(r => r.success);
      if (successfulDownloads.length > 0) {
        await e.reply("仓库下载完成，开始执行安装设置与文件同步...", true);
        await setupManager.runPostDownloadSetup(e, successfulDownloads);
      }

      let successCount = 0;
      const summary = ["咕咕牛图库下载任务完成！"];
      results.forEach(data => {
        if (data.success) {
          summary.push(`✅ [${data.description}] 成功 (节点: ${data.nodeName})`);
          successCount++;
        } else {
          summary.push(`❌ [${data.description}] 失败`);
          logger.error(`仓库 [${data.description}] 下载失败:`, data.error);
        }
      });
      summary.push("--------------------");
      summary.push(`总结: ${successCount} / ${reposToDownload.length} 个仓库成功。`);
      await e.reply(await common.makeForwardMsg(e, summary, '下载报告'));

      if (successCount === reposToDownload.length) {
        await e.reply("所有新仓库均已下载并部署成功！", true);
      } else if (successCount > 0) {
        await e.reply("部分仓库下载成功并已部署。请检查报告了解失败详情。", true);
      } else {
        await e.reply("所有下载任务均失败，请检查控制台日志获取详细错误信息。", true);
      }

    } catch (error) {
      logger.fatal("执行 #下载咕咕牛 指令时发生顶层异常:", error);
      await e.reply(`下载过程中发生严重错误：${error.message}\n请检查日志！`, true);
    } finally {
      await redis.del(cooldownKey);
    }
    return true;
  }
}