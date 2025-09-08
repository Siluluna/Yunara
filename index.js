import { initialize } from './utils/Initialize.js';
import { createLogger } from './utils/Logger.js';
import { version } from './utils/Version.js';

export * from './apps/index.js';

setTimeout(() => initialize.run(), 1000);

(async () => {
  const logger = createLogger('Yunara:Core');
  const currentVersion = await version.get();
  logger.info('------------YUNARA------------');
  logger.info(`Yunara云露 v${currentVersion} 初始化成功。`);
  logger.info('------------------------------');
})();