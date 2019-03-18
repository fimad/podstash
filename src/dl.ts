import * as fs from "fs";
import * as request from "request";

let allDownloadsDone: Promise<any> = Promise.resolve();

async function download(url: string, path: string): Promise<any> {
  const promise = performDownloads(url, path);
  allDownloadsDone = Promise.all([allDownloadsDone, promise]);
  return promise;
}

async function performDownloads(url: string, path: string): Promise<any> {
  const promise = new Promise((resolve, reject) => {
    console.log(`Downloading ${url.trim()}...`);
    const pipe = request.get(url).pipe(fs.createWriteStream(path));
    pipe.on("finish", resolve);
    pipe.on("error", reject);
  });
  return promise;
}

export default download;
