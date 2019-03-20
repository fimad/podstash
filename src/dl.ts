import * as fs from "fs";
import { promises as fsPromises } from "fs";
import * as request from "request";

let allDownloadsDone: Promise<any> = Promise.resolve();

async function download(name: string, url: string, path: string): Promise<any> {
  const promise = performDownloads(name, url, path);
  allDownloadsDone = Promise.all([allDownloadsDone, promise]);
  return promise;
}

async function performDownloads(name: string, url: string, path: string): Promise<any> {
  const tmpPath = `${path}.download`;
  const promise = new Promise((resolve, reject) => {
    console.log(`Downloading ${name}\n\t${url.trim()}`);
    const pipe = request.get({url, headers: {"User-Agent": "podstash"}})
      .on("error", reject)
      .on("response", (response) => {
        if (response.statusCode < 200 || 399 < response.statusCode) {
          reject(new Error(`Unable to fetch audio: ${response.statusCode}`));
        }
      })
      .pipe(fs.createWriteStream(tmpPath))
      .on("finish", resolve)
      .on("error", reject);
  });
  return promise.then(() => fsPromises.rename(tmpPath, path));
}

export default download;
