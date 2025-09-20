import { initialize } from './utils/initialize.js';
import { createLogger } from './utils/logger.js';
import { version } from './utils/version.js';

export * from './apps/index.js';

setTimeout(() => initialize.run(), 1000);

(async () => {
  const logger = createLogger('Yunara:Core');
  const currentVersion = await version.get();
  logger.info('------------Yunara------------');
  logger.info(`云☁️ 露插件 v${currentVersion} 初始化成功`);
  logger.info('------------------------------');
})();
