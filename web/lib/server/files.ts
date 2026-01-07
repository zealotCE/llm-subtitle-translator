import fs from "fs/promises";
import path from "path";

export async function readTextFile(filePath: string) {
  const data = await fs.readFile(filePath);
  if (data.length >= 3) {
    if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
      return data.toString("utf-8").replace(/^\ufeff/, "");
    }
  }
  if (data.length >= 2) {
    if ((data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0xfe && data[1] === 0xff)) {
      return data.toString("utf16le");
    }
  }
  return data.toString("utf-8");
}

export async function writeTextFile(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath) || ".", { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}
