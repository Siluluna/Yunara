import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===================================================================
// |                   Yunzai 根目录 和 Yunara 根目录                  |
// ===================================================================
export const Yunara_Path = path.resolve(__dirname, '..');
export const Yunzai_Path = path.resolve(Yunara_Path, '..', '..');


// ===================================================================
// |                        Yunara 文件夹路径                         |
// ===================================================================
export const Yunara_Data_Path = path.join(Yunara_Path, "data");
export const Yunara_Config_Path = path.join(Yunara_Path, "config");
export const Yunara_logs_Path = path.join(Yunara_Path, "logs");
export const Yunara_Repos_Path = path.join(Yunara_Path, "repos");
export const Yunara_Res_Path = path.join(Yunara_Path, "resources");
export const Yunara_Temp_Path = path.join(Yunara_Path, "temp");