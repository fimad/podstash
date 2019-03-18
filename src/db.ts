import * as fs from "fs";
import { promises as fsPromises } from "fs";
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
            .map((d) => Feed.load(this, d.name))));
  }

  public newFeed(name: string, url: string): Promise<Feed> {
    return Feed.create(this, name, url);
  }

  private init(): Promise<DataBase> {
    return fsPromises.mkdir(this.path, {recursive: true})
        .then(() => fsPromises.stat(this.path))
        .then(() => this);
  }

  private dbPath(...subDirs: string[]) {
    return path.join(this.path, ...subDirs);
  }
}
