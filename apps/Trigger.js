import plugin from '../../../../lib/plugin/plugin.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import lodash from 'lodash';
import { createLogger } from '#yunara/utils/logger';
import { renderer } from '#yunara/utils/Renderer';
import { Yunara_Res_Path } from '#yunara/utils/path';

const logger = createLogger('Yunara:Apps:Trigger');

let TRIGGERABLE_ITEMS = [];
try {
    const content = await fs.readFile(path.join(Yunara_Res_Path, 'common', 'Triggers.json'), 'utf-8');
    TRIGGERABLE_ITEMS = JSON.parse(content);
} catch (error) {
    logger.error("加载 Triggers.json 失败:", error);
}

export class YunaraTrigger extends plugin {
  constructor() {
    super({
      name: '云露开发触发器',
      dsc: '用于开发和测试 Yunara 功能的内部指令',
      event: 'message',
      priority: 1000,
      rule: [
        {
          reg: /^#?云露触发(?:\s*([a-zA-Z0-9_-]+))?/i,
          fnc: 'Trigger',
          permission: 'master'
        }
      ]
    });
  }

  async Trigger(e) {
    const match = e.msg.match(/^#?云露触发(?:\s*([a-zA-Z0-9_-]+))?/i);
    const triggerInput = match?.[1]?.trim() || "";

    let itemToTrigger = null;
    if (triggerInput) {
      itemToTrigger = TRIGGERABLE_ITEMS.find(item => String(item.id) === triggerInput);
    }

    if (itemToTrigger) {
      await e.reply(`[云露触发器] 正在模拟: [${itemToTrigger.id}] ${itemToTrigger.name}...`, true);
      try {
        await this.runSimulation(e, itemToTrigger);
      } catch (error) {
        logger.error(`执行模拟 [${itemToTrigger.name}] 失败:`, error);
        await e.reply(`模拟执行失败: ${error.message}`);
      }
    } else {
      await this.showHelp(e);
    }
    return true;
  }

  async runSimulation(e, item) {
    switch (item.type) {
      case 'SIM_TPL_DL_REPORT_SUCCESS':
        await this.simulateDownloadReport(e);
        break;
      default:
        await e.reply("该类型的模拟暂未实现。");
        break;
    }
  }

  async simulateDownloadReport(e) {
    const renderData = {
      results: [
        { text: '下载成功', statusClass: 'status-ok', nodeName: 'Ghfast', description: '一号仓库 (核心)' },
        { text: '已存在', statusClass: 'status-local', nodeName: '本地', description: '二号仓库 (原神)' },
        { text: '下载成功', statusClass: 'status-ok', nodeName: 'GhproxyGo', description: '三号仓库 (星铁)' },
        { text: '下载成功', statusClass: 'status-ok', nodeName: 'Mirror', description: '四号仓库 (鸣潮&绝区零)' },
      ],
      successCount: 4,
      totalConfigured: 4,
      successRate: 100,
      successRateRounded: 100,
      overallSuccess: true,
      duration: '12.3',
      pluginVersion: '3.1-dev',
      scaleStyleValue: `transform:scale(1); transform-origin: top left;`,
      yunara_res_path: `file://${Yunara_Res_Path.replace(/\\/g, '/')}/`
    };

    const templatePath = path.join(Yunara_Res_Path, 'Gallery/GuGuNiu/html/download/download.html');
    const imageBuffer = await renderer.render({
        templatePath: templatePath,
        data: renderData,
    });

    if (imageBuffer) {
      await e.reply(imageBuffer);
    } else {
      await e.reply("模拟报告渲染失败，请查看日志。");
    }
  }

  async showHelp(e) {
    const grouped = lodash.groupBy(TRIGGERABLE_ITEMS, 'category');
    const categoryMap = {
      "核心图片报告模拟": { en_name: "CORE REPORT SIMULATIONS", className: "report" },
    };
    const categoryOrder = Object.keys(categoryMap);
    const categoriesForRender = categoryOrder
      .filter(key => grouped[key])
      .map(key => ({
        name: key,
        en_name: categoryMap[key]?.en_name || "GENERAL",
        className: categoryMap[key]?.className || "logic",
        items: grouped[key]
      }));

    const renderData = {
      pluginVersion: '3.1-dev',
      scaleStyleValue: `transform:scale(1); transform-origin: top left;`,
      categories: categoriesForRender,
      guguniu_res_path: `file://${Yunara_Res_Path.replace(/\\/g, '/')}/`
    };
    
    const templatePath = path.join(Yunara_Res_Path, 'common/html/trigger_list.html');
    const imageBuffer = await renderer.render({
        templatePath: templatePath,
        data: renderData,
    });

    if (imageBuffer) {
      await e.reply(imageBuffer);
    } else {
      await e.reply("触发器帮助列表渲染失败，请查看日志。");
    }
  }
}
