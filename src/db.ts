import * as fs from "fs";
import { promises as fsPromises } from "fs";
import Mustache from "mustache";
import * as path from "path";
import * as frequest from "request-promise-native";
import Feed from "./feed";

export default class DataBase {

  public static async load(dbPath: string): Promise<DataBase> {
    const baseUrlPath = path.join(dbPath, DataBase.PATH_BASE_URL);
    await fsPromises.mkdir(dbPath, {recursive: true});
    await fsPromises.stat(dbPath);
    const baseUrl = await fsPromises.readFile(baseUrlPath);
    return new DataBase(dbPath, baseUrl.toString());
  }

  public static async create(dbPath: string, baseUrl: string): Promise<DataBase> {
    const baseUrlPath = path.join(dbPath, DataBase.PATH_BASE_URL);
    await fsPromises.mkdir(dbPath, {recursive: true});
    await fsPromises.stat(dbPath);
    await fsPromises.writeFile(baseUrlPath, baseUrl);
    return new DataBase(dbPath, baseUrl);
  }

  private static readonly PATH_INDEX_HTML = "index.html";
  private static readonly TEMPLATE = "templates/index.html";

  private static readonly PATH_BASE_URL = "base.url";

  /**
   * The path under which podcasts and their associated meta data will be
   * stored.
   */
  public readonly path: string;

  /**
   * The base URL under which the mirrored podcasts are made available. This is
   * used when generating the mirrored RSS/XML files.
   */
  public readonly baseUrl: string;

  constructor(dbPath: string, baseUrl: string) {
    this.path = dbPath;
    this.baseUrl = baseUrl;
  }

  public feeds(): Promise<Feed[]> {
    return fsPromises.readdir(this.path, {withFileTypes: true} as any)
        .then((dirents) => Promise.all((dirents as unknown as fs.Dirent[])
            .filter((d) => d.isDirectory())
            .sort()
            .map((d) => Feed.load(this, d.name))));
  }

  public newFeed(name: string, url: string): Promise<Feed> {
    return Feed.create(this, name, url);
  }

  public async updateHtml(): Promise<void> {
    const template = await fsPromises.readFile(DataBase.TEMPLATE);
    const channels = await Promise.all(
      (await this.feeds()).map(async (feed) => ({
        channel: await feed.channel(),
        name: feed.name,
      })));
    const view = {
      ...this.baseMustacheView(),
      channels,
    };
    const inflated = Mustache.render(template.toString(), view);
    await fsPromises.writeFile(this.dbPath(DataBase.PATH_INDEX_HTML), inflated);
  }

  public baseMustacheView() {
    return {
      baseUrl: this.baseUrl,
    };
  }

  private dbPath(...subDirs: string[]) {
    return path.join(this.path, ...subDirs);
  }
}
