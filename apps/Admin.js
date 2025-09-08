import plugin from '../../../lib/plugins/plugin.js';
import { createLogger } from '#Yunara/utils/Logger';

const logger = createLogger('Yunara:Admin');

export class AdminPlugin extends plugin {
  constructor() {
    super({
      name: 'Yunara管理',
      dsc: '管理与状态指令',
      event: 'message',
      priority: 50,
      rule: [
      ]
    });
  }


}