import path from "node:path";
import plugin from '../../../../lib/plugin/plugin.js';
import { git } from '#Yunara/utils/Git';
import { config } from '#Yunara/utils/Config';
import { createLogger } from '#Yunara/utils/Logger';
import { Yunara_Repos_Path } from '#Yunara/utils/Path';
import { setupManager } from './RunSetup.js';
// import { renderer } from '#Yunara/utils/Renderer'; // TODO: 待实现的渲染器服务
// import { errorHandler } from '#Yunara/utils/ErrorHandler'; // TODO: 待实现的错误处理服务
// import { notification } from '#Yunara/utils/Notification'; // TODO: 待实现的通知服务

const logger = createLogger('Yunara:GuGuNiu:Update');

export class GuGuNiuUpdate extends plugin {
  constructor() {
    super({
      name: '咕咕牛图库更新',
      dsc: '更新所有已下载的咕咕牛图库',
      event: 'message',
      priority: 50,
      rule: [
        {
          reg: /^#?更新咕咕牛$/i,
          fnc: 'UpdateTuKu',
          permission: 'master'
        }
      ]
    });

    this.task = {
      name: '咕咕牛图库定时更新',
      cron: '0 0 */12 * * *', 
      fnc: () => this.UpdateTuKu(null, true),
      log: true
    };
    this._loadCronFromConfig();
  }

  async _loadCronFromConfig() {
    const cronExpression = await config.get('guguniu.settings.UpdateCron', this.task.cron);
    this.task.cron = cronExpression;
    logger.info(`咕咕牛定时更新任务已加载，cron 表达式: ${this.task.cron}`);
  }

  UpdateTuKu = async (e = null, isScheduled = false) => {
    const startTime = Date.now();
    
    const logOrReply = (msg) => {
      // 只有在手动触发时才回复消息
      if (e && !isScheduled) {
        e.reply(msg, true);
      }
      logger.info(msg);
    };

    try {
      logOrReply("收到！开始检查所有本地仓库的更新...");

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
      const allRepos = await Promise.all(repoStatusPromises);
      const reposToUpdate = allRepos.filter(repo => repo.isDownloaded);

      if (reposToUpdate.length === 0) {
        return logOrReply("本地没有找到任何已下载的图库仓库，请先使用 `#下载咕咕牛`。");
      }

      const updatePromises = reposToUpdate.map(repo => 
        git.updateRepo({
          localPath: repo.localPath,
          branch: repo.branch,
          repoUrl: repo.url,
        }).then(result => ({ ...repo, ...result }))
         .catch(error => ({ ...repo, success: false, error }))
      );
      
      const results = await Promise.all(updatePromises);

      const updatedRepos = results.filter(r => r.success && r.hasChanges);
      const overallHasChanges = updatedRepos.length > 0;
      const overallSuccess = results.every(r => r.success);
      
      if (overallHasChanges) {
        logOrReply("检测到仓库内容有更新，开始执行文件同步...");
        await setupManager.runPostUpdateSetup(e);
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const reportData = {
          results: results,
          duration: duration,
          overallHasChanges: overallHasChanges,
          overallSuccess: overallSuccess,
      };

      // TODO: 调用渲染器生成报告图片
      // const imageBuffer = await renderer.render('update-report', reportData);
      const imageBuffer = null; // 模拟渲染失败

      if (imageBuffer) {
        if (e && !isScheduled) {
          await e.reply(imageBuffer);
        } else if (isScheduled && (overallHasChanges || !overallSuccess)) {
          logger.info("定时更新完成，检测到变更或错误，将通知主人...");
          // await notification.sendToMaster(imageBuffer);
        }
      } else {
        // 渲染失败，回退到文本模式
        const summary = this._generateTextReport(reportData);
        if (e && !isScheduled) {
            await e.reply(summary, true);
        } else if (isScheduled && (overallHasChanges || !overallSuccess)) {
            logger.info("定时更新完成（文本报告）：\n" + summary);
            // await notification.sendToMaster(summary);
        }
      }

      if (e && !isScheduled && !overallHasChanges && overallSuccess) {
        await e.reply("所有仓库均已是最新版本。", true);
      }

    } catch (error) {
      logger.fatal("执行 #更新咕咕牛 指令时发生顶层异常:", error);
      if (e && !isScheduled) {
        // await errorHandler.report(e, "更新流程", error);
        await e.reply(`更新过程中发生严重错误：${error.message}\n请检查日志！`, true);
      }
    }
    return true;
  }

  /**
   * @private
   * @description 生成纯文本的更新报告，用于渲染失败时的回退。
   */
  _generateTextReport(reportData) {
      const summary = ["咕咕牛图库更新任务完成！"];
      reportData.results.forEach(data => {
        let status = '';
        if (data.success) {
          if (data.wasForceReset) status = '本地冲突，已强制同步';
          else if (data.hasChanges) status = `更新成功 (节点: ${data.nodeName || '未知'})`;
          else status = '已是最新';
        } else {
          status = '更新失败';
          logger.error(`仓库 [${data.description}] 更新失败:`, data.error);
        }
        summary.push(`${data.hasChanges ? '✅' : '📄'} [${data.description}] ${status}`);
      });
      summary.push("--------------------");
      summary.push(`任务耗时: ${reportData.duration} 秒。`);
      return summary.join('\n');
  }
}