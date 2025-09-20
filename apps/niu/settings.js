import path from 'node:path';
import plugin from '../../../../lib/plugins/plugin.js';
import { config } from '#Yunara/utils/config';
import { createLogger } from '#Yunara/utils/logger';
import { setupManager } from './runsetup.js';
import { Yunzai_Path, Yunara_Res_Path } from '#Yunara/utils/path';
import { renderer } from '#Yunara/utils/renderer';
import { version } from '#Yunara/utils/version';

const logger = createLogger('Yunara:Niu:Settings');

const SETTINGS_SCHEMA = {
  "guguniu.settings.TuKuOP": {
    type: "boolean",
    aliases: ["图库开关"],
    affectsFileSync: true,
  },
  "guguniu.settings.Filter.Ai": {
    type: "boolean",
    aliases: ["ai", "ai图"],
    affectsFileSync: true,
  },
  "guguniu.settings.Filter.EasterEgg": {
    type: "boolean",
    aliases: ["彩蛋图"],
    affectsFileSync: true,
  },
  "guguniu.settings.Filter.Layout": {
    type: "boolean",
    aliases: ["横屏图", "layout"],
    affectsFileSync: true,
  },
  "guguniu.settings.SleeperAgentSwitch": {
    type: "boolean",
    aliases: ["原图拦截"],
  },
  "guguniu.settings.PurificationLevel": {
    type: "enum",
    aliases: ["净化等级", "pfl"],
    validValues: [0, 1, 2],
    affectsFileSync: true,
  },
  "guguniu.settings.ExecutionMode": {
    type: "enum",
    aliases: ["低负载模式", "executionmode"],
    validValues: ["Batch", "Serial"],
  },
  "guguniu.settings.LoadLevel": {
    type: "enum",
    aliases: ["负载等级", "loadlevel"],
    validValues: [1, 2, 3],
  },
  "guguniu.settings.RenderScale": {
    type: "range",
    aliases: ["渲染精度", "renderscale"],
    min: 100,
    max: 500,
  },
  // --- 补充HTML中存在的设置项 ---
  "guguniu.settings.OfficialSplashArt": {
    type: "boolean",
    aliases: ["官方立绘"],
  }
};


export class NiuSettings extends plugin {
  constructor() {
    super({
      name: "咕咕牛图库设置",
      dsc: "管理咕咕牛图库的各项设置",
      event: "message",
      priority: 50,
      rule: [
        {
          reg: /^#?咕咕牛(启用|开启)$/i,
          fnc: "enableTuKu",
          permission: "master",
        },
        {
          reg: /^#?咕咕牛(禁用|关闭)$/i,
          fnc: "disableTuKu",
          permission: "master",
        },
        {
          reg: /^#?咕咕牛设置(?:\s+([\w\u4e00-\u9fa5]+)\s*(.*))?$/i,
          fnc: "dispatchSettingsCommand",
          permission: "master",
        },
        {
          reg: /^#?咕咕牛面板$/i,
          fnc: "showSettingsPanel",
          permission: "master",
        },
      ],
    });
  }

  // enableTuKu, disableTuKu, _toggleTuKu, dispatchSettingsCommand 保持不变
  // ... (为节省篇幅，此处省略未修改的函数，请保留你文件中的原样)
  enableTuKu = async (e) => {
    return this._toggleTuKu(e, true);
  }

  disableTuKu = async (e) => {
    return this._toggleTuKu(e, false);
  }

  async _toggleTuKu(e, isEnabled) {
    const currentState = await config.get('guguniu.settings.TuKuOP');
    if (currentState === isEnabled) {
      return e.reply(`咕咕牛图库已经是「${isEnabled ? '启用' : '禁用'}」状态，无需操作。`, true);
    }

    await config.set('guguniu.settings.TuKuOP', isEnabled);

    if (isEnabled) {
      await e.reply("状态已设为「启用」，开始执行全量文件同步...", true);
      await setupManager._performSyncing({ isInitialSync: true });
      await e.reply("文件同步完成！咕咕牛图库已启用。", true);
    } else {
      await e.reply("状态已设为「禁用」，开始清理所有已同步的图库文件...", true);
      const externalPlugins = await config.get('exPlugins') || {};
      const targetPaths = this._getTargetPaths(externalPlugins);
      await setupManager._cleanAllNiuImages(targetPaths);
      await e.reply("文件清理完成！咕咕牛图库已禁用。", true);
    }
    return true;
  }

    dispatchSettingsCommand = async (e) => {
    const match = e.reg.exec(e.msg);
    const settingAlias = match[1];
    const value = match[2];      

    if (settingAlias === undefined) {
      return this.showSettingsPanel(e);
    }

    const trimmedAlias = settingAlias.trim().toLowerCase();
    const trimmedValue = value.trim();

    let targetKey = null;
    let schema = null;

    for (const key in SETTINGS_SCHEMA) {
      const currentSchema = SETTINGS_SCHEMA[key];
      if (currentSchema.aliases.some(alias => alias.toLowerCase() === trimmedAlias)) {
        targetKey = key;
        schema = currentSchema;
        break;
      }
    }

    if (!targetKey) {
      return e.reply(`未找到名为「${trimmedAlias}」的设置项。`, true);
    }

    let parsedValue;
    switch (schema.type) {
      case 'boolean':
        if (['true', '开启', '启用', 'on', '1'].includes(trimmedValue.toLowerCase())) parsedValue = true;
        else if (['false', '关闭', '禁用', 'off', '0'].includes(trimmedValue.toLowerCase())) parsedValue = false;
        else return e.reply(`无效的值「${trimmedValue}」。选项「${trimmedAlias}」只接受 (开启/关闭)。`, true);
        break;
      
      case 'enum':
        const numValue = Number(trimmedValue);
        const potentialValue = schema.validValues.find(v => 
            String(v).toLowerCase() === trimmedValue.toLowerCase() || v === numValue
        );
        if (potentialValue !== undefined) {
            parsedValue = typeof schema.validValues[0] === 'number' ? numValue : potentialValue;
        } else {
            return e.reply(`无效的值「${trimmedValue}」。选项「${trimmedAlias}」只接受 (${schema.validValues.join('/')})。`, true);
        }
        break;

      case 'range':
        parsedValue = parseInt(trimmedValue, 10);
        if (isNaN(parsedValue) || parsedValue < schema.min || parsedValue > schema.max) {
          return e.reply(`无效的值「${trimmedValue}」。选项「${trimmedAlias}」的范围是 ${schema.min}-${schema.max}。`, true);
        }
        break;
      
      default:
        logger.error(`内部错误：在 Schema 中找到了键 ${targetKey}，但其类型 ${schema.type} 无效。`);
        return e.reply('内部错误：未知的设置类型。', true);
    }

    try {
      await config.set(targetKey, parsedValue);
      let replyMsg = `设置成功！「${trimmedAlias}」已更新为「${trimmedValue}」。`;
      
      if (schema.affectsFileSync) {
        replyMsg += "\n检测到此项会影响图片展示，正在为您刷新文件...";
        await e.reply(replyMsg, true);
        await setupManager._performSyncing({ isInitialSync: false });
        await e.reply("文件刷新完成！", true);
      } else {
        await e.reply(replyMsg, true);
      }

    } catch (error) {
      logger.error(`设置 ${targetKey} 失败:`, error);
      await e.reply(`设置失败，请查看控制台日志。`, true);
    }

    return true;
  }

  /**
   * @description 渲染并发送设置面板
   */
  showSettingsPanel = async (e) => {
    // 1. 获取所有设置的当前值
    const settings = await config.get('guguniu.settings') || {};
    const filterSettings = settings.Filter || {};

    // 2. 将设置值转换为 HTML 模板需要的数据结构
    const tuKuStatus = this._createToggleStatus(settings.TuKuOP, "已启用", "已禁用");

    const pflMap = {
      0: { level: "0 (不过滤)", description: "允许所有图片", class: "value-level-0" },
      1: { level: "1 (R18)", description: "仅屏蔽 R18", class: "value-level-1" },
      2: { level: "2 (R18+P18)", description: "屏蔽 R18 和 P18", class: "value-level-2" },
    };
    const pflStatus = pflMap[settings.PurificationLevel] || pflMap[0];

    const loadLevelMap = {
        1: { levelName: "保守", description: "最保守的策略,仅在必要时执行", valueClass: "value-level-1" },
        2: { levelName: "均衡", description: "在性能和功能间取得平衡", valueClass: "value-level-2" },
        3: { levelName: "性能", description: "优先保证性能,可能会牺牲部分功能", valueClass: "value-level-3" },
    };
    const loadLevel = loadLevelMap[settings.LoadLevel] || loadLevelMap[2];
    loadLevel.containerClass = settings.ExecutionMode === 'Serial' ? '' : 'item-disabled';


    // 3. 组装最终的 renderData 对象
    const renderData = {
      tuKuStatus,
      pflStatus,
      aiStatus: this._createToggleStatus(filterSettings.Ai),
      easterEggStatus: this._createToggleStatus(filterSettings.EasterEgg),
      layoutStatus: this._createToggleStatus(filterSettings.Layout),
      renderScale: { value: settings.RenderScale || 100 },
      officialSplashArtStatus: this._createToggleStatus(settings.OfficialSplashArt),
      sleeperAgentStatus: this._createToggleStatus(settings.SleeperAgentSwitch),
      executionMode: this._createToggleStatus(settings.ExecutionMode === 'Serial', '串行', '并行'),
      loadLevel,
      pluginVersion: await version.get(),
      scaleStyleValue: `transform:scale(${ (settings.RenderScale || 100) / 100 }); transform-origin: top left;`,
      guguniu_res_path: `file://${path.join(Yunara_Res_Path, 'GuGuNiu').replace(/\\/g, '/')}/`,
      headerImage: `file://${path.join(Yunara_Res_Path, 'GuGuNiu', 'html', 'img', '118195036.webp').replace(/\\/g, '/')}`
    };

    // 4. 定义模板路径并调用渲染器
    const templatePath = path.join(Yunara_Res_Path, 'niu', 'html', 'settings_panel.html');
    
    try {
        const imageBase64 = await renderer.render({
            templatePath: templatePath,
            data: renderData,
        });

        if (imageBase64) {
            await e.reply(segment.image(`base64://${imageBase64}`));
        } else {
            throw new Error("渲染器返回了空的数据");
        }
    } catch (renderError) {
        logger.error("设置面板渲染失败:", renderError);
        await e.reply("设置面板图片生成失败，请查看控制台日志");
    }
    return true;
  }

  /**
   * @private
   * @description 一个辅助函数，用于创建开关状态对象
   */
  _createToggleStatus(value, trueText = "开启", falseText = "关闭") {
    return {
      text: value ? trueText : falseText,
      class: value ? 'value-enabled' : 'value-disabled'
    };
  }

  _getTargetPaths(externalPlugins) {
    return {
      gs: externalPlugins.miao?.syncTarget ? path.join(Yunzai_Path, externalPlugins.miao.syncTarget) : null,
      sr: externalPlugins.miao?.syncTarget ? path.join(Yunzai_Path, externalPlugins.miao.syncTarget) : null,
      zzz: externalPlugins.zzz?.syncTarget ? path.join(Yunzai_Path, externalPlugins.zzz.syncTarget) : null,
      waves: externalPlugins.waves?.syncTarget ? path.join(Yunzai_Path, externalPlugins.waves.syncTarget) : null,
    };
  }
}