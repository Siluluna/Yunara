import plugin from '../../../../lib/plugins/plugin.js';
import { config } from '#Yunara/utils/config';
import { createLogger } from '#Yunara/utils/logger';
import { notificationService } from '#Yunara/utils/master/notification';
import { NiuUpdate } from './update.js';
import { maintenanceService } from '#Yunara/utils/niu/maintenance';

const logger = createLogger('Yunara:Niu:Task');

const updateInstance = new NiuUpdate();

export class NiuTask extends plugin {
  constructor() {
    super({
      name: '咕咕牛图库定时任务',
      dsc: '负责咕咕牛图库的所有后台定时任务',
      event: 'message',
      priority: -9999,
      rule: []
    });

    this.task = [
      {
        name: '咕咕牛图库-定时更新',
        cron: '0 0 */12 * * *', 
        fnc: () => this.runScheduledUpdate(),
        log: true,
      },
      {
        name: '咕咕牛图库-临时文件清理',
        cron: '0 0 3 * * *', // 每天凌晨3点
        fnc: () => maintenanceService.cleanupTempFiles(),
        log: true,
      },
      {
        name: '咕咕牛图库-统计缓存更新',
        cron: '0 0 4 * * *', // 每天凌晨4点
        fnc: () => maintenanceService.updateRepoStatsCache(),
        log: true,
      }
    ];
    
    this._loadCronFromConfig();
  }

  async _loadCronFromConfig() {
    // 动态加载更新任务的 cron 表达式
    const updateTask = this.task.find(t => t.name.includes('定时更新'));
    if (updateTask) {
      const cronExpression = await config.get('niu.settings.UpdateCron', updateTask.cron);
      updateTask.cron = cronExpression;
      logger.info(`咕咕牛[定时更新]任务已加载，cron: ${updateTask.cron}`);
    }
  }

  async runScheduledUpdate() {
    logger.info("开始执行[定时更新]任务...");
    try {
      const { success, reportData } = await updateInstance._performUpdate();
      if (reportData.overallHasChanges || !success) {
        logger.info("检测到变更或错误，准备向主人发送报告...");
        const summary = updateInstance._generateTextReport(reportData);
        await notificationService.sendToMaster(summary);
      } else {
        logger.info("所有仓库均已是最新，无需通知。");
      }
    } catch (error) {
      logger.fatal("执行[定时更新]任务时发生顶层异常:", error);
      await notificationService.sendToMaster(`咕咕牛[定时更新]任务执行失败！\n错误: ${error.message}`);
    }
    logger.info("[定时更新]任务执行完毕。");
  }
}
