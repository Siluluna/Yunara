import os from 'node:os';
import nodeProcess from 'node:process';
import { createLogger } from '#Yunara/utils/logger';
import { config } from '#Yunara/utils/config';
import { notificationService } from '#Yunara/utils/master/notification';
import common from '../../../../lib/common/common.js';
import { filesize } from 'filesize';

const logger = createLogger('Yunara:Niu:HealthService');

const LOAD_LEVEL_CONFIG = {
  1: { thresholds: { cpu: 75, mem: 80 }, logic: 'OR' },
  2: { thresholds: { cpu: 60, mem: 70 }, logic: 'OR' },
  3: { thresholds: { cpu: 50, mem: 60 }, logic: 'AND' }
};

class HealthService {
  #autoSwitchLock = false;

  /**
   * @public
   * @description  检查系统健康状况，并在必要时暂停
   * @returns {Promise<boolean>} true 表示系统健康可继续，false 表示系统繁忙已暂停
   */
  async check(e) {
    const settings = await config.get('niu.settings');
    if (settings?.ExecutionMode !== 'Serial') {
      return true; // 非低负载模式，直接放行
    }

    const level = settings.LoadLevel || 1;
    const policy = LOAD_LEVEL_CONFIG[level] || LOAD_LEVEL_CONFIG[1];
    const { cpu: cpuThreshold, mem: memThreshold, logic } = policy.thresholds;

    try {
      const currentCpuUsage = await this._getCpuUsage();
      const totalMemory = os.totalmem();
      const currentRss = nodeProcess.memoryUsage().rss;
      const memUsagePercent = (currentRss / totalMemory) * 100;

      const isOverloaded = logic === 'OR'
        ? currentCpuUsage > cpuThreshold || memUsagePercent > memThreshold
        : currentCpuUsage > cpuThreshold && memUsagePercent > memThreshold;

      if (isOverloaded) {
        const waitSeconds = 5 + Math.floor(Math.random() * 5);
        const message = `[咕咕牛] 检测到系统高负载！\nCPU: ${currentCpuUsage.toFixed(1)}%, 内存: ${filesize(currentRss)}\n为防止机器人崩溃，处理已暂停 ${waitSeconds} 秒...`;
        
        logger.warn(message.replace(/\n/g, ' '));
        if (e && e.reply) await e.reply(message, true);

        await common.sleep(waitSeconds * 1000);
        if (global.gc) global.gc();

        // 检查是否达到极端负载并自动切换模式
        await this._handleExtremeOverload(currentCpuUsage, memUsagePercent);
        return false;
      }
      return true;
    } catch (err) {
      logger.error("系统健康检查时发生错误:", err);
      return true; // 出错时默认放行
    }
  }

  async _getCpuUsage() {
    return new Promise(resolve => {
      const startUsage = nodeProcess.cpuUsage();
      setTimeout(() => {
        const endUsage = nodeProcess.cpuUsage(startUsage);
        const totalCpuTime = (endUsage.user + endUsage.system) / 1000; // ms
        resolve((totalCpuTime / 500) * 100); // 500ms 间隔内的 CPU 使用率
      }, 500);
    });
  }

  async _handleExtremeOverload(cpu, mem) {
    const extremePolicy = LOAD_LEVEL_CONFIG[3].thresholds;
    if (!this.#autoSwitchLock && cpu > extremePolicy.cpu && mem > extremePolicy.mem) {
      this.#autoSwitchLock = true; // 加锁，防止重复触发
      await config.set('niu.settings.ExecutionMode', 'Batch');
      
      const switchMsg = "[咕咕牛] 检测到持续极端高负载！为保护系统，已自动切换回高速并发模式。该模式将在重启后或手动设置后恢复。";
      logger.fatal(switchMsg);
      await notificationService.sendToMaster(switchMsg);
    }
  }
}

export const healthService = new HealthService();