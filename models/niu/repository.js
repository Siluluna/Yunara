import path from 'node:path'
import fs from 'node:fs/promises'
import { git } from '#Yunara/utils/git'
import { config } from '#Yunara/utils/config'
import { createLogger } from '#Yunara/utils/logger'
import { Yunara_Repos_Path } from '#Yunara/utils/path'
import { NiuImage } from './image.js'

const logger = createLogger('Yunara:Model:NiuRepo')

export class NiuRepository {

  constructor(repoConfig) {
    /** @type {string} 仓库的唯一标识符 */
    this.id = repoConfig.id

    /** @type {string} 仓库的 Git URL */
    this.url = repoConfig.url

    /** @type {string} 仓库的分支 */
    this.branch = repoConfig.branch

    /** @type {string} 仓库的描述性名称 */
    this.description = repoConfig.description

    /** @type {boolean} 是否为核心仓库 (包含 ImageData.json) */
    this.isCore = repoConfig.isCore === true

    /** @type {boolean} 是否包含可选的游戏内容 (如 ZZZ, Waves) */
    this.containsOptionalContent = repoConfig.containsOptionalContent === true

    /** @type {string} 仓库的本地存储目录名 */
    this.name = path.basename(new URL(this.url).pathname, '.git')

    /** @type {string} 仓库在本地磁盘上的绝对路径 */
    this.localPath = path.join(Yunara_Repos_Path, this.name)
  }

  /**
   * @public
   * @description [核心静态入口] 从配置中获取所有仓库并实例化为 Repository 对象数组
   * @returns {Promise<GuGuNiuRepository[]>}
   */
  static async getAll() {
    const galleryConfig = await config.get('niu.gallery')
    if (!galleryConfig || !Array.isArray(galleryConfig.repositories)) {
      logger.warn('Gallery.yaml 配置缺失或格式不正确，无法加载仓库列表')
      return []
    }
    return galleryConfig.repositories.map(cfg => new NiuRepository(cfg))
  }

  /**
   * @public
   * @description 获取唯一的“核心”仓库实例
   * @returns {Promise<NiuRepository|null>}
   */
  static async getCoreRepository() {
    const allRepos = await this.getAll()
    return allRepos.find(repo => repo.isCore) || null
  }

  /**
   * @public
   * @description 获取所有已下载的仓库实例
   * @returns {Promise<NiuRepository[]>}
   */
  static async getDownloaded() {
    const allRepos = await this.getAll()
    const existenceChecks = await Promise.all(allRepos.map(repo => repo.isDownloaded()))
    return allRepos.filter((_, index) => existenceChecks[index])
  }

  /**
   * @public
   * @description 检查此仓库是否已下载到本地
   * @returns {Promise<boolean>}
   */
  async isDownloaded() {
    return git.isRepoDownloaded(this.localPath)
  }

  /**
   * @public
   * @description 执行下载（克隆）此仓库的业务操作
   * @param {object} [callbacks={}] 可选的回调函数，用于进度报告
   * @returns {Promise<object>} 返回 git.cloneRepo 的结果对象
   */
  async download(callbacks = {}) {
    logger.info(`[${this.description}] 开始执行下载任务...`)
    const result = await git.cloneRepo({
      repoUrl: this.url,
      localPath: this.localPath,
      branch: this.branch,
      callbacks: callbacks,
    })
    return { ...result, ...this }
  }

  /**
   * @public
   * @description 执行更新此仓库的业务操作
   * @returns {Promise<object>} 返回 git.updateRepo 的结果对象
   */
  async update() {
    logger.info(`[${this.description}] 开始执行更新任务...`)
    const result = await git.updateRepo({
      localPath: this.localPath,
      branch: this.branch,
      repoUrl: this.url,
    })
    return { ...result, ...this }
  }
}
