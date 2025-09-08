import { spawn } from "node:child_process";
import nodeProcess from "node:process";
import { createLogger } from "#Yunara/utils/Logger";

const logger = createLogger("Yunara:Utils:Process");
const ERROR_CODES = { Timeout: "ETIMEDOUT", NotFound: "ENOENT" };

const processManager = {
  /**
   * @param {number} [timeout=0] 命令总执行超时。
   * @param {number} [noProgressTimeout=0] 无进展超时,如果设置,则在指定时间内未收到任何进度更新时会超时。
   */
  async execute(command, args, options = {}, timeout = 0, onStdOut, onStdErr, onProgress, noProgressTimeout = 0) {
    const isGitClone = command === "git" && args.includes("clone");
    if (isGitClone && !args.includes("--verbose")) {
      args.splice(args.indexOf("clone") + 1, 0, "--verbose");
    }

    const cmdStr = `${command} ${args.join(" ")}`;

    const cleanEnv = { ...nodeProcess.env, ...(options.env || {}) };
    delete cleanEnv.HTTP_PROXY;
    delete cleanEnv.HTTPS_PROXY;
    delete cleanEnv.http_proxy;
    delete cleanEnv.https_proxy;
    options.env = { ...cleanEnv, GIT_CURL_VERBOSE: "1", GIT_TRACE: "1" };

    let proc;
    let promiseSettled = false;
    let timer = null;

    const killProc = (signal = "SIGTERM") => {
      if (proc && proc.pid && !proc.killed) {
        logger.debug(`正在发送 ${signal} 信号到进程组 ${proc.pid} (${cmdStr})`);
        try {
          if (nodeProcess.platform === "win32") {
            spawn('taskkill', ['/pid', proc.pid, '/f', '/t']);
          } else {
            nodeProcess.kill(-proc.pid, signal);
          }
        } catch (killError) {
          if (killError.code !== "ESRCH") {
            logger.error(`终止进程 ${proc.pid} 失败:`, killError);
          }
        }
      }
    };

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      const settlePromise = (resolver, value) => {
        if (promiseSettled) return;
        promiseSettled = true;
        clearTimeout(timer);
        resolver(value);
      };

      const resetTimeout = (newTimeout) => {
        clearTimeout(timer);
        const effectiveTimeout = newTimeout || (onProgress ? noProgressTimeout : timeout);
        
        if (effectiveTimeout > 0) {
          timer = setTimeout(() => {
            if (promiseSettled) return;
            const reason = onProgress ? `无进展` : `总时长`;
            logger.warn(`命令 [${cmdStr}] 因 [${reason}] 超时 (${effectiveTimeout}ms)，正在终止...`);
            killProc("SIGTERM");
            setTimeout(() => { if (proc && !proc.killed) killProc("SIGKILL"); }, 3000);

            const err = new Error(`命令因 [${reason}] 超时 ${effectiveTimeout}ms: ${cmdStr}`);
            err.code = ERROR_CODES.Timeout;
            err.stdout = stdout;
            err.stderr = stderr;
            settlePromise(reject, err);
          }, effectiveTimeout);
        }
      };

      try {
        proc = spawn(command, args, { stdio: "pipe", ...options, detached: true });
        logger.debug(`已启动进程 ${proc.pid}: ${cmdStr}`);
      } catch (spawnError) {
        logger.error(`启动进程失败 [${cmdStr}]:`, spawnError);
        settlePromise(reject, spawnError);
        return;
      }

      resetTimeout();

      const handleOutput = (streamName, data, externalCallback) => {
        if (promiseSettled) return;
        const outputChunk = data.toString();

        if (streamName === "stdout") {
          stdout += outputChunk;
        } else {
          stderr += outputChunk;
          if (onProgress && isGitClone) {
            const progressMatch = outputChunk.match(/(?:Receiving|Resolving|Compressing) objects:\s*(\d+)%/i);
            if (progressMatch && progressMatch[1]) {
              const percent = parseInt(progressMatch[1], 10);
              onProgress(percent, resetTimeout);
            }
          }
        }

        if (externalCallback) {
          try { externalCallback(outputChunk); }
          catch (e) { logger.warn(`${streamName} 回调执行出错:`, e); }
        }
      };

      proc.stdout?.on("data", (data) => handleOutput("stdout", data, onStdOut));
      proc.stderr?.on("data", (data) => handleOutput("stderr", data, onStdErr));

      proc.on("error", (err) => {
        if (promiseSettled) return;
        logger.error(`进程发生错误 [${cmdStr}]:`, err);
        err.stdout = stdout;
        err.stderr = stderr;
        settlePromise(reject, err);
      });

      proc.on("close", (code, signal) => {
        if (promiseSettled) return;
        if (code === 0) {
          settlePromise(resolve, { code: 0, signal, stdout, stderr });
        } else {
          const err = new Error(`命令执行失败，退出码 ${code}: ${cmdStr}`);
          err.code = code ?? "UNKNOWN";
          err.signal = signal;
          err.stdout = stdout;
          err.stderr = stderr;
          settlePromise(reject, err);
        }
      });
    });
  }
};

export const process = processManager;