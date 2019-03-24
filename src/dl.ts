import * as fs from "fs";
import * as fsPromises from "fs-extra";
import * as request from "request";

/**
 * An in-progress download. It will resolve to the time (in milliseconds) the
 * download resolved or rejected at.
 */
type DownloadPromise = Promise<number>;

/**
 * The amount of time to delay between successive download requests to the same
 * host.
 */
const delayBetweenDownloads = 10000;

/**
 * A mapping from hosts to the latest download request for that host.
 */
const hostToDownloads: {[host: string]: DownloadPromise} = {};

/**
 * Downloads a resource and writes it to the given path. The provided name is
 * used in logs to identify the resource.
 *
 * The resource is written to a temporary file and then renamed to the desired
 * file name after it is complete.
 *
 * An optional validator function can be specified. If provided it is executed
 * before renaming. If the validator returns true, the file is renamed. If it
 * returns false the download is removed.
 *
 * The return value is the result of the validator.
 */
async function download(
    name: string,
    url: string,
    path: string,
    maybeValidate?: (tmpPath: string) => Promise<boolean>): Promise<boolean> {
  const validate = maybeValidate || (() => Promise.resolve(true));
  const tmpPath = `${path}.download`;

  const host = new URL(url).host;
  const priorDownload =
      (hostToDownloads[host] || new Promise((resolve) => resolve(0)));
  // The current download is allowed to start after delayBetweenDownloads from
  // the time the last download from the host finished at.
  const currentDownloadReadyToStart = priorDownload.then((endTime) =>
      new Promise((resolve) =>
          setTimeout(
              resolve,
              Math.max(0, endTime + delayBetweenDownloads - Date.now()))));

  const currentDownload =
      currentDownloadReadyToStart.then(() => new Promise((resolve, reject) => {
          console.log(`Downloading ${name}\n\t${url.trim()}`);
          const pipe = request.get({url, headers: {"User-Agent": "podstash"}})
            .on("error", reject)
            .on("response", (response) => {
              if (response.statusCode < 200 || 399 < response.statusCode) {
                reject(
                    new Error(`Unable to fetch audio: ${response.statusCode}`));
              }
            })
            .pipe(fs.createWriteStream(tmpPath))
            .on("finish", resolve)
            .on("error", reject);
        })
        .then(() => validate(tmpPath))
        .then((isValid) => {
          if (isValid) {
              fsPromises.rename(tmpPath, path);
          } else {
              fsPromises.unlink(tmpPath);
          }
          return isValid;
        }));

  hostToDownloads[host] = currentDownload
      .then(() => Date.now())
      .catch((e) => Date.now());

  return currentDownload;
}

export default download;
