import { spawn } from "node:child_process";
import nodeProcess from "node:process";
import { createLogger } from "#Yunara/utils/logger";

const logger = createLogger("Yunara:Utils:Process");

class ProcessService {
  execute({ command, args, options = {}, timeout = 0, onStdOut, onStdErr }) {
    const cmdStr = `${command} ${args.join(" ")}`;
    const cleanEnv = { ...nodeProcess.env, ...(options.env || {}) };
    delete cleanEnv.HTTP_PROXY; delete cleanEnv.HTTPS_PROXY; delete cleanEnv.http_proxy; delete cleanEnv.https_proxy;
    
    if (command === "git") {
      options.env = { ...cleanEnv, GIT_CURL_VERBOSE: "1", GIT_TRACE: "1", GIT_PROGRESS_DELAY: "0" };
    } else {
      options.env = cleanEnv;
    }

    let proc;
    let promiseSettled = false;
    let timer;

    const settlePromise = (resolver, value) => {
      if (promiseSettled) return;
      promiseSettled = true;
      clearTimeout(timer);
      resolver(value);
    };

    const promise = new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      
      timer = timeout > 0 ? setTimeout(() => {
        if (promiseSettled) return;
        logger.warn(`命令 [${cmdStr}] 已达到总超时 (${timeout}ms)，正在终止...`);
        if (proc && proc.pid && !proc.killed) {
          spawn('taskkill', ['/pid', proc.pid, '/f', '/t']);
        }
        const err = new Error(`命令总超时 ${timeout}ms: ${cmdStr}`);
        settlePromise(reject, err);
      }, timeout) : null;

      try {
        proc = spawn(command, args, { stdio: "pipe", ...options, detached: true });
      } catch (spawnError) {
        return settlePromise(reject, spawnError);
      }

      proc.stdout?.on("data", (data) => {
        const chunk = data.toString();
        stdout += chunk;
        if (onStdOut) onStdOut(chunk);
      });
      proc.stderr?.on("data", (data) => {
        const chunk = data.toString();
        stderr += chunk;
        if (onStdErr) onStdErr(chunk);
      });

      proc.on("error", (err) => {
        err.stdout = stdout;
        err.stderr = stderr;
        settlePromise(reject, err);
      });

      proc.on("close", (code) => {
        if (code === 0) {
          settlePromise(resolve, { stdout, stderr });
        } else {
          const err = new Error(`命令执行失败，退出码 ${code}: ${cmdStr}\n${stderr}`);
          err.stdout = stdout;
          err.stderr = stderr;
          settlePromise(reject, err);
        }
      });
    });
    
    return promise;
  }
}

export const processService = new ProcessService();