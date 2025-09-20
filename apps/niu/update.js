import plugin from '../../../../lib/plugins/plugin.js';
import { NiuRepository } from '#Yunara/models/niu/repository';
import { createLogger } from '#Yunara/utils/logger';
import { setupManager } from './runsetup.js';
import { notificationService } from '#Yunara/utils/master/notification';
import common from '../../../../lib/common/common.js';

const logger = createLogger('Yunara:Niu:Update');

export class NiuUpdate extends plugin {
  constructor() {
    super({
      name: '咕咕牛图库更新',
      dsc: '手动更新所有已下载的咕咕牛图库',
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
  }

  UpdateTuKu = async (e) => {
    try {
      await e.reply("收到！开始检查所有本地仓库的更新...", true);
      
      const { success, reportData } = await this._performUpdate();

      if (success) {
        const summary = this._generateTextReport(reportData);
        await e.reply(summary, true);
        
        if (!reportData.overallHasChanges) {
            await e.reply("所有仓库均已是最新版本。", true);
        }
      } else {
        await e.reply("更新过程中遇到问题，请检查日志！", true);
      }

    } catch (error) {
      logger.fatal("执行 #更新咕咕牛 指令时发生顶层异常:", error);
      await e.reply(`更新过程中发生严重错误：${error.message}\n请检查日志！`, true);
    }
    return true;
  }

  async _performUpdate() {
    const startTime = Date.now();
    
    const reposToUpdate = await GuGuNiuRepository.getDownloaded();
    if (reposToUpdate.length === 0) {
      logger.warn("未找到任何已下载的仓库，更新任务中止。");
      return { success: true, reportData: { results: [], overallHasChanges: false, startTime } };
    }

    logger.info(`检测到 ${reposToUpdate.length} 个仓库，开始执行更新...`);

    const updatePromises = reposToUpdate.map(repo => repo.update());
    const settledResults = await Promise.allSettled(updatePromises);
    const results = settledResults.map(res => 
      res.status === 'fulfilled' ? res.value : { success: false, error: res.reason, description: res.reason?.description || '未知仓库' }
    );

    const updatedRepos = results.filter(r => r.success && (r.hasChanges || r.wasForceReset));
    const overallHasChanges = updatedRepos.length > 0;
    const overallSuccess = results.every(r => r.success);
    
    if (overallHasChanges) {
      logger.info("检测到仓库内容有更新，开始执行文件同步...");
      await setupManager.runPostUpdateSetup(null); 
    }

    const reportData = {
        results,
        overallHasChanges,
        overallSuccess,
        startTime
    };

    return { success: overallSuccess, reportData };
  }


  _generateTextReport(reportData) {
      const duration = ((Date.now() - reportData.startTime) / 1000).toFixed(1);
      const summary = [`咕咕牛图库更新报告 (耗时: ${duration} 秒)`];
      summary.push("--------------------");
      
      reportData.results.forEach(data => {
        let status = '';
        const icon = data.success ? (data.hasChanges || data.wasForceReset ? '✅' : '📄') : '❌';

        if (data.success) {
          if (data.wasForceReset) status = '本地冲突，已强制同步';
          else if (data.hasChanges) status = `更新成功 (节点: ${data.nodeName || '标准'})`;
          else status = '已是最新';
        } else {
          status = `更新失败: ${data.error?.message?.split('\n')[0] || '未知错误'}`;
        }
        summary.push(`${icon} [${data.description}] ${status}`);
      });
      return summary.join('\n');
  }
}
