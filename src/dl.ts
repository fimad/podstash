import * as fs from "fs";
import * as fsPromises from "fs-extra";
import * as request from "request";

type DownloadPromise = Promise<number>;

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
  return new Promise((resolve, reject) => {
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
    })
    .then(() => validate(tmpPath))
    .then((isValid) => {
      if (isValid) {
          fsPromises.rename(tmpPath, path);
      } else {
          fsPromises.unlink(tmpPath);
      }
      return isValid;
    });
}

export default download;
