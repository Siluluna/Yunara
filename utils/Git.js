import path from "node:path";
import fs from "node:fs/promises";
import { createLogger } from "#Yunara/utils/logger";
import { processService } from "#Yunara/utils/process";
import { file } from "#Yunara/utils/file";
import { config } from "#Yunara/utils/config";
import { data } from "#Yunara/utils/data";
import { Yunara_Temp_Path } from "#Yunara/utils/path";

const logger = createLogger("Yunara:Utils:Git");

class GitService {
  async _deliverRepo(tempPath, finalPath, gitConfig) {
    logger.debug(`开始交付仓库: ${path.basename(tempPath)} -> ${path.basename(finalPath)}`);
    
    const delay = gitConfig.PostCloneDelay || 2000;
    logger.debug(`等待 ${delay}ms 以释放文件锁...`);
    await new Promise(resolve => setTimeout(resolve, delay));

    const deleted = await file.safeDelete(finalPath);
    if (!deleted) {
      throw new Error(`无法清理旧的目标目录 ${finalPath}，交付中止。`);
    }

    try {
      await fs.mkdir(path.dirname(finalPath), { recursive: true });
      await fs.rename(tempPath, finalPath);
      logger.info(`仓库 [${path.basename(finalPath)}] 已通过快速重命名成功就位✅`);
    } catch (renameError) {
      if (renameError.code === 'EPERM' || renameError.code === 'EBUSY' || renameError.code === 'EXDEV') {
        logger.warn(`仓库 [${path.basename(finalPath)}] 快速重命名失败 (${renameError.code})⚠️，启动备用方案 (逐文件复制)...`);
        try {
          await file.copy(tempPath, finalPath);
          logger.info(`仓库 [${path.basename(finalPath)}] 已通过回退方案(I/O 复制)成功部署✅`);
        } catch (copyError) {
          logger.error(`仓库 [${path.basename(finalPath)}] 备用回退方案也失败了:`, copyError);
          throw copyError;
        }
      } else {
        throw renameError;
      }
    }
  }

  async cloneRepo({ repoUrl, localPath, branch, callbacks = {} }) {
    const repoInfo = this._parseRepoUrl(repoUrl);
    if (!repoInfo) throw new Error(`无法解析的仓库 URL 格式: ${repoUrl}`);
    const gitConfig = await config.get('git');
    if (!gitConfig) throw new Error("Git 核心配置 (git.yaml) 缺失。");
    
    callbacks.repoInfo = repoInfo;

    if (repoInfo.platform === 'github') {
      return this._cloneGitHubRepo({ repoUrl, localPath, branch, gitConfig, callbacks });
    } else {
      return this._cloneStandardRepo({ repoUrl, localPath, branch, gitConfig, callbacks });
    }
  }
  
  async _cloneStandardRepo({ repoUrl, localPath, branch, gitConfig, callbacks }) {
    const tempDownloadsBaseDir = path.join(Yunara_Temp_Path, "git-downloads");
    const tempRepoPath = path.join(tempDownloadsBaseDir, `TempClone-${callbacks.repoInfo.repo}-Standard-${Date.now()}`);
    
    try {
      await fs.mkdir(tempRepoPath, { recursive: true });
      const cloneArgs = ["clone", "--verbose", `--depth=${gitConfig.GitCloneDepth}`, "-b", branch, repoUrl, tempRepoPath];
      
      await processService.execute({
        command: "git",
        args: cloneArgs,
        options: {},
        timeout: gitConfig.GitCloneTimeout,
      });
      
      await this._deliverRepo(tempRepoPath, localPath, gitConfig);

      return { success: true, nodeName: this._parseRepoUrl(repoUrl).platform, error: null };
    } catch (error) {
      throw error;
    } finally {
      await file.safeDelete(tempRepoPath);
    }
  }

  async _downloadRepoWithFallback({ repoUrl, branch, localPath, sortedNodes, gitConfig, callbacks }) {
    const tempDownloadsBaseDir = path.join(Yunara_Temp_Path, "git-downloads");
    let lastError = null;

    for (const node of sortedNodes) {
      const tempRepoPath = path.join(tempDownloadsBaseDir, `TempClone-${callbacks.repoInfo.repo}-${node.name}-${Date.now()}`);
      const startTime = Date.now();
      
      try {
        const cloneUrl = this._constructCloneUrl(repoUrl, node);
        if (!cloneUrl) continue;
        
        logger.info(`尝试使用节点 [${node.name}] 从 ${cloneUrl} 下载...`);
        await fs.mkdir(tempRepoPath, { recursive: true });

        const cloneArgs = ["clone", "--verbose", `--depth=${gitConfig.GitCloneDepth}`, "-b", branch, cloneUrl, tempRepoPath];
        
        await processService.execute({
            command: "git",
            args: cloneArgs,
            options: {},
            timeout: gitConfig.GitCloneTimeout,
        });

        const duration = Date.now() - startTime;
        await this._updateNodeStats({ nodeName: node.name, success: true, duration });
        
        await this._deliverRepo(tempRepoPath, localPath, gitConfig);
        
        return { success: true, nodeName: node.name, error: null };

      } catch (error) {
        lastError = error; 
        const duration = Date.now() - startTime;
        await this._updateNodeStats({ nodeName: node.name, success: false, duration });
        
        logger.warn(`节点 [${node.name}] 下载失败: ${error.message}，切换到下一个节点...`);
        
      } finally {
        await file.safeDelete(tempRepoPath);
      }
    }

    logger.error("所有下载节点均尝试失败。");
    throw lastError || new Error("所有下载节点均尝试失败");
  }

  async updateRepo({ localPath, branch, repoUrl }) {
    const repoInfo = this._parseRepoUrl(repoUrl);
    const gitConfig = await config.get('git');
    if (!gitConfig) {
      throw new Error("Git 核心配置 (git.yaml) 缺失。");
    }
    if (repoInfo?.platform === 'github') {
      logger.debug(`为 [${localPath}] 执行 GitHub 高级容错更新...`);
      return this._updateGitHubRepo({ localPath, branch, repoUrl, gitConfig });
    } else {
      logger.debug(`为 [${localPath}] 执行标准更新...`);
      return this._updateStandardRepo({ localPath, branch, gitConfig });
    }
  }

  async isRepoDownloaded(localPath) {
    if (!localPath) return false;
    const gitPath = path.join(localPath, ".git");
    try {
      const stats = await fs.stat(gitPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  async manageExcludeRules(repositoryPath, { add, remove }) {
    const excludeFilePath = path.join(repositoryPath, ".git", "info", "exclude");
    try {
      await fs.access(path.join(repositoryPath, ".git"));

      let existingRules = [];
      try {
        const fileContent = await fs.readFile(excludeFilePath, "utf-8");
        existingRules = fileContent.split('\n').map(rule => rule.trim()).filter(Boolean);
      } catch (readError) {
        if (readError.code !== 'ENOENT') throw readError;
      }

      const rulesSet = new Set(existingRules);
      let rulesModified = false;

      if (Array.isArray(remove)) {
        remove.forEach(rule => { if (rulesSet.has(rule)) { rulesSet.delete(rule); rulesModified = true; } });
      }
      if (Array.isArray(add)) {
        add.forEach(rule => { if (!rulesSet.has(rule)) { rulesSet.add(rule); rulesModified = true; } });
      }

      if (rulesModified) {
        const finalRulesContent = Array.from(rulesSet).join("\n") + "\n";
        await fs.mkdir(path.dirname(excludeFilePath), { recursive: true });
        await fs.writeFile(excludeFilePath, finalRulesContent, "utf-8");
        logger.debug(`已更新 ${repositoryPath} 的 exclude 规则。`);
      }
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return true;
      logger.error(`管理 ${repositoryPath} 的 exclude 规则失败:`, error);
      return false;
    }
  }

  async _cloneGitHubRepo({ repoUrl, localPath, branch, gitConfig, callbacks }) {
    const sortedNodes = await this._getSortedNodes(repoUrl, branch, gitConfig);
    if (!sortedNodes || sortedNodes.length === 0) {
      throw new Error("所有 GitHub 下载节点均不可用 (实时探测与历史评分均无结果)");
    }
    logger.info(`GitHub 优选下载节点顺序: ${sortedNodes.map(n => `${n.name}(${n.score.toFixed(2)})`).join(' -> ')}`);
    return this._downloadRepoWithFallback({ repoUrl, branch, localPath, sortedNodes, gitConfig, callbacks });
  }

  async _updateGitHubRepo({ localPath, branch, repoUrl, gitConfig }) {
    const sortedNodes = await this._getSortedNodes(repoUrl, branch, gitConfig);
    if (!sortedNodes || sortedNodes.length === 0) {
      logger.warn(`所有 GitHub 节点均不可用，将尝试使用本地配置的 remote origin 进行标准更新...`);
      return this._updateStandardRepo({ localPath, branch, gitConfig });
    }
    logger.info(`GitHub 优选更新节点顺序: ${sortedNodes.map(n => `${n.name}(${n.score.toFixed(2)})`).join(' -> ')}`);
    for (const node of sortedNodes) {
      const remoteUrl = this._constructCloneUrl(repoUrl, node);
      const startTime = Date.now();
      try {
        logger.info(`尝试使用节点 [${node.name}] (${remoteUrl}) 更新...`);
        await processService.execute({ command: "git", args: ["remote", "set-url", "origin", remoteUrl], options: { cwd: localPath } });
        const result = await this._attemptUpdate({ localPath, branch, gitConfig });
        const duration = Date.now() - startTime;
        await this._updateNodeStats({ nodeName: node.name, success: result.success, duration });
        if (result.success) {
          return { ...result, nodeName: node.name };
        }
        logger.warn(`节点 [${node.name}] 更新失败:`, result.error.message);
      } catch (error) {
        const duration = Date.now() - startTime;
        await this._updateNodeStats({ nodeName: node.name, success: false, duration });
        logger.warn(`节点 [${node.name}] 设置 remote 或更新时出错:`, error.message);
      }
    }
    return { success: false, nodeName: 'All Nodes Failed', error: new Error("所有优选节点更新均尝试失败") };
  }

  async _updateStandardRepo({ localPath, branch, gitConfig }) {
    return this._attemptUpdate({ localPath, branch, gitConfig });
  }

  _parseRepoUrl(repoUrl) {
    const patterns = {
      github: /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/,
      gitee: /gitee\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/,
      gitcode: /gitcode\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/,
    };
    for (const platform in patterns) {
      const match = patterns[platform].exec(repoUrl);
      if (match) return { platform, owner: match[1], repo: match[2] };
    }
    return { platform: 'unknown' };
  }

  async _testNetworkNodes(repoUrl, gitConfig) {
    const repoInfo = this._parseRepoUrl(repoUrl);
    if (repoInfo.platform !== 'github') return [];
    const proxies = gitConfig.Proxies || [];
    const proxyTestTimeout = gitConfig.ProxyTestTimeout || 5000;
    const testFile = 'README.md';
    const promises = proxies.map(async (proxy) => {
      if (proxy.name === 'GitClone') {
        return { name: proxy.name, speed: Infinity, available: false, ...proxy };
      }
      let testUrl;
      if (proxy.name === 'GitHub') {
        testUrl = `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/main/${testFile}`;
      } else {
        const cleanUrl = proxy.url.replace(/\/$/, '');
        if (['Ghfast', 'GhproxyCom', 'MirrorGhproxy', 'GhproxyNet', 'UiGhproxy', 'GhApi999', 'GhproxyGo'].includes(proxy.name)) {
          testUrl = `${cleanUrl}/https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/main/${testFile}`;
        } else {
          testUrl = `${cleanUrl}/raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/main/${testFile}`;
        }
      }
      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), proxyTestTimeout);
        const response = await fetch(testUrl, { signal: controller.signal, cache: 'no-store' });
        clearTimeout(timeoutId);
        if (response.ok) {
          return { name: proxy.name, speed: Date.now() - start, available: true, ...proxy };
        }
      } catch (e) { /* 忽略网络错误 */ }
      return { name: proxy.name, speed: Infinity, available: false, ...proxy };
    });
    return Promise.all(promises);
  }

  async _gitLsRemoteTest(repoUrl, nodeConfig, branch, gitConfig) {
    const cloneUrl = this._constructCloneUrl(repoUrl, nodeConfig);
    if (!cloneUrl) return false;
    try {
      await processService.execute({
        command: "git",
        args: ["ls-remote", "--heads", cloneUrl, branch],
        options: {},
        timeout: gitConfig.GitLsRemoteTimeout
      });
      return true;
    } catch (e) {
      logger.debug(`节点 [${nodeConfig.name}] 对分支 [${branch}] 的 ls-remote 测试失败: ${e.message}`);
      return false;
    }
  }

  async _getSortedNodes(repoUrl, branch, gitConfig) {
    const allHttpTestResults = await this._testNetworkNodes(repoUrl, gitConfig);
    const gitTestPromises = allHttpTestResults.map(node =>
      this._gitLsRemoteTest(repoUrl, node, branch, gitConfig).then(gitResult => ({ name: node.name, gitResult }))
    );
    const gitTestResults = await Promise.all(gitTestPromises);
    const combinedResults = allHttpTestResults.map(http => {
      const git = gitTestResults.find(g => g.name === http.name);
      return { ...http, gitAvailable: git ? git.gitResult : false };
    });
    const availableNodes = combinedResults.filter(node => node.available || node.gitAvailable);
    const nodeStats = await this._getNodeStats();
    const scoredNodes = availableNodes.map(node => ({
      ...node,
      score: this._calculateNodeScore(nodeStats[node.name])
    }));
    scoredNodes.sort((a, b) => {
      if (a.gitAvailable !== b.gitAvailable) return b.gitAvailable - b.gitAvailable;
      if (b.score !== a.score) return b.score - a.score;
      if (a.speed !== b.speed) return a.speed - b.speed;
      return a.priority - b.priority;
    });
    return scoredNodes;
  }

  _constructCloneUrl(repoUrl, nodeConfig) {
    const repoInfo = this._parseRepoUrl(repoUrl);
    if (repoInfo.platform !== 'github' || !nodeConfig.url) return repoUrl;
    const cleanPrefix = nodeConfig.url.replace(/\/$/, "");
    if (nodeConfig.name === "GitClone") {
      return `${cleanPrefix}/${repoUrl.replace(/^https?:\/\//, "")}`;
    }
    if (nodeConfig.name === "Mirror") {
      return `${cleanPrefix}/${repoInfo.owner}/${repoInfo.repo}.git`;
    }
    if (nodeConfig.name === "GitHub") {
      return `https://github.com/${repoInfo.owner}/${repoInfo.repo}.git`;
    }
    return `${cleanPrefix}/github.com/${repoInfo.owner}/${repoInfo.repo}.git`;
  }

  async _attemptUpdate({ localPath, branch, gitConfig }) {
    let wasForceReset = false;
    try {
      await processService.execute({
        command: "git",
        args: ["pull", "origin", branch, "--ff-only"],
        options: { cwd: localPath },
        timeout: gitConfig.GitPullTimeout
      });
    } catch (pullError) {
      const stderr = (pullError.stderr || "").toLowerCase();
      const conflictKeywords = ["not possible to fast-forward", "diverging branches", "unrelated histories", "commit your changes", "needs merge"];
      if (conflictKeywords.some(keyword => stderr.includes(keyword))) {
        logger.warn(`[${path.basename(localPath)}] 更新检测到冲突，执行强制重置...`);
        try {
          await processService.execute({
            command: "git",
            args: ["fetch", "origin"],
            options: { cwd: localPath },
            timeout: gitConfig.GitPullTimeout
          });
          await processService.execute({
            command: "git",
            args: ["reset", "--hard", `origin/${branch}`],
            options: { cwd: localPath },
            timeout: gitConfig.GitPullTimeout
          });
          wasForceReset = true;
        } catch (resetError) {
          logger.error(`[${path.basename(localPath)}] 强制重置失败:`, resetError);
          return { success: false, error: resetError };
        }
      } else {
        return { success: false, error: pullError };
      }
    }
    return { success: true, wasForceReset, error: null };
  }

  async _getNodeStats() {
    return await data.get('runtime.gitNodeStats', {});
  }

  async _updateNodeStats({ nodeName, success, duration }) {
    const stats = await this._getNodeStats();
    const nodeStat = stats[nodeName] || { successCount: 0, failureCount: 0, totalTime: 0 };
    if (success) {
      nodeStat.successCount++;
      nodeStat.totalTime = (nodeStat.totalTime || 0) + duration;
    } else {
      nodeStat.failureCount++;
    }
    nodeStat.lastUsed = new Date().toISOString();
    stats[nodeName] = nodeStat;
    await data.set('runtime.gitNodeStats', stats);
  }

  _calculateNodeScore(stats) {
    if (!stats) return 0;
    const { successCount = 0, failureCount = 0, totalTime = 0, lastUsed } = stats;
    const totalRuns = successCount + failureCount;
    if (totalRuns === 0) return 0.5;
    const reliability = successCount / totalRuns;
    const avgSpeed = successCount > 0 ? totalTime / successCount : Infinity;
    const speedScore = Math.exp(-avgSpeed / 5000);
    let recencyScore = 0.5;
    if (lastUsed) {
      const daysSinceLastUse = (new Date() - new Date(lastUsed)) / (1000 * 60 * 60 * 24);
      recencyScore = Math.exp(-daysSinceLastUse / 7);
    }
    return (reliability * 0.6) + (speedScore * 0.3) + (recencyScore * 0.1);
  }
}

export const git = new GitService();