import * as fs from "fs";
import * as fsPromises from "fs-extra";
import Mustache from "mustache";
import * as path from "path";
import * as lockfile from "proper-lockfile";
import * as frequest from "request-promise-native";
import Feed from "./feed";
import * as rss from "./rss";

/**
 * A podcast archive.
 *
 * An archive is a directory on disk that contains several podcast feeds that
 * are tracked and cached locally. The archive maintains cross-feed
 * configuration values and provides an API for accessing the constituent feeds.
 *
 * The archive is structured on disk in such that it can be exposed over HTTP.
 * The locally cached feeds expose an HTML interface and a generated feed
 * composed of the constituent cached RSS feeds.
 *
 * The base URL of an archive is the URL under which the archive is exposed.
 */
export default class Archive {

  /**
   * The path relative to the archive root for config files and directories.
   */
  public static readonly PATH_CONFIG = "config";

  /** Loads an archive from disk. */
  public static async load(
      dbPath: string,
      withArchive: (archive: Archive) => Promise<any>) {
    const baseUrlPath = path.join(dbPath, Archive.PATH_BASE_URL);
    Archive.doWithLockedArchive(
        dbPath,
        () => fsPromises.readFile(baseUrlPath).then((x) => x.toString()),
        withArchive);
  }

  /** Creates a new archive on disk. */
  public static async create(
      dbPath: string,
      baseUrl: string,
      withArchive: (archive: Archive) => Promise<any>) {
    const baseUrlPath = path.join(dbPath, Archive.PATH_BASE_URL);
    Archive.doWithLockedArchive(
        dbPath,
        async () => {
          await fsPromises.writeFile(baseUrlPath, baseUrl);
          return baseUrl;
        },
        withArchive);
  }

  /**
   * The path relative to the archive root for the config file that stores the
   * content of the base URL.
   */
  private static readonly PATH_BASE_URL =
      path.join(Archive.PATH_CONFIG, "base.url");

  /**
   * The path relative to the archive root for the generated index.html file.
   */
  private static readonly PATH_INDEX_HTML = "index.html";

  /**
   * The path to the mustache template file that is inflated to the generated
   * archive index HTML file.
   */
  private static readonly TEMPLATE = "templates/index.html";

  private static async doWithLockedArchive(
      dbPath: string,
      getBaseUrl: () => Promise<string>,
      withArchive: (archive: Archive) => Promise<any>) {
    await fsPromises.ensureDir(dbPath);
    await fsPromises.ensureDir(path.join(dbPath, Archive.PATH_CONFIG));
    await fsPromises.stat(dbPath);

    let release;
    try {
      release = await lockfile.lock(dbPath);
    } catch (e) {
      console.log("Unable to acquire lock on archive.");
      console.log("Is another instance running?");
      throw(e);
    }
    try {
      const baseUrl = await getBaseUrl();
      await withArchive(new Archive(dbPath, baseUrl.toString()));
    } finally {
      await release();
    }
  }

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

  /** Return a list of feeds in the archive. */
  public feeds(): Promise<Feed[]> {
    return ((fsPromises.readdir as any)(this.path, {withFileTypes: true}))
        .then((dirents: fs.Dirent[]) => Promise.all(dirents
            .filter((d) => d.isDirectory())
            .filter((d) => d.name !== "config")
            .sort()
            .map((d) => Feed.load(this, d.name))));
  }

  /**
   * Add a new feed to the archive.
   *
   * The name should be unique and safe for file systems. The URL is the remote
   * RSS feed URL to be tracked.
   */
  public newFeed(name: string, url: string): Promise<Feed> {
    if (name === "config") {
      throw new Error('The name "config" is reserved.');
    }
    return Feed.create(this, name, url);
  }

  /**
   * Generate the HTML interface for managed feeds.
   */
  public async updateHtml(): Promise<void> {
    const template = await fsPromises
        .readFile(this.dbPath(Archive.PATH_CONFIG, Archive.TEMPLATE))
        .catch((e) => fsPromises.readFile(Archive.TEMPLATE));
    const feeds = await this.feeds();
    const feedsAndChannels: Array<[Feed, rss.Channel]> = await Promise.all(
      feeds.map(async (feed) =>
          [feed, await feed.generatedChannel()] as [Feed, rss.Channel]));
    const channels = feedsAndChannels.map(([feed, channel]) => ({
      channel,
      name: feed.name,
    }));
    const view = {
      ...this.baseMustacheView(),
      channels,
    };
    const inflated = Mustache.render(template.toString(), view);
    await fsPromises.writeFile(this.dbPath(Archive.PATH_INDEX_HTML), inflated);
    await Promise.all(
        feedsAndChannels.map(([feed, channel]) => feed.updateHtml(channel)));
  }

  /**
   * Return a set of archive-level variables that are exposed to all mustache
   * templates.
   */
  public baseMustacheView() {
    return {
      baseUrl: this.baseUrl,
    };
  }

  public dbPath(...subDirs: string[]) {
    return path.join(this.path, ...subDirs);
  }
}
