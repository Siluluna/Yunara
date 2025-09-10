// import { configLoader } from '#Yunara/utils/Config'; 
// import { createLogger } from '#Yunara/utils/Logger';
// import lodash from 'lodash';

// const logger = createLogger('Yunara:Models:Settings');

// class SettingsManager {
//     #configStore = {};
//     #initializationPromise = null;

//     constructor() {
//         this.#initializationPromise = this._initialize();
//     }

//     /**
//      * @description 异步初始化，加载所有配置文件
//      * @private
//      */
//     async _initialize() {
//         try {
//             const [gitConfig, rendererConfig, exPluginsConfig, guguNiuGallery, guguNiuSettings] = await Promise.all([
//                 configLoader.load('Git.yaml'),
//                 configLoader.load('Renderer.yaml'),
//                 configLoader.load('Ex-Plugins.yaml'),
//                 configLoader.load('GuGuNiu/Gallery.yaml'),
//                 configLoader.load('GuGuNiu/Settings.yaml'),
//             ]);

//             this.#configStore = {
//                 git: gitConfig,
//                 renderer: rendererConfig,
//                 exPlugins: exPluginsConfig,
//                 guguniu: {
//                     gallery: guguNiuGallery,
//                     settings: guguNiuSettings,
//                 },
//             };
            
//             logger.info('平台所有配置已成功加载并合并。');

//         } catch (error) {
//             logger.fatal('平台配置初始化失败！', error);
//             // 在实际应用中，这里可能需要一个更健壮的错误处理，比如使用默认配置
//         }
//     }

//     /**
//      * @description 获取配置项 (核心公共接口)
//      * @param {string} key - 点分路径的键名，例如 'guguniu.settings.Filter.Ai'
//      * @param {*} [defaultValue=null] - 如果找不到，返回的默认值
//      * @returns {Promise<*>}
//      */
//     async get(key, defaultValue = null) {
//         await this.#initializationPromise;
//         return lodash.get(this.#configStore, key, defaultValue);
//     }

//     // TODO: 未来实现 save 方法
//     async save() {
//         // ...
//     }
// }

// export const settings = new SettingsManager();